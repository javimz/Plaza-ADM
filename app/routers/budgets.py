from fastapi import APIRouter, HTTPException, Depends
from typing import List
from datetime import datetime
from app.database import get_db_connection
from app.schemas import BudgetCreate, BudgetOut
from app.routers.users import get_current_user
from app.sales_assignments import (
    get_client_ids,
    get_seller_ids,
    initial_seller_ids,
    require_current_agent_assignment,
    require_sales_assignment,
    set_client_ids,
    set_seller_ids,
    validate_client_ids,
    validate_seller_ids,
)

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
        SELECT b.*, c.name as client_name, u.full_name as user_name,
               bk.id as booking_id, bk.booking_number
        FROM budgets b
        LEFT JOIN clients c ON b.client_id = c.id
        LEFT JOIN users u ON b.user_id = u.id
        LEFT JOIN bookings bk ON bk.id = (
            SELECT id FROM bookings WHERE budget_id = b.id ORDER BY id DESC LIMIT 1
        )
        WHERE (? != 'agente' OR EXISTS (
            SELECT 1 FROM budget_sellers bs WHERE bs.budget_id = b.id AND bs.user_id = ?
        ))
        ORDER BY b.id DESC;
    """, (current_user.get("role"), current_user.get("id")))
    budgets = cursor.fetchall()

    result = []
    for b in budgets:
        b_dict = dict(b)
        b_dict["seller_ids"] = get_seller_ids(cursor, "budget", b["id"])
        if b_dict["seller_ids"]:
            placeholders = ",".join("?" for _ in b_dict["seller_ids"])
            cursor.execute(f"SELECT full_name FROM users WHERE id IN ({placeholders}) ORDER BY full_name;", b_dict["seller_ids"])
            b_dict["seller_names"] = [row["full_name"] for row in cursor.fetchall()]
        else:
            b_dict["seller_names"] = []

        b_dict["client_ids"] = get_client_ids(cursor, "budget", b["id"])
        if not b_dict["client_ids"] and b["client_id"]:
            b_dict["client_ids"] = [b["client_id"]]
        if b_dict["client_ids"]:
            c_placeholders = ",".join("?" for _ in b_dict["client_ids"])
            cursor.execute(f"SELECT name FROM clients WHERE id IN ({c_placeholders}) ORDER BY name;", b_dict["client_ids"])
            b_dict["client_names"] = [row["name"] for row in cursor.fetchall()]
            if b_dict["client_names"]:
                b_dict["client_name"] = ", ".join(b_dict["client_names"])
        else:
            b_dict["client_names"] = []

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
        SELECT b.*, c.name as client_name, u.full_name as user_name,
               bk.id as booking_id, bk.booking_number
        FROM budgets b
        LEFT JOIN clients c ON b.client_id = c.id
        LEFT JOIN users u ON b.user_id = u.id
        LEFT JOIN bookings bk ON bk.id = (
            SELECT id FROM bookings WHERE budget_id = b.id ORDER BY id DESC LIMIT 1
        )
        WHERE b.id = ?;
    """, (budget_id,))
    b = cursor.fetchone()
    if not b:
        conn.close()
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
    require_sales_assignment(cursor, "budget", budget_id, current_user)

    b_dict = dict(b)
    b_dict["seller_ids"] = get_seller_ids(cursor, "budget", budget_id)
    if b_dict["seller_ids"]:
        placeholders = ",".join("?" for _ in b_dict["seller_ids"])
        cursor.execute(f"SELECT full_name FROM users WHERE id IN ({placeholders}) ORDER BY full_name;", b_dict["seller_ids"])
        b_dict["seller_names"] = [row["full_name"] for row in cursor.fetchall()]
    else:
        b_dict["seller_names"] = []

    b_dict["client_ids"] = get_client_ids(cursor, "budget", budget_id)
    if not b_dict["client_ids"] and b["client_id"]:
        b_dict["client_ids"] = [b["client_id"]]
    if b_dict["client_ids"]:
        c_placeholders = ",".join("?" for _ in b_dict["client_ids"])
        cursor.execute(f"SELECT name FROM clients WHERE id IN ({c_placeholders}) ORDER BY name;", b_dict["client_ids"])
        b_dict["client_names"] = [row["name"] for row in cursor.fetchall()]
        if b_dict["client_names"]:
            b_dict["client_name"] = ", ".join(b_dict["client_names"])
    else:
        b_dict["client_names"] = []

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

