from fastapi import APIRouter, HTTPException, Depends
from app.database import get_db_connection
from app.routers.users import get_current_user

router = APIRouter(prefix="/api/profits", tags=["Profits"])

def _require_profit_access(user: dict) -> None:
    if user.get("role") in ["agente", "administrativa"]:
        raise HTTPException(status_code=403, detail="No tiene permisos para consultar ganancias y comisiones")

# ─── Ensure profit table exists ──────────────────────────────────────────────

def ensure_tables(conn):
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS budget_profits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        budget_id INTEGER NOT NULL UNIQUE,
        total_cost REAL NOT NULL DEFAULT 0.0,
        total_sale REAL NOT NULL DEFAULT 0.0,
        gross_profit REAL NOT NULL DEFAULT 0.0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(budget_id) REFERENCES budgets(id) ON DELETE CASCADE
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS commission_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profit_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_date TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(profit_id) REFERENCES budget_profits(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)
    conn.commit()


def sync_profit_records(cursor):
    """Keep one profit record per budget, using budget totals as the source of truth."""
    cursor.execute("""
        INSERT INTO budget_profits (budget_id, total_cost, total_sale, gross_profit)
        SELECT id, total_cost, total_amount, total_amount - total_cost
        FROM budgets
        WHERE 1
        ON CONFLICT(budget_id) DO UPDATE SET
            total_cost = excluded.total_cost,
            total_sale = excluded.total_sale,
            gross_profit = excluded.gross_profit;
    """)

# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/summary")
def get_profits_summary(current_user: dict = Depends(get_current_user)):
    _require_profit_access(current_user)
    conn = get_db_connection()
    ensure_tables(conn)
    cursor = conn.cursor()
    sync_profit_records(cursor)
    conn.commit()

    # Get all budgets with their items and booking status
    cursor.execute("""
        SELECT 
            b.id, bp.id as profit_id, b.budget_number, b.title, b.destination, b.currency,
            b.total_cost, b.total_amount, b.status,
            c.name as client_name,
            bk.id as booking_id, bk.booking_number, bk.status as booking_status
        FROM budgets b
        JOIN budget_profits bp ON bp.budget_id = b.id
        LEFT JOIN clients c ON b.client_id = c.id
        LEFT JOIN bookings bk ON bk.id = (
            SELECT id FROM bookings WHERE budget_id = b.id ORDER BY id DESC LIMIT 1
        )
        ORDER BY b.id DESC;
    """)
    budgets = cursor.fetchall()

    cursor.execute("""
        SELECT sp.currency, COALESCE(SUM(spp.amount), 0) as supplier_payments
        FROM supplier_payables sp
        JOIN supplier_payments spp ON spp.payable_id = sp.id
        GROUP BY sp.currency;
    """)
    supplier_payments_by_currency = {
        row["currency"] or "USD": float(row["supplier_payments"] or 0)
        for row in cursor.fetchall()
    }

    cursor.execute("""
        SELECT COALESCE(sp.budget_id, linked_booking.budget_id) as budget_id,
               COALESCE(SUM(spp.amount), 0) as supplier_payments
        FROM supplier_payables sp
        LEFT JOIN bookings linked_booking ON linked_booking.id = sp.booking_id
        JOIN supplier_payments spp ON spp.payable_id = sp.id
        WHERE COALESCE(sp.budget_id, linked_booking.budget_id) IS NOT NULL
        GROUP BY COALESCE(sp.budget_id, linked_booking.budget_id);
    """)
    supplier_payments_by_budget = {
        row["budget_id"]: float(row["supplier_payments"] or 0)
        for row in cursor.fetchall()
    }

    cursor.execute("""
        SELECT COALESCE(sp.budget_id, linked_booking.budget_id) as budget_id,
               spp.id as payment_id, spp.payment_date, spp.amount, spp.payment_method,
               spp.reference, spp.notes, sp.invoice_number, sp.concept, sp.currency,
               supplier.name as supplier_name, linked_booking.booking_number
        FROM supplier_payables sp
        LEFT JOIN bookings linked_booking ON linked_booking.id = sp.booking_id
        JOIN supplier_payments spp ON spp.payable_id = sp.id
        JOIN suppliers supplier ON supplier.id = sp.supplier_id
        WHERE COALESCE(sp.budget_id, linked_booking.budget_id) IS NOT NULL
        ORDER BY spp.payment_date DESC, spp.id DESC;
    """)
    supplier_payment_details_by_budget = {}
    for row in cursor.fetchall():
        supplier_payment_details_by_budget.setdefault(row["budget_id"], []).append(dict(row))

    cursor.execute("""
         SELECT b.id as budget_id, p.id as payment_id, p.payment_number,
               p.payment_date, p.amount, p.payment_method, p.reference_code, p.notes,
             client.name as client_name, bk.booking_number, bk.currency
        FROM budgets b
        JOIN bookings bk ON bk.budget_id = b.id
        JOIN payments p ON p.booking_id = bk.id
        LEFT JOIN clients client ON client.id = p.client_id
        ORDER BY p.payment_date DESC, p.id DESC;
    """)
    customer_payment_details_by_budget = {}
    for row in cursor.fetchall():
        customer_payment_details_by_budget.setdefault(row["budget_id"], []).append(dict(row))

    result = []
    totals_by_currency = {}
    for b in budgets:
        b_dict = dict(b)
        supplier_paid = supplier_payments_by_budget.get(b["id"], 0.0)
        gross_profit = float(b["total_amount"]) - supplier_paid
        b_dict["gross_profit"] = gross_profit
        b_dict["supplier_payments"] = supplier_paid
        b_dict["supplier_payment_details"] = supplier_payment_details_by_budget.get(b["id"], [])
        b_dict["customer_payment_details"] = customer_payment_details_by_budget.get(b["id"], [])
        b_dict["net_profit"] = gross_profit
        b_dict["margin_pct"] = round((gross_profit / float(b["total_amount"]) * 100), 2) if b["total_amount"] > 0 else 0.0
        result.append(b_dict)

        if b["status"] != "Rechazado":
            currency = b["currency"] or "USD"
            totals = totals_by_currency.setdefault(currency, {
                "total_cost": 0.0, "total_sale": 0.0, "gross_profit": 0.0, "supplier_payments": 0.0
            })
            totals["total_cost"] += float(b["total_cost"])
            totals["total_sale"] += float(b["total_amount"])
            totals["supplier_payments"] += supplier_paid
            totals["gross_profit"] += gross_profit

    # Legacy totals remain available; currency-separated totals avoid mixing currencies in the UI.
    totals = {key: sum(values[key] for values in totals_by_currency.values()) for key in (
        "total_cost", "total_sale", "gross_profit"
    )}

    conn.close()

    return {
        "budgets": result,
        "summary": {
            **totals,
            "by_currency": totals_by_currency,
            "supplier_payments_by_currency": supplier_payments_by_currency,
        }
    }

@router.post("/ensure-profit/{budget_id}")
def ensure_profit_record(budget_id: int, current_user: dict = Depends(get_current_user)):
    """Create profit record for a budget if it doesn't exist."""
    conn = get_db_connection()
    ensure_tables(conn)
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM budgets WHERE id = ?;", (budget_id,))
    budget = cursor.fetchone()
    if not budget:
        conn.close()
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")

    cursor.execute("""
        INSERT INTO budget_profits (budget_id, total_cost, total_sale, gross_profit)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(budget_id) DO UPDATE SET
            total_cost = excluded.total_cost,
            total_sale = excluded.total_sale,
            gross_profit = excluded.gross_profit;
    """, (budget_id, float(budget["total_cost"]), float(budget["total_amount"]),
          float(budget["total_amount"]) - float(budget["total_cost"])))
    cursor.execute("SELECT id FROM budget_profits WHERE budget_id = ?;", (budget_id,))
    profit_id = cursor.fetchone()["id"]
    conn.commit()
    conn.close()
    return {"profit_id": profit_id, "message": "Creado exitosamente"}

