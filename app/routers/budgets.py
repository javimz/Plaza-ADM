from fastapi import APIRouter, HTTPException, Depends
from typing import List
from datetime import datetime
from app.database import get_db_connection
from app.schemas import BudgetCreate, BudgetOut
from app.routers.users import get_current_user

router = APIRouter(prefix="/api/budgets", tags=["Budgets"])

def generate_budget_number(conn):
    cursor = conn.cursor()
    year = datetime.now().year
    cursor.execute("SELECT COUNT(*) FROM budgets;")
    count = cursor.fetchone()[0] + 1
    return f"PRES-{year}-{count:04d}"

@router.get("", response_model=List[BudgetOut])
def get_budgets(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT b.*, c.name as client_name, u.full_name as user_name
        FROM budgets b
        LEFT JOIN clients c ON b.client_id = c.id
        LEFT JOIN users u ON b.user_id = u.id
        ORDER BY b.id DESC;
    """)
    budgets = cursor.fetchall()

    result = []
    for b in budgets:
        b_dict = dict(b)
        cursor.execute("""
            SELECT bi.*, s.name as supplier_name
            FROM budget_items bi
            LEFT JOIN suppliers s ON bi.supplier_id = s.id
            WHERE bi.budget_id = ?;
        """, (b["id"],))
        items = cursor.fetchall()
        b_dict["items"] = [dict(i) for i in items]
        result.append(b_dict)

    conn.close()
    return result

@router.get("/{budget_id}", response_model=BudgetOut)
def get_budget(budget_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT b.*, c.name as client_name, u.full_name as user_name
        FROM budgets b
        LEFT JOIN clients c ON b.client_id = c.id
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.id = ?;
    """, (budget_id,))
    b = cursor.fetchone()
    if not b:
        conn.close()
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")

    b_dict = dict(b)
    cursor.execute("""
        SELECT bi.*, s.name as supplier_name
        FROM budget_items bi
        LEFT JOIN suppliers s ON bi.supplier_id = s.id
        WHERE bi.budget_id = ?;
    """, (budget_id,))
    items = cursor.fetchall()
    b_dict["items"] = [dict(i) for i in items]

    conn.close()
    return b_dict

