from fastapi import APIRouter, Depends
from app.database import get_db_connection
from app.routers.users import get_current_user

router = APIRouter(prefix="/api/reports", tags=["Reports"])

@router.get("/dashboard")
def get_dashboard_metrics(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    booking_scope = "" if current_user.get("role") != "agente" else (
        " AND EXISTS (SELECT 1 FROM booking_sellers bs WHERE bs.booking_id = bookings.id AND bs.user_id = ?)"
    )
    booking_params = () if not booking_scope else (current_user.get("id"),)
    payment_scope = "" if current_user.get("role") != "agente" else (
        " AND EXISTS (SELECT 1 FROM booking_sellers bs WHERE bs.booking_id = bk.id AND bs.user_id = ?)"
    )
    payment_params = () if not payment_scope else (current_user.get("id"),)
    budget_scope = "" if current_user.get("role") != "agente" else (
        " WHERE EXISTS (SELECT 1 FROM budget_sellers bs WHERE bs.budget_id = budgets.id AND bs.user_id = ?)"
    )
    budget_params = () if not budget_scope else (current_user.get("id"),)

    # Total Bookings count & financial sums
    cursor.execute("""
        SELECT 
            COUNT(*) as total_bookings,
            COALESCE(SUM(total_amount), 0) as total_sales,
            COALESCE(SUM(paid_amount), 0) as total_collected,
            COALESCE(SUM(balance_due), 0) as total_pending
        FROM bookings
        WHERE status NOT IN ('Cancelada', 'En presupuesto')""" + booking_scope + ";",
        booking_params,
    )
    bk_stats = cursor.fetchone()

    cursor.execute("""
        SELECT COUNT(*)
        FROM bookings
        WHERE status NOT IN ('Cancelada', 'En presupuesto') AND balance_due > 0.009""" + booking_scope + ";",
        booking_params,
    )
    bookings_with_balance = cursor.fetchone()[0]

    cursor.execute("""
        SELECT COALESCE(SUM(p.amount), 0)
        FROM payments p
        JOIN bookings bk ON bk.id = p.booking_id
        WHERE substr(p.payment_date, 1, 7) = strftime('%Y-%m', 'now')""" + payment_scope + ";",
        payment_params,
    )
    month_collected = cursor.fetchone()[0]

    # Total Budgets
    cursor.execute("""
        SELECT 
            COUNT(*) as total_budgets,
            SUM(CASE WHEN status = 'Approved' OR status = 'Aprobado' OR status = 'Convertido' THEN 1 ELSE 0 END) as approved_budgets
        FROM budgets""" + budget_scope + ";",
        budget_params,
    )
    bg_stats = cursor.fetchone()

    # Total Clients
    cursor.execute("SELECT COUNT(*) FROM clients;")
    clients_count = cursor.fetchone()[0]

    # Total Suppliers
    cursor.execute("SELECT COUNT(*) FROM suppliers;")
    suppliers_count = cursor.fetchone()[0]

    # Recent 5 Payments
    cursor.execute("""
        SELECT p.*, c.name as client_name, bk.booking_number
        FROM payments p
        LEFT JOIN clients c ON p.client_id = c.id
        JOIN bookings bk ON p.booking_id = bk.id
        WHERE 1 = 1""" + payment_scope + " ORDER BY p.id DESC LIMIT 5;",
        payment_params,
    )
    recent_payments = [dict(p) for p in cursor.fetchall()]

    # Bookings by Status
    cursor.execute("""
        SELECT status, COUNT(*) as count
        FROM bookings
        WHERE status != 'En presupuesto'""" + booking_scope + " GROUP BY status;",
        booking_params,
    )
    bookings_by_status = {row["status"]: row["count"] for row in cursor.fetchall()}

    # Recent six calendar months collections (Ingresos de clientes)
    cursor.execute("""
        SELECT substr(p.payment_date, 1, 7) as month, bk.currency,
               COALESCE(SUM(p.amount), 0) as total
        FROM payments p
        JOIN bookings bk ON p.booking_id = bk.id
        WHERE substr(p.payment_date, 1, 7) >= strftime('%Y-%m', 'now', '-5 months', 'start of month')
        """ + payment_scope + " GROUP BY substr(p.payment_date, 1, 7), bk.currency ORDER BY month ASC;",
        payment_params,
    )
    monthly_collections = [dict(row) for row in cursor.fetchall()]

    # Recent six calendar months expenses (Egresos y pagos a proveedores)
    cursor.execute("""
        SELECT substr(spp.payment_date, 1, 7) as month, sp.currency,
               COALESCE(SUM(spp.amount), 0) as total
        FROM supplier_payments spp
        JOIN supplier_payables sp ON sp.id = spp.payable_id
        WHERE substr(spp.payment_date, 1, 7) >= strftime('%Y-%m', 'now', '-5 months', 'start of month')
        GROUP BY substr(spp.payment_date, 1, 7), sp.currency ORDER BY month ASC;
    """)
    monthly_expenses = [dict(row) for row in cursor.fetchall()]

    from datetime import date, timedelta
    today = date.today()

    # Supplier Payables Reminders (Cuentas vencidas o que vencen en los próximos 7 días)
    cursor.execute("""
        SELECT sp.id, sp.supplier_id, sp.concept, sp.invoice_number, sp.currency,
               sp.total_amount, sp.due_date, sp.issue_date,
               s.name as supplier_name,
               COALESCE(SUM(spp.amount), 0) as paid_amount
        FROM supplier_payables sp
        JOIN suppliers s ON s.id = sp.supplier_id
        LEFT JOIN supplier_payments spp ON spp.payable_id = sp.id
        GROUP BY sp.id;
    """)
    supplier_reminders = []
    for row in cursor.fetchall():
        total = float(row["total_amount"] or 0)
        paid = float(row["paid_amount"] or 0)
        balance = round(total - paid, 2)
        if balance > 0.009:
            try:
                due = date.fromisoformat(row["due_date"])
                if due <= today + timedelta(days=7):
                    status = "Vencido" if due < today else "Vence pronto"
                    supplier_reminders.append({
                        "id": row["id"],
                        "supplier_name": row["supplier_name"],
                        "concept": row["concept"],
                        "invoice_number": row["invoice_number"] or "-",
                        "currency": row["currency"] or "USD",
                        "total_amount": total,
                        "balance_due": balance,
                        "due_date": row["due_date"],
                        "status": status,
                        "days_diff": (due - today).days
                    })
            except (TypeError, ValueError):
                pass
    supplier_reminders.sort(key=lambda item: (item["days_diff"], item["supplier_name"]))

    # Grilla de Vencimientos de Pasaportes (próximos 6 meses o ya vencidos)
    cursor.execute("SELECT id, name, document_id, passport_number, passport_expiry, phone, email FROM clients WHERE passport_expiry IS NOT NULL AND passport_expiry != '';")
    passport_alerts = []
    six_months_ahead = today + timedelta(days=183)
    for c in cursor.fetchall():
        try:
            exp = date.fromisoformat(c["passport_expiry"])
            if exp <= six_months_ahead:
                days_left = (exp - today).days
                status = "Vencido" if days_left < 0 else ("Vence este mes" if days_left <= 30 else f"Vence en {round(days_left/30)} meses")
                passport_alerts.append({
                    "id": c["id"],
                    "name": c["name"],
                    "document_id": c["document_id"],
                    "passport_number": c["passport_number"] or "-",
                    "passport_expiry": c["passport_expiry"],
                    "phone": c["phone"] or "-",
                    "email": c["email"] or "-",
                    "days_left": days_left,
                    "status": status
                })
        except (TypeError, ValueError):
            pass
    passport_alerts.sort(key=lambda item: item["days_left"])

    # Grilla de Cumpleaños (dentro de los próximos 7 días)
    cursor.execute("SELECT id, name, document_id, birth_date, phone, email FROM clients WHERE birth_date IS NOT NULL AND birth_date != '';")
    birthday_alerts = []
    for c in cursor.fetchall():
        try:
            bdate = date.fromisoformat(c["birth_date"])
            try:
                bday_this_year = date(today.year, bdate.month, bdate.day)
            except ValueError:
                bday_this_year = date(today.year, 3, 1)

            if bday_this_year < today:
                try:
                    bday_target = date(today.year + 1, bdate.month, bdate.day)
                except ValueError:
                    bday_target = date(today.year + 1, 3, 1)
            else:
                bday_target = bday_this_year

            days_to_bday = (bday_target - today).days
            if 0 <= days_to_bday <= 7:
                turning_age = bday_target.year - bdate.year
                label = "¡Hoy!" if days_to_bday == 0 else ("Mañana" if days_to_bday == 1 else f"En {days_to_bday} días")
                birthday_alerts.append({
                    "id": c["id"],
                    "name": c["name"],
                    "document_id": c["document_id"],
                    "birth_date": c["birth_date"],
                    "phone": c["phone"] or "-",
                    "email": c["email"] or "-",
                    "days_to_bday": days_to_bday,
                    "turning_age": turning_age,
                    "label": label,
                    "birthday_formatted": f"{bdate.day:02d}/{bdate.month:02d}"
                })
        except (TypeError, ValueError):
            pass
    birthday_alerts.sort(key=lambda item: item["days_to_bday"])

    conn.close()

    return {
        "total_sales": bk_stats["total_sales"],
        "total_collected": bk_stats["total_collected"],
        "total_pending": bk_stats["total_pending"],
        "month_collected": float(month_collected),
        "collection_rate": round(float(bk_stats["total_collected"]) / float(bk_stats["total_sales"]) * 100, 2) if bk_stats["total_sales"] else 0.0,
        "bookings_with_balance": bookings_with_balance,
        "total_bookings": bk_stats["total_bookings"],
        "total_budgets": bg_stats["total_budgets"],
        "approved_budgets": bg_stats["approved_budgets"],
        "total_clients": clients_count,
        "total_suppliers": suppliers_count,
        "monthly_collections": monthly_collections,
        "monthly_expenses": monthly_expenses,
        "recent_payments": recent_payments,
        "bookings_by_status": bookings_by_status,
        "supplier_reminders": supplier_reminders,
        "passport_alerts": passport_alerts,
        "birthday_alerts": birthday_alerts
    }
