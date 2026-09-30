from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from pydantic import BaseModel
from app.database import get_db_connection
from app.routers.users import get_current_user

router = APIRouter(prefix="/api/profits", tags=["Profits"])

# ─── Schemas ─────────────────────────────────────────────────────────────────

class CommissionPaymentCreate(BaseModel):
    profit_id: int
    user_id: int
    amount: float
    payment_date: str
    payment_method: str
    notes: Optional[str] = ""

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

    paid_by_budget = {}
    cursor.execute("""
        SELECT bp.budget_id, COALESCE(SUM(cp.amount), 0) as paid_commissions
        FROM budget_profits bp
        LEFT JOIN commission_payments cp ON cp.profit_id = bp.id
        GROUP BY bp.budget_id;
    """)
    paid_by_budget = {row["budget_id"]: float(row["paid_commissions"]) for row in cursor.fetchall()}

    result = []
    totals_by_currency = {}
    for b in budgets:
        b_dict = dict(b)
        gross_profit = float(b["total_amount"]) - float(b["total_cost"])
        b_dict["gross_profit"] = gross_profit
        b_dict["margin_pct"] = round((gross_profit / float(b["total_amount"]) * 100), 2) if b["total_amount"] > 0 else 0.0
        paid = paid_by_budget.get(b["id"], 0.0)
        b_dict["paid_commissions"] = paid
        b_dict["pending_commissions"] = max(0.0, gross_profit - paid)

        result.append(b_dict)

        if b["status"] != "Rechazado":
            currency = b["currency"] or "USD"
            totals = totals_by_currency.setdefault(currency, {
                "total_cost": 0.0, "total_sale": 0.0,
                "gross_profit": 0.0, "paid_commissions": 0.0,
                "pending_commissions": 0.0
            })
            totals["total_cost"] += float(b["total_cost"])
            totals["total_sale"] += float(b["total_amount"])
            totals["gross_profit"] += gross_profit
            totals["paid_commissions"] += paid
            totals["pending_commissions"] += max(0.0, gross_profit - paid)

    # Legacy totals remain available; currency-separated totals avoid mixing currencies in the UI.
    totals = {key: sum(values[key] for values in totals_by_currency.values()) for key in (
        "total_cost", "total_sale", "gross_profit", "paid_commissions", "pending_commissions"
    )}

    conn.close()

    return {
        "budgets": result,
        "summary": {
            **totals,
            "by_currency": totals_by_currency
        }
    }

@router.get("/commissions")
def get_all_commissions(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    ensure_tables(conn)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT cp.*, u.full_name as user_name, u.role as user_role, bp.budget_id,
               b.budget_number, b.title as budget_title, b.currency
        FROM commission_payments cp
        JOIN budget_profits bp ON cp.profit_id = bp.id
        JOIN budgets b ON bp.budget_id = b.id
        JOIN users u ON cp.user_id = u.id
        ORDER BY cp.id DESC;
    """)
    commissions = cursor.fetchall()
    conn.close()
    return [dict(c) for c in commissions]

@router.post("/commissions")
def register_commission(payload: CommissionPaymentCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") not in ["admin", "contador"]:
        raise HTTPException(status_code=403, detail="Se requieren permisos de administrador o contador para registrar distribuciones")

    conn = get_db_connection()
    ensure_tables(conn)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT bp.id, bp.budget_id, b.total_amount, b.total_cost, b.status
        FROM budget_profits bp
        JOIN budgets b ON b.id = bp.budget_id
        WHERE bp.id = ?;
    """, (payload.profit_id,))
    profit = cursor.fetchone()
    if not profit:
        conn.close()
        raise HTTPException(status_code=404, detail="Registro de ganancia no encontrado")

    if payload.amount <= 0:
        conn.close()
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a 0")

    if profit["status"] not in ["Aprobado", "Convertido"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Solo se pueden distribuir ganancias de presupuestos aprobados o convertidos")

    gross_profit = float(profit["total_amount"]) - float(profit["total_cost"])
    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM commission_payments WHERE profit_id = ?;", (payload.profit_id,))
    already_paid = float(cursor.fetchone()[0])
    remaining = max(0.0, gross_profit - already_paid)
    if payload.amount > remaining + 1e-9:
        conn.close()
        raise HTTPException(status_code=400, detail=f"El pago supera la ganancia disponible ({remaining:.2f})")

    cursor.execute("SELECT id FROM users WHERE id = ? AND is_active = 1;", (payload.user_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Usuario no encontrado o inactivo")

    cursor.execute("""
        UPDATE budget_profits SET total_cost = ?, total_sale = ?, gross_profit = ? WHERE id = ?;
    """, (profit["total_cost"], profit["total_amount"], gross_profit, payload.profit_id))

    cursor.execute("""
        INSERT INTO commission_payments (profit_id, user_id, amount, payment_date, payment_method, notes)
        VALUES (?, ?, ?, ?, ?, ?);
    """, (payload.profit_id, payload.user_id, payload.amount, payload.payment_date, payload.payment_method, payload.notes or ""))
    conn.commit()

    cursor.execute("""
        SELECT cp.*, u.full_name as user_name
        FROM commission_payments cp
        JOIN users u ON cp.user_id = u.id
        WHERE cp.id = ?;
    """, (cursor.lastrowid,))
    result = cursor.fetchone()
    conn.close()
    return dict(result)

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

@router.delete("/commissions/{commission_id}")
def delete_commission(commission_id: int, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") not in ["admin", "contador"]:
        raise HTTPException(status_code=403, detail="Se requieren permisos de administrador")
    conn = get_db_connection()
    ensure_tables(conn)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM commission_payments WHERE id = ?;", (commission_id,))
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Pago de comisión no encontrado")
    conn.commit()
    conn.close()
    return {"message": "Comisión eliminada"}
