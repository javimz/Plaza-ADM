from fastapi import HTTPException

SELLER_ROLES = {"agente", "ventas"}
_ASSIGNMENT_TABLES = {
    "budget": ("budget_sellers", "budget_id"),
    "booking": ("booking_sellers", "booking_id"),
}


def validate_seller_ids(cursor, seller_ids: list[int]) -> list[int]:
    unique_ids = list(dict.fromkeys(seller_ids))
    if not unique_ids:
        raise HTTPException(status_code=400, detail="Asigne al menos un vendedor")

    placeholders = ",".join("?" for _ in unique_ids)
    cursor.execute(
        f"SELECT id FROM users WHERE is_active = 1 AND role IN ('agente', 'ventas') AND id IN ({placeholders});",
        unique_ids,
    )
    valid_ids = {row["id"] for row in cursor.fetchall()}
    if valid_ids != set(unique_ids):
        raise HTTPException(status_code=400, detail="Solo se pueden asignar usuarios activos con rol Agente de Ventas o Ventas")
    return unique_ids


def initial_seller_ids(cursor, requested_ids: list[int] | None, user: dict) -> list[int]:
    if requested_ids:
        seller_ids = validate_seller_ids(cursor, requested_ids)
        require_current_agent_assignment(seller_ids, user)
        return seller_ids
    if user.get("role") in SELLER_ROLES:
        return validate_seller_ids(cursor, [user["id"]])
    cursor.execute("""
        SELECT id FROM users
        WHERE is_active = 1 AND role IN ('agente', 'ventas')
        ORDER BY CASE role WHEN 'agente' THEN 0 ELSE 1 END, id
        LIMIT 1;
    """)
    seller = cursor.fetchone()
    if not seller:
        raise HTTPException(status_code=400, detail="Cree o active un usuario vendedor antes de crear presupuestos")
    return [seller["id"]]


def require_current_agent_assignment(seller_ids: list[int], user: dict) -> None:
    if user.get("role") == "agente" and user.get("id") not in seller_ids:
        raise HTTPException(status_code=403, detail="No puede quitarse de la asignación de su propio registro")


def get_seller_ids(cursor, entity: str, record_id: int) -> list[int]:
    table, foreign_key = _ASSIGNMENT_TABLES[entity]
    cursor.execute(f"SELECT user_id FROM {table} WHERE {foreign_key} = ? ORDER BY user_id;", (record_id,))
    return [row["user_id"] for row in cursor.fetchall()]


def set_seller_ids(cursor, entity: str, record_id: int, seller_ids: list[int]) -> None:
    table, foreign_key = _ASSIGNMENT_TABLES[entity]
    cursor.execute(f"DELETE FROM {table} WHERE {foreign_key} = ?;", (record_id,))
    cursor.executemany(
        f"INSERT INTO {table} ({foreign_key}, user_id) VALUES (?, ?);",
        [(record_id, user_id) for user_id in seller_ids],
    )


_CLIENT_ASSIGNMENT_TABLES = {
    "budget": ("budget_clients", "budget_id"),
    "booking": ("booking_clients", "booking_id"),
}


def validate_client_ids(cursor, client_ids: list[int]) -> list[int]:
    unique_ids = list(dict.fromkeys(client_ids))
    if not unique_ids:
        raise HTTPException(status_code=400, detail="Seleccione al menos un cliente")

    placeholders = ",".join("?" for _ in unique_ids)
    cursor.execute(
        f"SELECT id FROM clients WHERE id IN ({placeholders});",
        unique_ids,
    )
    valid_ids = {row["id"] for row in cursor.fetchall()}
    if valid_ids != set(unique_ids):
        raise HTTPException(status_code=400, detail="Uno o más clientes seleccionados no existen")
    return unique_ids


def get_client_ids(cursor, entity: str, record_id: int) -> list[int]:
    table, foreign_key = _CLIENT_ASSIGNMENT_TABLES[entity]
    cursor.execute(f"SELECT client_id FROM {table} WHERE {foreign_key} = ? ORDER BY client_id;", (record_id,))
    return [row["client_id"] for row in cursor.fetchall()]


def set_client_ids(cursor, entity: str, record_id: int, client_ids: list[int]) -> None:
    table, foreign_key = _CLIENT_ASSIGNMENT_TABLES[entity]
    cursor.execute(f"DELETE FROM {table} WHERE {foreign_key} = ?;", (record_id,))
    cursor.executemany(
        f"INSERT INTO {table} ({foreign_key}, client_id) VALUES (?, ?);",
        [(record_id, client_id) for client_id in client_ids],
    )


def require_sales_assignment(cursor, entity: str, record_id: int, user: dict) -> None:
    if user.get("role") != "agente":
        return
    table, foreign_key = _ASSIGNMENT_TABLES[entity]
    cursor.execute(
        f"SELECT 1 FROM {table} WHERE {foreign_key} = ? AND user_id = ?;",
        (record_id, user.get("id")),
    )
    if not cursor.fetchone():
        label = "Presupuesto" if entity == "budget" else "Reserva"
        cursor.connection.close()
        raise HTTPException(status_code=404, detail=f"{label} no encontrado")