@router.post("", response_model=BudgetOut)
def create_budget(payload: BudgetCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    budget_number = generate_budget_number(conn)
    user_id = current_user.get("id", 1)

    total_cost = sum(item.cost_price * item.quantity for item in payload.items)
    total_amount = sum(item.sale_price * item.quantity for item in payload.items)

    cursor.execute("""
        INSERT INTO budgets (budget_number, client_id, user_id, title, destination, start_date, end_date, currency, exchange_rate, status, total_cost, total_amount, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, (
        budget_number, payload.client_id, user_id, payload.title, payload.destination,
        payload.start_date or "", payload.end_date or "", payload.currency or "USD",
        payload.exchange_rate or 1.0, payload.status or "Borrador",
        total_cost, total_amount, payload.notes or ""
    ))
    budget_id = cursor.lastrowid

    for item in payload.items:
        subtotal = item.sale_price * item.quantity
        cursor.execute("""
            INSERT INTO budget_items (budget_id, service_type, description, supplier_id, cost_price, sale_price, quantity, subtotal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        """, (budget_id, item.service_type, item.description, item.supplier_id, item.cost_price, item.sale_price, item.quantity, subtotal))

    conn.commit()
    conn.close()
    return get_budget(budget_id, current_user)

@router.put("/{budget_id}", response_model=BudgetOut)
def update_budget(budget_id: int, payload: BudgetCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM budgets WHERE id = ?;", (budget_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")

    total_cost = sum(item.cost_price * item.quantity for item in payload.items)
    total_amount = sum(item.sale_price * item.quantity for item in payload.items)

    cursor.execute("""
        UPDATE budgets 
        SET client_id = ?, title = ?, destination = ?, start_date = ?, end_date = ?, currency = ?, exchange_rate = ?, status = ?, total_cost = ?, total_amount = ?, notes = ?
        WHERE id = ?;
    """, (
        payload.client_id, payload.title, payload.destination, payload.start_date or "",
        payload.end_date or "", payload.currency or "USD", payload.exchange_rate or 1.0,
        payload.status or "Borrador", total_cost, total_amount, payload.notes or "", budget_id
    ))

    cursor.execute("DELETE FROM budget_items WHERE budget_id = ?;", (budget_id,))
    for item in payload.items:
        subtotal = item.sale_price * item.quantity
        cursor.execute("""
            INSERT INTO budget_items (budget_id, service_type, description, supplier_id, cost_price, sale_price, quantity, subtotal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        """, (budget_id, item.service_type, item.description, item.supplier_id, item.cost_price, item.sale_price, item.quantity, subtotal))

    conn.commit()
    conn.close()
    return get_budget(budget_id, current_user)

@router.post("/{budget_id}/convert-to-booking")
def convert_to_booking(budget_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM budgets WHERE id = ?;", (budget_id,))
    budget = cursor.fetchone()
    if not budget:
        conn.close()
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")

    # Calculate actual total_amount from items if available
    cursor.execute("SELECT SUM(subtotal) FROM budget_items WHERE budget_id = ?;", (budget_id,))
    items_sum = cursor.fetchone()[0]
    total_amount = float(items_sum) if (items_sum is not None and items_sum > 0) else float(budget["total_amount"])

    user_id = current_user.get("id", budget["user_id"])

    cursor.execute("SELECT * FROM bookings WHERE budget_id = ? ORDER BY id DESC LIMIT 1;", (budget_id,))
    existing_booking = cursor.fetchone()
    if existing_booking and existing_booking["status"] != "En presupuesto":
        conn.close()
        return {
            "message": "Este presupuesto ya tiene una reserva activa.",
            "booking_id": existing_booking["id"],
            "booking_number": existing_booking["booking_number"],
        }

    if existing_booking:
        booking_id = existing_booking["id"]
        booking_number = existing_booking["booking_number"]
        cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE booking_id = ?;", (booking_id,))
        paid_amount = float(cursor.fetchone()[0] or 0)
        if paid_amount > total_amount + 0.009:
            conn.close()
            raise HTTPException(
                status_code=400,
                detail=f"El total actualizado ({total_amount:.2f}) no puede ser menor que los pagos ya registrados ({paid_amount:.2f})."
            )
        cursor.execute("""
            UPDATE bookings
            SET client_id = ?, user_id = ?, title = ?, destination = ?, start_date = ?, end_date = ?,
                currency = ?, status = 'Confirmada', total_amount = ?, paid_amount = ?, balance_due = ?,
                notes = ?
            WHERE id = ?;
        """, (
            budget["client_id"], user_id, budget["title"], budget["destination"],
            budget["start_date"], budget["end_date"], budget["currency"],
            total_amount, paid_amount, max(0.0, total_amount - paid_amount),
            f"Reactivada desde el presupuesto {budget['budget_number']}", booking_id,
        ))
        cursor.execute("UPDATE budgets SET status = 'Convertido', total_amount = ? WHERE id = ?;", (total_amount, budget_id))
        conn.commit()
        conn.close()
        return {
            "message": "Reserva reactivada con el historial de pagos conservado.",
            "booking_id": booking_id,
            "booking_number": booking_number,
            "payments_preserved": True,
        }

    year = datetime.now().year
    cursor.execute("SELECT COUNT(*) FROM bookings;")
    b_count = cursor.fetchone()[0] + 1
    booking_number = f"RES-{year}-{b_count:04d}"

    cursor.execute("""
        INSERT INTO bookings (booking_number, budget_id, client_id, user_id, title, destination, start_date, end_date, currency, status, total_amount, paid_amount, balance_due, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmada', ?, 0.0, ?, ?);
    """, (
        booking_number, budget["id"], budget["client_id"], user_id,
        budget["title"], budget["destination"], budget["start_date"], budget["end_date"],
        budget["currency"], total_amount, total_amount,
        f"Generado a partir del presupuesto {budget['budget_number']}"
    ))
    booking_id = cursor.lastrowid

    cursor.execute("UPDATE budgets SET status = 'Convertido', total_amount = ? WHERE id = ?;", (total_amount, budget_id))
    conn.commit()
    conn.close()

    return {"message": "Presupuesto convertido a Reserva exitosamente", "booking_id": booking_id, "booking_number": booking_number}

@router.post("/{budget_id}/revert-to-draft")
def revert_to_draft(budget_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM budgets WHERE id = ?;", (budget_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")

    cursor.execute("UPDATE budgets SET status = 'Borrador' WHERE id = ?;", (budget_id,))
    cursor.execute("UPDATE bookings SET status = 'En presupuesto' WHERE budget_id = ?;", (budget_id,))
    conn.commit()
    has_booking_history = cursor.rowcount > 0
    conn.close()

    return {"message": "Presupuesto revertido a borrador exitosamente", "payments_preserved": has_booking_history}

@router.delete("/{budget_id}")
def delete_budget(budget_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM budget_items WHERE budget_id = ?;", (budget_id,))
    cursor.execute("DELETE FROM budgets WHERE id = ?;", (budget_id,))
    conn.commit()
    conn.close()
    return {"message": "Presupuesto eliminado exitosamente"}
