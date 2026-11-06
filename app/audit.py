import logging
from typing import Optional

from app.database import get_db_connection

logger = logging.getLogger("app.audit")


def record_activity(
    action: str,
    method: str,
    path: str,
    status_code: int,
    user: Optional[dict] = None,
    username: Optional[str] = None,
    role: Optional[str] = None,
    details: str = "",
) -> None:
    """Persist an activity event without storing request bodies or credentials.
    Guaranteed not to raise an exception or crash caller in case of DB locks/errors.
    """
    actor = user or {}
    conn = None
    try:
        conn = get_db_connection()
        conn.execute(
            """
            INSERT INTO activity_logs
                (user_id, username, role, action, method, path, status_code, details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (
                actor.get("id"),
                username or actor.get("username") or "Anónimo",
                role or actor.get("role") or "",
                action,
                method,
                path,
                status_code,
                details,
            ),
        )
        conn.commit()
    except Exception as e:
        logger.warning(f"Error persisting activity log ({action}): {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
