from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db_connection
from app.routers.users import get_current_user

router = APIRouter(prefix="/api/supplier-payables", tags=["Supplier Payables"])


class SupplierPayableCreate(BaseModel):
    supplier_id: int
    concept: str = Field(min_length=1, max_length=200)
    invoice_number: Optional[str] = ""
    currency: str = "USD"
    total_amount: float = Field(gt=0)
    issue_date: str
    due_date: str
    notes: Optional[str] = ""


class SupplierPaymentCreate(BaseModel):
    amount: float = Field(gt=0)
    payment_date: str
    payment_method: str = Field(min_length=1, max_length=80)
    reference: Optional[str] = ""
    notes: Optional[str] = ""


def _require_finance_role(user: dict) -> None:
    if user.get("role") not in ["admin", "contador"]:
        raise HTTPException(status_code=403, detail="Solo administración o contabilidad puede gestionar pagos a proveedores")


def _validate_iso_date(value: str, label: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"La fecha de {label} no es válida")


def _status_for(balance: float, due_date: str, today: date) -> str:
    if balance <= 0.009:
        return "Pagado"
    due = _validate_iso_date(due_date, "vencimiento")
    if due < today:
        return "Vencido"
    if due <= today + timedelta(days=7):
        return "Vence pronto"
    if balance < 0:
        return "Pagado"
    return "Parcial"


def _load_payables(cursor, today: date):
    cursor.execute("""
        SELECT sp.*, s.name as supplier_name, s.category as supplier_category,
               COALESCE(SUM(spp.amount), 0) as paid_amount,
               COUNT(spp.id) as payment_count,
               MAX(spp.payment_date) as last_payment_date
        FROM supplier_payables sp
        JOIN suppliers s ON s.id = sp.supplier_id
        LEFT JOIN supplier_payments spp ON spp.payable_id = sp.id
        GROUP BY sp.id
        ORDER BY sp.due_date ASC, sp.id DESC;
    """)
    result = []
    for row in cursor.fetchall():
        item = dict(row)
        item["paid_amount"] = float(item["paid_amount"] or 0)
        item["balance_due"] = max(0.0, float(item["total_amount"]) - item["paid_amount"])
        item["status"] = _status_for(item["balance_due"], item["due_date"], today)
        result.append(item)
    return result


@router.get("/summary")
def get_supplier_payables_summary(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    try:
        items = _load_payables(conn.cursor(), date.today())
        totals_by_currency = {}
        for item in items:
            currency = item["currency"] or "USD"
            totals = totals_by_currency.setdefault(currency, {
                "total_amount": 0.0,
                "paid_amount": 0.0,
                "balance_due": 0.0,
                "overdue_balance": 0.0,
                "due_soon_balance": 0.0,
                "count": 0,
                "overdue_count": 0,
                "due_soon_count": 0,
            })
            totals["total_amount"] += float(item["total_amount"])
            totals["paid_amount"] += item["paid_amount"]
            totals["balance_due"] += item["balance_due"]
            totals["count"] += 1
            if item["status"] == "Vencido":
                totals["overdue_balance"] += item["balance_due"]
                totals["overdue_count"] += 1
            elif item["status"] == "Vence pronto":
                totals["due_soon_balance"] += item["balance_due"]
                totals["due_soon_count"] += 1
        today = date.today()
        reminders = [item for item in items if item["status"] in ("Vencido", "Vence pronto")]
        return {
            "by_currency": totals_by_currency,
            "payables": items,
            "reminders": reminders,
            "reminder_window_days": 7,
            "as_of": today.isoformat(),
        }
    finally:
        conn.close()


@router.get("")
def get_supplier_payables(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    try:
        return _load_payables(conn.cursor(), date.today())
    finally:
        conn.close()


@router.get("/{payable_id}")
def get_supplier_payable(payable_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        items = _load_payables(cursor, date.today())
        payable = next((item for item in items if item["id"] == payable_id), None)
        if not payable:
            raise HTTPException(status_code=404, detail="Cuenta por pagar no encontrada")
        cursor.execute("""
            SELECT spp.*, u.full_name as registered_by_name
            FROM supplier_payments spp
            LEFT JOIN users u ON u.id = spp.registered_by_user_id
            WHERE spp.payable_id = ?
            ORDER BY spp.payment_date DESC, spp.id DESC;
        """, (payable_id,))
        payable["payments"] = [dict(row) for row in cursor.fetchall()]
        return payable
    finally:
        conn.close()


@router.post("")
def create_supplier_payable(payload: SupplierPayableCreate, current_user: dict = Depends(get_current_user)):
    _require_finance_role(current_user)
    issue_date = _validate_iso_date(payload.issue_date, "emisión")
    due_date = _validate_iso_date(payload.due_date, "vencimiento")
    if due_date < issue_date:
        raise HTTPException(status_code=400, detail="El vencimiento no puede ser anterior a la fecha de emisión")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM suppliers WHERE id = ?;", (payload.supplier_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Proveedor no encontrado")
        cursor.execute("""
            INSERT INTO supplier_payables
                (supplier_id, concept, invoice_number, currency, total_amount, issue_date, due_date, notes, created_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            payload.supplier_id, payload.concept.strip(), payload.invoice_number or "",
            payload.currency or "USD", payload.total_amount, issue_date.isoformat(), due_date.isoformat(),
            payload.notes or "", current_user.get("id"),
        ))
        payable_id = cursor.lastrowid
        conn.commit()
        item = next(row for row in _load_payables(cursor, date.today()) if row["id"] == payable_id)
        item["payments"] = []
        return item
    finally:
        conn.close()


@router.post("/{payable_id}/payments")
def register_supplier_payment(
    payable_id: int,
    payload: SupplierPaymentCreate,
    current_user: dict = Depends(get_current_user),
):
    _require_finance_role(current_user)
    payment_date = _validate_iso_date(payload.payment_date, "pago")
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, total_amount FROM supplier_payables WHERE id = ?;", (payable_id,))
        payable = cursor.fetchone()
        if not payable:
            raise HTTPException(status_code=404, detail="Cuenta por pagar no encontrada")
        cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE payable_id = ?;", (payable_id,))
        paid_amount = float(cursor.fetchone()[0] or 0)
        balance = max(0.0, float(payable["total_amount"]) - paid_amount)
        if payload.amount > balance + 1e-9:
            raise HTTPException(status_code=400, detail=f"El pago supera el saldo pendiente ({balance:.2f})")
        cursor.execute("""
            INSERT INTO supplier_payments
                (payable_id, amount, payment_date, payment_method, reference, notes, registered_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?);
        """, (
            payable_id, payload.amount, payment_date.isoformat(), payload.payment_method,
            payload.reference or "", payload.notes or "", current_user.get("id"),
        ))
        conn.commit()
        return get_supplier_payable(payable_id, current_user)
    finally:
        conn.close()


@router.delete("/{payable_id}/payments/{payment_id}")
def delete_supplier_payment(
    payable_id: int,
    payment_id: int,
    current_user: dict = Depends(get_current_user),
):
    _require_finance_role(current_user)
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM supplier_payments WHERE id = ? AND payable_id = ?;", (payment_id, payable_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Pago de proveedor no encontrado")
        conn.commit()
        return {"message": "Pago anulado"}
    finally:
        conn.close()
