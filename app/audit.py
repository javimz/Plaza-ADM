from typing import Optional

from app.database import get_db_connection


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
    """Persist an activity event without storing request bodies or credentials."""
    actor = user or {}
    conn = get_db_connection()
    try:
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
    finally:
        conn.close()