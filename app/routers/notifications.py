import json
import base64
import logging
from datetime import date, timedelta
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks
from pydantic import BaseModel, Field
from py_vapid import Vapid
from cryptography.hazmat.primitives import serialization
from pywebpush import webpush, WebPushException

from app.database import get_db_connection
from app.routers.users import get_current_user

logger = logging.getLogger("notifications")
router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    keys: PushKeys
    user_agent: Optional[str] = None


class PushSubscriptionDelete(BaseModel):
    endpoint: str


def get_or_create_vapid_keys(conn) -> tuple[str, str]:
    """Retrieves or generates persistent VAPID private PEM and public base64url keys."""
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM app_settings WHERE key IN ('vapid_private_pem', 'vapid_public_b64');")
    settings = dict(cursor.fetchall())

    if "vapid_private_pem" in settings and "vapid_public_b64" in settings:
        return settings["vapid_private_pem"], settings["vapid_public_b64"]

    # Generate new VAPID keys
    vapid = Vapid()
    vapid.generate_keys()
    private_pem = vapid.private_pem().decode("utf-8")
    pub_bytes = vapid.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint
    )
    public_b64 = base64.urlsafe_b64encode(pub_bytes).decode("utf-8").rstrip("=")

    cursor.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_private_pem', ?);", (private_pem,))
    cursor.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_public_b64', ?);", (public_b64,))
    conn.commit()

    return private_pem, public_b64


def get_upcoming_trip_alerts(cursor, today: date, window_days: int = 7) -> List[Dict[str, Any]]:
    """Fetches confirmed/active bookings departing in the next window_days (or today)."""
    max_date = (today + timedelta(days=window_days)).isoformat()
    today_str = today.isoformat()

    cursor.execute("""
        SELECT bk.id, bk.booking_number, bk.title, bk.destination, bk.start_date, bk.end_date,
               bk.currency, bk.total_amount, bk.paid_amount, bk.balance_due, bk.status,
               c.name as client_name, c.phone as client_phone
        FROM bookings bk
        LEFT JOIN clients c ON bk.client_id = c.id
        WHERE bk.status NOT IN ('Cancelada', 'En presupuesto')
          AND bk.start_date IS NOT NULL
          AND bk.start_date != ''
          AND bk.start_date >= ?
          AND bk.start_date <= ?
        ORDER BY bk.start_date ASC, bk.id ASC;
    """, (today_str, max_date))

    alerts = []
    for row in cursor.fetchall():
        item = dict(row)
        try:
            dep_date = date.fromisoformat(item["start_date"])
            days_left = (dep_date - today).days
        except Exception:
            days_left = 0
        item["days_left"] = days_left
        item["type"] = "trip_departure"
        alerts.append(item)
    return alerts


def get_supplier_payable_alerts(cursor, today: date, window_days: int = 7) -> List[Dict[str, Any]]:
    """Fetches supplier payables due within window_days (or already overdue) with pending balance."""
    max_date = (today + timedelta(days=window_days)).isoformat()

    cursor.execute("""
        SELECT sp.id, sp.concept, sp.invoice_number, sp.currency, sp.total_amount, sp.due_date,
               sp.booking_id, sp.notes, s.name as supplier_name, s.category as supplier_category,
               bk.booking_number,
               COALESCE((
                   SELECT SUM(spp.amount)
                   FROM supplier_payments spp
                   WHERE spp.payable_id = sp.id
               ), 0) as paid_amount
        FROM supplier_payables sp
        JOIN suppliers s ON s.id = sp.supplier_id
        LEFT JOIN bookings bk ON bk.id = sp.booking_id
        WHERE sp.due_date <= ?
        ORDER BY sp.due_date ASC, sp.id DESC;
    """, (max_date,))

    alerts = []
    for row in cursor.fetchall():
        item = dict(row)
        balance = max(0.0, float(item["total_amount"]) - float(item["paid_amount"]))
        if balance > 0.009:
            try:
                due = date.fromisoformat(item["due_date"])
                days_left = (due - today).days
            except Exception:
                days_left = 0
            item["balance_due"] = balance
            item["days_left"] = days_left
            item["is_overdue"] = days_left < 0
            item["type"] = "supplier_payable"
            alerts.append(item)
    return alerts


