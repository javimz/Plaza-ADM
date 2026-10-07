from fastapi import APIRouter, HTTPException, Depends
from typing import List
from datetime import datetime
from app.database import get_db_connection
from app.schemas import PaymentCreate, PaymentOut
from app.routers.users import get_current_user
from app.sales_assignments import require_sales_assignment

router = APIRouter(prefix="/api/payments", tags=["Payments"])

def generate_payment_number(conn):
    cursor = conn.cursor()
    year = datetime.now().year
    cursor.execute("SELECT COUNT(*) FROM payments;")
    count = cursor.fetchone()[0] + 1
    return f"PAG-{year}-{count:04d}"

@router.get("")
def get_payments(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.*, bk.booking_number, c.name as client_name, u.full_name as registered_by_user_name
        FROM payments p
        LEFT JOIN bookings bk ON p.booking_id = bk.id
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN users u ON p.registered_by_user_id = u.id
        WHERE (? != 'agente' OR EXISTS (
            SELECT 1 FROM booking_sellers bs WHERE bs.booking_id = p.booking_id AND bs.user_id = ?
        ))
        ORDER BY p.id DESC;
    """, (current_user.get("role"), current_user.get("id")))
    payments = [dict(payment, record_type="Cliente") for payment in cursor.fetchall()]
    if current_user.get("role") != "agente":
        cursor.execute("""
            SELECT 'PROV-' || printf('%06d', spp.id) as payment_number,
                   'proveedor-' || spp.id as id, spp.id as supplier_payment_id,
                   sp.id as payable_id, sp.booking_id, bk.booking_number,
                   NULL as client_id, s.name as client_name, s.name as supplier_name,
                   -spp.amount as amount, spp.payment_date, spp.payment_method,
                   'Egreso proveedor' as payment_type, spp.reference as reference_code,
                   spp.notes, spp.registered_by_user_id,
                   u.full_name as registered_by_user_name, spp.created_at,
                   'Proveedor' as record_type
            FROM supplier_payments spp
            JOIN supplier_payables sp ON sp.id = spp.payable_id
            JOIN suppliers s ON s.id = sp.supplier_id
            LEFT JOIN bookings bk ON bk.id = sp.booking_id
            LEFT JOIN users u ON u.id = spp.registered_by_user_id
            ORDER BY spp.id DESC;
        """)
        payments.extend(dict(payment) for payment in cursor.fetchall())
    conn.close()
    return sorted(payments, key=lambda payment: (payment.get("created_at") or "", payment["payment_number"]), reverse=True)

@router.get("/{payment_id}")
def get_payment_receipt(payment_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.*, 
               bk.booking_number, bk.title as booking_title, bk.currency, bk.total_amount as booking_total, bk.paid_amount as booking_paid, bk.balance_due as booking_balance,
               c.name as client_name, c.document_id as client_doc, c.email as client_email, c.phone as client_phone,
               u.full_name as registered_by_user_name
        FROM payments p
        LEFT JOIN bookings bk ON p.booking_id = bk.id
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN users u ON p.registered_by_user_id = u.id
        WHERE p.id = ?
          AND (? != 'agente' OR EXISTS (
              SELECT 1 FROM booking_sellers bs WHERE bs.booking_id = p.booking_id AND bs.user_id = ?
          ));
    """, (payment_id, current_user.get("role"), current_user.get("id")))
    payment = cursor.fetchone()
    conn.close()
    if not payment:
        raise HTTPException(status_code=404, detail="Pago no encontrado")

    return dict(payment)

@router.post("", response_model=PaymentOut)
def register_payment(payload: PaymentCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    # Verify booking exists
    cursor.execute("SELECT * FROM bookings WHERE id = ?;", (payload.booking_id,))
    booking = cursor.fetchone()
    if not booking:
        conn.close()
        raise HTTPException(status_code=404, detail="Reserva no encontrada")
    require_sales_assignment(cursor, "booking", payload.booking_id, current_user)

    if payload.amount <= 0:
        conn.close()
        raise HTTPException(status_code=400, detail="El monto del pago debe ser mayor a 0")

    balance_due = booking["balance_due"]
    if payload.amount > balance_due + 0.01:
        conn.close()
        raise HTTPException(status_code=400, detail=f"El monto ({payload.amount:.2f}) supera el saldo restante de la reserva ({balance_due:.2f})")

    payment_number = generate_payment_number(conn)
    user_id = current_user.get("id", 1)
    client_id = payload.client_id or booking["client_id"]

    new_paid = booking["paid_amount"] + payload.amount
    new_balance = max(0.0, booking["total_amount"] - new_paid)
    payment_type = "Total" if new_balance <= 0.01 else "Parcial"

    cursor.execute("""
        INSERT INTO payments (payment_number, booking_id, client_id, amount, payment_date, payment_method, concept, payment_type, reference_code, notes, registered_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, (
        payment_number, payload.booking_id, client_id, payload.amount,
        payload.payment_date, payload.payment_method, payload.concept or "", payment_type,
        payload.reference_code or "", payload.notes or "", user_id
    ))
    payment_id = cursor.lastrowid

    # Update booking balances
    cursor.execute("""
        UPDATE bookings SET paid_amount = ?, balance_due = ? WHERE id = ?;
    """, (new_paid, new_balance, payload.booking_id))

    conn.commit()

    cursor.execute("""
        SELECT p.*, bk.booking_number, c.name as client_name, u.full_name as registered_by_user_name
        FROM payments p
        LEFT JOIN bookings bk ON p.booking_id = bk.id
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN users u ON p.registered_by_user_id = u.id
        WHERE p.id = ?;
    """, (payment_id,))
    payment = cursor.fetchone()
    conn.close()

    return dict(payment)

@router.delete("/{payment_id}")
def delete_payment(payment_id: int, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") not in ["admin", "ventas"]:
        raise HTTPException(status_code=403, detail="Se requieren permisos de administrador o ventas para anular pagos")

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM payments WHERE id = ?;", (payment_id,))
    payment = cursor.fetchone()
    if not payment:
        conn.close()
        raise HTTPException(status_code=404, detail="Pago no encontrado")

    booking_id = payment["booking_id"]
    amount = payment["amount"]

    cursor.execute("SELECT * FROM bookings WHERE id = ?;", (booking_id,))
    booking = cursor.fetchone()
    if booking:
        new_paid = max(0.0, booking["paid_amount"] - amount)
        new_balance = max(0.0, booking["total_amount"] - new_paid)
        cursor.execute("UPDATE bookings SET paid_amount = ?, balance_due = ? WHERE id = ?;", (new_paid, new_balance, booking_id))

    cursor.execute("DELETE FROM payments WHERE id = ?;", (payment_id,))
    conn.commit()
    conn.close()

    return {"message": "Pago anulado y balances actualizados exitosamente"}
