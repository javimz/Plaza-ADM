from typing import Optional
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
    from_date: Optional[str] = Query(None, description="Fecha inicial (YYYY-MM-DD)"),
    to_date: Optional[str] = Query(None, description="Fecha final (YYYY-MM-DD)"),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo los administradores generales pueden vaciar el log de actividad")

    conn = get_db_connection()
    try:
        query = "DELETE FROM activity_logs WHERE 1=1"
        params = []
        if from_date:
            query += " AND substr(created_at, 1, 10) >= ?"
            params.append(from_date)
        if to_date:
            query += " AND substr(created_at, 1, 10) <= ?"
            params.append(to_date)

        cursor = conn.execute(query, params)
        deleted_count = cursor.rowcount
        conn.commit()

        if from_date or to_date:
            date_range_desc = f"entre {from_date or 'el inicio'} y {to_date or 'hoy'}"
            msg = f"Se eliminaron {deleted_count} registros de actividad ({date_range_desc})."
        else:
            msg = f"Log de actividad vaciado por completo ({deleted_count} registros eliminados)."

        return {"message": msg, "deleted_count": deleted_count}
    finally:
        conn.close()