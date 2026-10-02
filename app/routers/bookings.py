from fastapi import APIRouter, HTTPException, Depends
from typing import List
from datetime import datetime
from app.database import get_db_connection
from app.schemas import BookingCreate, BookingOut
from app.routers.users import get_current_user
from app.sales_assignments import (
    get_client_ids,
    get_seller_ids,
    initial_seller_ids,
    require_sales_assignment,
    set_client_ids,
    set_seller_ids,
    validate_client_ids,
)

router = APIRouter(prefix="/api/bookings", tags=["Bookings"])

def generate_booking_number(conn):
    cursor = conn.cursor()
    year = datetime.now().year
    cursor.execute("SELECT COUNT(*) FROM bookings;")
    count = cursor.fetchone()[0] + 1
    return f"RES-{year}-{count:04d}"

@router.get("", response_model=List[BookingOut])
def get_bookings(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT bk.*, c.name as client_name, u.full_name as user_name,
               b.budget_number, COALESCE(b.total_cost, 0) as total_cost,
               COALESCE((
                   SELECT SUM(spp.amount)
                   FROM supplier_payables sp
                   JOIN supplier_payments spp ON spp.payable_id = sp.id
                   WHERE sp.booking_id = bk.id
                      OR (sp.booking_id IS NULL AND sp.budget_id = bk.budget_id)
               ), 0) as supplier_paid_amount,
               COALESCE(b.total_cost, 0) - COALESCE((
                   SELECT SUM(spp.amount)
                   FROM supplier_payables sp
                   JOIN supplier_payments spp ON spp.payable_id = sp.id
                   WHERE sp.booking_id = bk.id
                      OR (sp.booking_id IS NULL AND sp.budget_id = bk.budget_id)
               ), 0) as cost_balance
        FROM bookings bk
        LEFT JOIN clients c ON bk.client_id = c.id
        LEFT JOIN users u ON bk.user_id = u.id
         LEFT JOIN budgets b ON b.id = bk.budget_id
        WHERE bk.status != 'En presupuesto'
          AND (? != 'agente' OR EXISTS (
              SELECT 1 FROM booking_sellers bs WHERE bs.booking_id = bk.id AND bs.user_id = ?
          ))
        ORDER BY bk.id DESC;
    """, (current_user.get("role"), current_user.get("id")))
    bookings = cursor.fetchall()
    result = []
    for row in bookings:
        booking = dict(row)
        booking["seller_ids"] = get_seller_ids(cursor, "booking", booking["id"])
        if booking["seller_ids"]:
            placeholders = ",".join("?" for _ in booking["seller_ids"])
            cursor.execute(f"SELECT full_name FROM users WHERE id IN ({placeholders}) ORDER BY full_name;", booking["seller_ids"])
            booking["seller_names"] = [seller["full_name"] for seller in cursor.fetchall()]
        else:
            booking["seller_names"] = []

        booking["client_ids"] = get_client_ids(cursor, "booking", booking["id"])
        if not booking["client_ids"] and booking["client_id"]:
            booking["client_ids"] = [booking["client_id"]]
        if booking["client_ids"]:
            c_placeholders = ",".join("?" for _ in booking["client_ids"])
            cursor.execute(f"SELECT name FROM clients WHERE id IN ({c_placeholders}) ORDER BY name;", booking["client_ids"])
            booking["client_names"] = [c_row["name"] for c_row in cursor.fetchall()]
            if booking["client_names"]:
                booking["client_name"] = ", ".join(booking["client_names"])
        else:
            booking["client_names"] = []

        result.append(booking)
    conn.close()
    return result

@router.get("/{booking_id}")
def get_booking(booking_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT bk.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
             c.document_id as client_doc, u.full_name as user_name,
             b.budget_number, COALESCE(b.total_cost, 0) as total_cost
        FROM bookings bk
        LEFT JOIN clients c ON bk.client_id = c.id
        LEFT JOIN users u ON bk.user_id = u.id
        LEFT JOIN budgets b ON b.id = bk.budget_id
        WHERE bk.id = ?;
    """, (booking_id,))
    bk = cursor.fetchone()
    if not bk:
        conn.close()
        raise HTTPException(status_code=404, detail="Reserva no encontrada")
    require_sales_assignment(cursor, "booking", booking_id, current_user)

    bk_dict = dict(bk)
    bk_dict["seller_ids"] = get_seller_ids(cursor, "booking", booking_id)
    if bk_dict["seller_ids"]:
        placeholders = ",".join("?" for _ in bk_dict["seller_ids"])
        cursor.execute(f"SELECT full_name FROM users WHERE id IN ({placeholders}) ORDER BY full_name;", bk_dict["seller_ids"])
        bk_dict["seller_names"] = [seller["full_name"] for seller in cursor.fetchall()]
    else:
        bk_dict["seller_names"] = []

    bk_dict["client_ids"] = get_client_ids(cursor, "booking", booking_id)
    if not bk_dict["client_ids"] and bk["client_id"]:
        bk_dict["client_ids"] = [bk["client_id"]]
    if bk_dict["client_ids"]:
        c_placeholders = ",".join("?" for _ in bk_dict["client_ids"])
        cursor.execute(f"SELECT name FROM clients WHERE id IN ({c_placeholders}) ORDER BY name;", bk_dict["client_ids"])
        bk_dict["client_names"] = [c_row["name"] for c_row in cursor.fetchall()]
        if bk_dict["client_names"]:
            bk_dict["client_name"] = ", ".join(bk_dict["client_names"])
    else:
        bk_dict["client_names"] = []

    cursor.execute("""
        SELECT bi.*, s.name as supplier_name
        FROM budget_items bi
        LEFT JOIN suppliers s ON s.id = bi.supplier_id
        WHERE bi.budget_id = ?
        ORDER BY bi.id;
    """, (bk["budget_id"],))
    bk_dict["items"] = [dict(item) for item in cursor.fetchall()]

    cursor.execute("""
        SELECT COALESCE(SUM(spp.amount), 0)
        FROM supplier_payables sp
        JOIN supplier_payments spp ON spp.payable_id = sp.id
        WHERE sp.booking_id = ?
           OR (sp.booking_id IS NULL AND sp.budget_id = ?);
    """, (booking_id, bk["budget_id"]))
    bk_dict["supplier_paid_amount"] = float(cursor.fetchone()[0] or 0)
    bk_dict["cost_balance"] = bk_dict["total_cost"] - bk_dict["supplier_paid_amount"]

    cursor.execute("""
        SELECT p.*, u.full_name as registered_by_user_name
        FROM payments p
        LEFT JOIN users u ON p.registered_by_user_id = u.id
        WHERE p.booking_id = ?
        ORDER BY p.id DESC;
    """, (booking_id,))
    payments = cursor.fetchall()
    bk_dict["payments"] = [dict(p, record_type="Cliente") for p in payments]

    cursor.execute("""
        SELECT spp.id, sp.id as payable_id, spp.payment_date, spp.amount,
               spp.payment_method, spp.reference as reference_code, spp.notes,
               spp.created_at, spp.registered_by_user_id,
               u.full_name as registered_by_user_name,
               s.name as supplier_name
        FROM supplier_payments spp
        JOIN supplier_payables sp ON sp.id = spp.payable_id
        JOIN suppliers s ON s.id = sp.supplier_id
        LEFT JOIN users u ON u.id = spp.registered_by_user_id
        WHERE sp.booking_id = ?
           OR (sp.booking_id IS NULL AND sp.budget_id = ?)
        ORDER BY spp.payment_date DESC, spp.id DESC;
    """, (booking_id, bk["budget_id"]))
    for supplier_payment in cursor.fetchall():
        expense = dict(supplier_payment)
        expense.update({
            "payment_number": f"PROV-{expense['id']:06d}",
            "amount": -float(expense["amount"]),
            "payment_type": "Egreso proveedor",
            "record_type": "Proveedor",
        })
        bk_dict["payments"].append(expense)
    bk_dict["payments"].sort(key=lambda payment: (payment.get("payment_date") or "", payment["id"]), reverse=True)

    conn.close()
    return bk_dict