def send_single_push(subscription: Dict[str, Any], payload: Dict[str, Any], private_pem: str) -> bool:
    """Sends a single Web Push notification. Cleans up invalid/expired subscriptions."""
    sub_info = {
        "endpoint": subscription["endpoint"],
        "keys": {
            "p256dh": subscription["p256dh"],
            "auth": subscription["auth"]
        }
    }
    payload_json = json.dumps(payload, ensure_ascii=False)
    vapid_claims = {"sub": "mailto:administracion@plazabohemia.com"}

    try:
        vapid_obj = Vapid.from_pem(private_pem.encode("utf-8"))
        webpush(
            subscription_info=sub_info,
            data=payload_json,
            vapid_private_key=vapid_obj,
            vapid_claims=vapid_claims,
            timeout=10,
            ttl=86400
        )
        return True
    except WebPushException as ex:
        # If subscription is gone or expired (404/410), delete from DB
        status_code = getattr(ex.response, "status_code", None) if hasattr(ex, "response") else None
        if status_code in (404, 410):
            try:
                conn = get_db_connection()
                conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?;", (subscription["endpoint"],))
                conn.commit()
                conn.close()
            except Exception:
                pass
        logger.warning(f"WebPush failed for endpoint {subscription['endpoint'][:30]}...: {ex}")
        return False
    except Exception as e:
        logger.warning(f"Error sending push: {e}")
        return False


def dispatch_alerts_to_all_subscribers(conn, trip_alerts: List[Dict[str, Any]], supplier_alerts: List[Dict[str, Any]]) -> int:
    """Builds and sends push notifications for all active alerts to all subscribers."""
    cursor = conn.cursor()
    cursor.execute("SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions;")
    subscribers = [dict(row) for row in cursor.fetchall()]
    if not subscribers:
        return 0

    private_pem, _ = get_or_create_vapid_keys(conn)
    sent_count = 0

    # 1. Upcoming trip departures
    for trip in trip_alerts:
        days_desc = "HOY" if trip["days_left"] == 0 else (f"en {trip['days_left']} días" if trip["days_left"] > 0 else f"hace {-trip['days_left']} días")
        balance_info = f" · Saldo pendiente: ${trip['balance_due']:,.2f}" if trip.get("balance_due", 0) > 0.01 else " · 100% Cobrado"
        title = f"✈️ Salida Cercana ({days_desc}): {trip['booking_number']}"
        body = f"{trip['title']} ({trip['destination']}) - Cliente: {trip['client_name']}{balance_info}"
        payload = {
            "title": title,
            "body": body,
            "icon": "/static/img/logo.png",
            "badge": "/static/img/logo.png",
            "tag": f"trip-departure-{trip['id']}",
            "data": {
                "url": f"/#booking-{trip['id']}",
                "type": "trip_departure",
                "id": trip["id"]
            }
        }
        for sub in subscribers:
            if send_single_push(sub, payload, private_pem):
                sent_count += 1

    # 2. Supplier due dates
    for sp in supplier_alerts:
        if sp.get("is_overdue"):
            due_desc = f"VENCIDA hace {-sp['days_left']} días"
            icon_emoji = "🚨"
        elif sp["days_left"] == 0:
            due_desc = "VENCE HOY"
            icon_emoji = "⚠️"
        else:
            due_desc = f"vence en {sp['days_left']} días ({sp['due_date']})"
            icon_emoji = "💳"

        title = f"{icon_emoji} Vencimiento Proveedor ({due_desc})"
        body = f"{sp['supplier_name']}: {sp['concept']} · Saldo: {sp['currency']} ${sp['balance_due']:,.2f}"
        payload = {
            "title": title,
            "body": body,
            "icon": "/static/img/logo.png",
            "badge": "/static/img/logo.png",
            "tag": f"supplier-due-{sp['id']}",
            "data": {
                "url": "/#supplier-payables",
                "type": "supplier_payable",
                "id": sp["id"]
            }
        }
        for sub in subscribers:
            if send_single_push(sub, payload, private_pem):
                sent_count += 1

    return sent_count


@router.get("/vapid-public-key")
def get_vapid_public_key():
    """Returns the application server VAPID public key for web push subscription."""
    conn = get_db_connection()
    try:
        _, public_b64 = get_or_create_vapid_keys(conn)
        return {"public_key": public_b64}
    finally:
        conn.close()


