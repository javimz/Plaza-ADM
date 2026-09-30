from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_db_connection
from app.routers.users import get_current_user


router = APIRouter(prefix="/api/audit", tags=["Activity Audit"])


@router.get("")
def get_activity_logs(
    limit: int = Query(500, ge=1, le=1000),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") not in ["admin", "contador"]:
        raise HTTPException(status_code=403, detail="Solo administración y contabilidad pueden consultar la bitácora")

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