def _convert_budget_to_booking_internal(cursor, budget_id: int, current_user: dict):
    cursor.execute("SELECT * FROM budgets WHERE id = ?;", (budget_id,))
    budget = cursor.fetchone()
    if not budget:
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")

    cursor.execute("SELECT SUM(subtotal) FROM budget_items WHERE budget_id = ?;", (budget_id,))
    items_sum = cursor.fetchone()[0]
    total_amount = float(items_sum) if (items_sum is not None and items_sum > 0) else float(budget["total_amount"])

    user_id = current_user.get("id", budget["user_id"])
    budget_client_ids = get_client_ids(cursor, "budget", budget_id)
    if not budget_client_ids and budget["client_id"]:
        budget_client_ids = [budget["client_id"]]

    cursor.execute("SELECT * FROM bookings WHERE budget_id = ? ORDER BY id DESC LIMIT 1;", (budget_id,))
    existing_booking = cursor.fetchone()
    if existing_booking and existing_booking["status"] != "En presupuesto":
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
        set_seller_ids(cursor, "booking", booking_id, get_seller_ids(cursor, "budget", budget_id))
        if budget_client_ids:
            set_client_ids(cursor, "booking", booking_id, budget_client_ids)
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
    set_seller_ids(cursor, "booking", booking_id, get_seller_ids(cursor, "budget", budget_id))
    if budget_client_ids:
        set_client_ids(cursor, "booking", booking_id, budget_client_ids)

    cursor.execute("UPDATE budgets SET status = 'Convertido', total_amount = ? WHERE id = ?;", (total_amount, budget_id))
    return {"message": "Presupuesto convertido a Reserva exitosamente", "booking_id": booking_id, "booking_number": booking_number}