@router.post("", response_model=BookingOut)
def create_booking(payload: BookingCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    booking_number = generate_booking_number(conn)
    user_id = current_user.get("id", 1)
    seller_ids = payload.seller_ids
    if seller_ids is None and payload.budget_id:
        cursor.execute("SELECT id FROM budgets WHERE id = ?;", (payload.budget_id,))
        if cursor.fetchone():
            require_sales_assignment(cursor, "budget", payload.budget_id, current_user)
            seller_ids = get_seller_ids(cursor, "budget", payload.budget_id)
    seller_ids = initial_seller_ids(cursor, seller_ids, current_user)

    raw_client_ids = payload.client_ids if payload.client_ids is not None else ([payload.client_id] if payload.client_id else [])
    client_ids = validate_client_ids(cursor, raw_client_ids)
    primary_client_id = client_ids[0]

    cursor.execute("""
        INSERT INTO bookings (booking_number, budget_id, client_id, user_id, title, destination, start_date, end_date, currency, status, total_amount, paid_amount, balance_due, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?, ?);
    """, (
        booking_number, payload.budget_id, primary_client_id, user_id,
        payload.title, payload.destination, payload.start_date or "", payload.end_date or "",
        payload.currency or "USD", payload.status or "Confirmada", payload.total_amount,
        payload.total_amount, payload.notes or ""
    ))
    booking_id = cursor.lastrowid
    set_seller_ids(cursor, "booking", booking_id, seller_ids)
    set_client_ids(cursor, "booking", booking_id, client_ids)
    conn.commit()

    conn.close()
    return get_booking(booking_id, current_user)

@router.put("/{booking_id}")
def update_booking(booking_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM bookings WHERE id = ?;", (booking_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Reserva no encontrada")
    require_sales_assignment(cursor, "booking", booking_id, current_user)
    conn.close()
    raise HTTPException(
        status_code=409,
        detail="Las reservas son de solo lectura. Vuelva a presupuesto para realizar modificaciones.",
    )

@router.post("/{booking_id}/revert-to-budget")
def revert_to_budget(booking_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM bookings WHERE id = ?;", (booking_id,))
    booking = cursor.fetchone()
    if not booking:
        conn.close()
        raise HTTPException(status_code=404, detail="Reserva no encontrada")
    require_sales_assignment(cursor, "booking", booking_id, current_user)

    if booking["budget_id"]:
        cursor.execute("UPDATE budgets SET status = 'Borrador' WHERE id = ?;", (booking["budget_id"],))

    cursor.execute("UPDATE bookings SET status = 'En presupuesto' WHERE id = ?;", (booking_id,))
    conn.commit()
    conn.close()

    return {"message": "Reserva devuelta a presupuesto. El historial de pagos se conserva.", "payments_preserved": True}

@router.delete("/{booking_id}")
def delete_booking(booking_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM bookings WHERE id = ?;", (booking_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Reserva no encontrada")
    cursor.execute("""
        DELETE FROM supplier_payments
        WHERE payable_id IN (SELECT id FROM supplier_payables WHERE booking_id = ?);
    """, (booking_id,))
    cursor.execute("DELETE FROM supplier_payables WHERE booking_id = ?;", (booking_id,))
    cursor.execute("DELETE FROM payments WHERE booking_id = ?;", (booking_id,))
    cursor.execute("DELETE FROM booking_clients WHERE booking_id = ?;", (booking_id,))
    cursor.execute("DELETE FROM booking_sellers WHERE booking_id = ?;", (booking_id,))
    cursor.execute("DELETE FROM bookings WHERE id = ?;", (booking_id,))
    conn.commit()
    conn.close()
    return {"message": "Reserva, pagos y egresos vinculados eliminados exitosamente"}
