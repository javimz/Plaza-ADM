from fastapi import APIRouter, Depends
from app.database import get_db_connection
from app.routers.users import get_current_user

router = APIRouter(prefix="/api/reports", tags=["Reports"])

@router.get("/dashboard")
def get_dashboard_metrics(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    # Total Bookings count & financial sums
    cursor.execute("""
        SELECT 
            COUNT(*) as total_bookings,
            COALESCE(SUM(total_amount), 0) as total_sales,
            COALESCE(SUM(paid_amount), 0) as total_collected,
            COALESCE(SUM(balance_due), 0) as total_pending
        FROM bookings
        WHERE status != 'Cancelada';
    """)
    bk_stats = cursor.fetchone()

    cursor.execute("""
        SELECT COUNT(*)
        FROM bookings
        WHERE status != 'Cancelada' AND balance_due > 0.009;
    """)
    bookings_with_balance = cursor.fetchone()[0]

    cursor.execute("""
        SELECT COALESCE(SUM(p.amount), 0)
        FROM payments p
        WHERE substr(p.payment_date, 1, 7) = strftime('%Y-%m', 'now');
    """)
    month_collected = cursor.fetchone()[0]

    # Total Budgets
    cursor.execute("""
        SELECT 
            COUNT(*) as total_budgets,
            SUM(CASE WHEN status = 'Approved' OR status = 'Aprobado' OR status = 'Convertido' THEN 1 ELSE 0 END) as approved_budgets
        FROM budgets;
    """)
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
        LEFT JOIN bookings bk ON p.booking_id = bk.id
        ORDER BY p.id DESC LIMIT 5;
    """)
    recent_payments = [dict(p) for p in cursor.fetchall()]

    # Bookings by Status
    cursor.execute("""
        SELECT status, COUNT(*) as count
        FROM bookings
        GROUP BY status;
    """)
    bookings_by_status = {row["status"]: row["count"] for row in cursor.fetchall()}

    # Recent six calendar months, kept separate by currency.
    cursor.execute("""
        SELECT substr(p.payment_date, 1, 7) as month, bk.currency,
               COALESCE(SUM(p.amount), 0) as total
        FROM payments p
        LEFT JOIN bookings bk ON p.booking_id = bk.id
        WHERE substr(p.payment_date, 1, 7) >= strftime('%Y-%m', 'now', '-5 months', 'start of month')
        GROUP BY substr(p.payment_date, 1, 7), bk.currency
        ORDER BY month ASC;
    """)
    monthly_collections = [dict(row) for row in cursor.fetchall()]

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
        "recent_payments": recent_payments,
        "bookings_by_status": bookings_by_status
    }
