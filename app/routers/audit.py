from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_db_connection
from app.routers.users import get_current_user


router = APIRouter(prefix="/api/audit", tags=["Activity Audit"])


@router.get("")
def get_activity_logs(
    limit: int = Query(500, ge=1, le=1000),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo los administradores generales pueden consultar el log de actividad")

    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, user_id, username, role, action, method, path,
                   status_code, details, created_at
            FROM activity_logs
            ORDER BY id DESC
            LIMIT ?;
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


@router.delete("")
def clear_activity_logs(
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo los administradores generales pueden vaciar el log de actividad")

    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM activity_logs;")
        conn.commit()
        return {"message": "Log de actividad vaciado correctamente."}
    finally:
        conn.close()