@router.post("", response_model=BudgetOut)
def create_budget(payload: BudgetCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    budget_number = generate_budget_number(conn)
    user_id = current_user.get("id", 1)
    seller_ids = initial_seller_ids(cursor, payload.seller_ids, current_user)

    raw_client_ids = payload.client_ids if payload.client_ids is not None else ([payload.client_id] if payload.client_id else [])
    client_ids = validate_client_ids(cursor, raw_client_ids)
    primary_client_id = client_ids[0]

    total_cost = sum(item.cost_price * item.quantity for item in payload.items)
    total_amount = sum(item.sale_price * item.quantity for item in payload.items)

    cursor.execute("""
        INSERT INTO budgets (budget_number, client_id, user_id, title, destination, start_date, end_date, currency, exchange_rate, status, total_cost, total_amount, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, (
        budget_number, primary_client_id, user_id, payload.title, payload.destination,
        payload.start_date or "", payload.end_date or "", payload.currency or "USD",
        payload.exchange_rate or 1.0, payload.status or "Borrador",
        total_cost, total_amount, payload.notes or ""
    ))
    budget_id = cursor.lastrowid
    set_seller_ids(cursor, "budget", budget_id, seller_ids)
    set_client_ids(cursor, "budget", budget_id, client_ids)

    for item in payload.items:
        subtotal = item.sale_price * item.quantity
        cursor.execute("""
            INSERT INTO budget_items (budget_id, service_type, description, supplier_id, cost_price, sale_price, quantity, subtotal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        """, (budget_id, item.service_type, item.description, item.supplier_id, item.cost_price, item.sale_price, item.quantity, subtotal))

    if payload.status in ["Convertido", "Convertido a Reserva"]:
        _convert_budget_to_booking_internal(cursor, budget_id, current_user)

    conn.commit()
    conn.close()
    return get_budget(budget_id, current_user)

@router.put("/{budget_id}", response_model=BudgetOut)
def update_budget(budget_id: int, payload: BudgetCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT status FROM budgets WHERE id = ?;", (budget_id,))
    existing = cursor.fetchone()
    if not existing:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
    require_sales_assignment(cursor, "budget", budget_id, current_user)
    cursor.execute("SELECT 1 FROM bookings WHERE budget_id = ? AND status != 'En presupuesto' LIMIT 1;", (budget_id,))
    if (existing["status"] == "Convertido" or cursor.fetchone()) and payload.status not in ["Convertido", "Convertido a Reserva"]:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=409, detail="Este presupuesto está en reserva. Reviértalo a presupuesto antes de modificarlo.")

    raw_client_ids = payload.client_ids if payload.client_ids is not None else ([payload.client_id] if payload.client_id else [])
    client_ids = validate_client_ids(cursor, raw_client_ids)
    primary_client_id = client_ids[0]

    total_cost = sum(item.cost_price * item.quantity for item in payload.items)
    total_amount = sum(item.sale_price * item.quantity for item in payload.items)

    cursor.execute("""
        UPDATE budgets 
        SET client_id = ?, title = ?, destination = ?, start_date = ?, end_date = ?, currency = ?, exchange_rate = ?, status = ?, total_cost = ?, total_amount = ?, notes = ?
        WHERE id = ?;
    """, (
        primary_client_id, payload.title, payload.destination, payload.start_date or "",
        payload.end_date or "", payload.currency or "USD", payload.exchange_rate or 1.0,
        payload.status or "Borrador", total_cost, total_amount, payload.notes or "", budget_id
    ))

    cursor.execute("DELETE FROM budget_items WHERE budget_id = ?;", (budget_id,))
    set_client_ids(cursor, "budget", budget_id, client_ids)
    if payload.seller_ids is not None:
        seller_ids = validate_seller_ids(cursor, payload.seller_ids)
        require_current_agent_assignment(seller_ids, current_user)
        set_seller_ids(cursor, "budget", budget_id, seller_ids)
    for item in payload.items:
        subtotal = item.sale_price * item.quantity
        cursor.execute("""
            INSERT INTO budget_items (budget_id, service_type, description, supplier_id, cost_price, sale_price, quantity, subtotal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        """, (budget_id, item.service_type, item.description, item.supplier_id, item.cost_price, item.sale_price, item.quantity, subtotal))

    if payload.status in ["Convertido", "Convertido a Reserva"]:
        _convert_budget_to_booking_internal(cursor, budget_id, current_user)

    conn.commit()
    conn.close()
    return get_budget(budget_id, current_user)

@router.post("/{budget_id}/convert-to-booking")
def convert_to_booking(budget_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    require_sales_assignment(cursor, "budget", budget_id, current_user)

    res = _convert_budget_to_booking_internal(cursor, budget_id, current_user)
    conn.commit()
    conn.close()
    return res

@router.post("/{budget_id}/revert-to-draft")
def revert_to_draft(budget_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM budgets WHERE id = ?;", (budget_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
    require_sales_assignment(cursor, "budget", budget_id, current_user)

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
    cursor.execute("SELECT status FROM budgets WHERE id = ?;", (budget_id,))
    budget = cursor.fetchone()
    if not budget:
        conn.close()
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
    require_sales_assignment(cursor, "budget", budget_id, current_user)
    cursor.execute("SELECT 1 FROM bookings WHERE budget_id = ? AND status != 'En presupuesto' LIMIT 1;", (budget_id,))
    if budget["status"] == "Convertido" or cursor.fetchone():
        cursor.close()
        conn.close()
        raise HTTPException(status_code=409, detail="Este presupuesto está en reserva. Reviértalo a presupuesto antes de eliminarlo.")
    
    # Also clean up any bookings (e.g. 'En presupuesto' status) and related rows for this budget
    cursor.execute("""
        DELETE FROM supplier_payments
        WHERE payable_id IN (SELECT id FROM supplier_payables WHERE budget_id = ? OR booking_id IN (SELECT id FROM bookings WHERE budget_id = ?));
    """, (budget_id, budget_id))
    cursor.execute("DELETE FROM supplier_payables WHERE budget_id = ? OR booking_id IN (SELECT id FROM bookings WHERE budget_id = ?);", (budget_id, budget_id))
    cursor.execute("DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE budget_id = ?);", (budget_id,))
    cursor.execute("DELETE FROM booking_clients WHERE booking_id IN (SELECT id FROM bookings WHERE budget_id = ?);", (budget_id,))
    cursor.execute("DELETE FROM booking_sellers WHERE booking_id IN (SELECT id FROM bookings WHERE budget_id = ?);", (budget_id,))
    cursor.execute("DELETE FROM bookings WHERE budget_id = ?;", (budget_id,))
    cursor.execute("DELETE FROM budget_items WHERE budget_id = ?;", (budget_id,))
    cursor.execute("DELETE FROM budget_clients WHERE budget_id = ?;", (budget_id,))
    cursor.execute("DELETE FROM budget_sellers WHERE budget_id = ?;", (budget_id,))
    cursor.execute("DELETE FROM budgets WHERE id = ?;", (budget_id,))
    conn.commit()
    conn.close()
    return {"message": "Presupuesto eliminado exitosamente"}
