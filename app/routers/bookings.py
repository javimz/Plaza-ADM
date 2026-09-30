from fastapi import APIRouter, HTTPException, Depends
from typing import List
from datetime import datetime
from app.database import get_db_connection
from app.schemas import BookingCreate, BookingOut
from app.routers.users import get_current_user

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
        SELECT bk.*, c.name as client_name, u.full_name as user_name
        FROM bookings bk
        LEFT JOIN clients c ON bk.client_id = c.id
        LEFT JOIN users u ON bk.user_id = u.id
        WHERE bk.status != 'En presupuesto'
        ORDER BY bk.id DESC;
    """)
    bookings = cursor.fetchall()
    conn.close()
    return [dict(b) for b in bookings]

@router.get("/{booking_id}")
def get_booking(booking_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT bk.*, c.name as client_name, c.email as client_email, c.phone as client_phone, c.document_id as client_doc, u.full_name as user_name
        FROM bookings bk
        LEFT JOIN clients c ON bk.client_id = c.id
        LEFT JOIN users u ON bk.user_id = u.id
        WHERE bk.id = ?;
    """, (booking_id,))
    bk = cursor.fetchone()
    if not bk:
        conn.close()
        raise HTTPException(status_code=404, detail="Reserva no encontrada")

    bk_dict = dict(bk)

    cursor.execute("""
        SELECT p.*, u.full_name as registered_by_user_name
        FROM payments p
        LEFT JOIN users u ON p.registered_by_user_id = u.id
        WHERE p.booking_id = ?
        ORDER BY p.id DESC;
    """, (booking_id,))
    payments = cursor.fetchall()
    bk_dict["payments"] = [dict(p) for p in payments]

    conn.close()
    return bk_dict

@router.post("", response_model=BookingOut)
def create_booking(payload: BookingCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    booking_number = generate_booking_number(conn)
    user_id = current_user.get("id", 1)

    cursor.execute("""
        INSERT INTO bookings (booking_number, budget_id, client_id, user_id, title, destination, start_date, end_date, currency, status, total_amount, paid_amount, balance_due, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?, ?);
    """, (
        booking_number, payload.budget_id, payload.client_id, user_id,
        payload.title, payload.destination, payload.start_date or "", payload.end_date or "",
        payload.currency or "USD", payload.status or "Confirmada", payload.total_amount,
        payload.total_amount, payload.notes or ""
    ))
    booking_id = cursor.lastrowid
    conn.commit()

    conn.close()
    return get_booking(booking_id, current_user)

@router.put("/{booking_id}")
def update_booking(booking_id: int, payload: BookingCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM bookings WHERE id = ?;", (booking_id,))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Reserva no encontrada")

    paid_amount = existing["paid_amount"]
    new_total = payload.total_amount
    new_balance = max(0.0, new_total - paid_amount)

    cursor.execute("""
        UPDATE bookings 
        SET client_id = ?, title = ?, destination = ?, start_date = ?, end_date = ?, currency = ?, status = ?, total_amount = ?, balance_due = ?, notes = ?
        WHERE id = ?;
    """, (
        payload.client_id, payload.title, payload.destination, payload.start_date or "",
        payload.end_date or "", payload.currency or "USD", payload.status or "Confirmada",
        new_total, new_balance, payload.notes or "", booking_id
    ))
    conn.commit()
    conn.close()

    return get_booking(booking_id, current_user)

@router.post("/{booking_id}/revert-to-budget")
def revert_to_budget(booking_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM bookings WHERE id = ?;", (booking_id,))
    booking = cursor.fetchone()
    if not booking:
        conn.close()
        raise HTTPException(status_code=404, detail="Reserva no encontrada")

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
    cursor.execute("DELETE FROM payments WHERE booking_id = ?;", (booking_id,))
    cursor.execute("DELETE FROM bookings WHERE id = ?;", (booking_id,))
    conn.commit()
    conn.close()
    return {"message": "Reserva y sus pagos eliminados exitosamente"}