@router.post("/subscribe")
def subscribe_push(payload: PushSubscriptionCreate, request: Request, current_user: dict = Depends(get_current_user)):
    """Registers or updates a push subscription for the logged-in user."""
    user_agent = payload.user_agent or request.headers.get("user-agent", "")
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                user_id = excluded.user_id,
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                user_agent = excluded.user_agent,
                created_at = CURRENT_TIMESTAMP;
        """, (current_user.get("id"), payload.endpoint, payload.keys.p256dh, payload.keys.auth, user_agent))
        conn.commit()
        return {"status": "ok", "message": "Dispositivo suscrito a notificaciones push exitosamente."}
    finally:
        conn.close()


@router.delete("/subscribe")
def unsubscribe_push(payload: PushSubscriptionDelete):
    """Removes a push subscription endpoint."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM push_subscriptions WHERE endpoint = ?;", (payload.endpoint,))
        conn.commit()
        return {"status": "ok", "message": "Suscripción eliminada."}
    finally:
        conn.close()


@router.get("/summary")
def get_notifications_summary(current_user: dict = Depends(get_current_user)):
    """Returns the list of current pending alerts for 7-day upcoming departures and supplier due dates."""
    today = date.today()
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        trip_alerts = get_upcoming_trip_alerts(cursor, today, window_days=7)
        supplier_alerts = get_supplier_payable_alerts(cursor, today, window_days=7)

        cursor.execute("SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?;", (current_user.get("id"),))
        user_subs_count = cursor.fetchone()[0]

        return {
            "as_of": today.isoformat(),
            "trip_departures": trip_alerts,
            "supplier_payables": supplier_alerts,
            "total_alerts": len(trip_alerts) + len(supplier_alerts),
            "user_has_active_push_subscription": user_subs_count > 0,
        }
    finally:
        conn.close()


@router.post("/test")
def send_test_notification(current_user: dict = Depends(get_current_user)):
    """Sends an immediate test push notification to the current user's registered devices."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?;", (current_user.get("id"),))
        subscribers = [dict(row) for row in cursor.fetchall()]

        if not subscribers:
            raise HTTPException(
                status_code=400,
                detail="No tienes dispositivos registrados para notificaciones push en este navegador/celular. Activa las notificaciones primero."
            )

        private_pem, _ = get_or_create_vapid_keys(conn)
        payload = {
            "title": "🔔 Notificación de Prueba · Plaza Bohemia",
            "body": f"¡Hola {current_user.get('full_name', current_user.get('username'))}! Las notificaciones push en tu celular están funcionando correctamente.",
            "icon": "/static/img/logo.png",
            "badge": "/static/img/logo.png",
            "tag": "test-push",
            "data": {
                "url": "/#dashboard",
                "type": "test"
            }
        }

        sent = sum(1 for sub in subscribers if send_single_push(sub, payload, private_pem))
        return {
            "status": "ok",
            "devices_targeted": len(subscribers),
            "devices_sent": sent,
            "message": f"Notificación de prueba enviada a {sent} dispositivo(s)."
        }
    finally:
        conn.close()


@router.post("/send-alerts")
def trigger_send_alerts(background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """Scans and pushes all 7-day upcoming departures and supplier due date alerts."""
    today = date.today()
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        trip_alerts = get_upcoming_trip_alerts(cursor, today, window_days=7)
        supplier_alerts = get_supplier_payable_alerts(cursor, today, window_days=7)
        total_alerts = len(trip_alerts) + len(supplier_alerts)

        if total_alerts == 0:
            return {"status": "ok", "message": "No hay alertas pendientes para los próximos 7 días.", "sent": 0}

        sent_count = dispatch_alerts_to_all_subscribers(conn, trip_alerts, supplier_alerts)
        return {
            "status": "ok",
            "trip_alerts_count": len(trip_alerts),
            "supplier_alerts_count": len(supplier_alerts),
            "sent_notifications": sent_count,
            "message": f"Se procesaron {total_alerts} alerta(s) y se enviaron {sent_count} notificación(es) push a los celulares registrados."
        }
    finally:
        conn.close()
