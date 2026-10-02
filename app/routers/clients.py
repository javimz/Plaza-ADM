from fastapi import APIRouter, HTTPException, Depends
from typing import List
from app.database import get_db_connection
from app.schemas import ClientCreate, ClientOut
from app.routers.users import get_current_user

router = APIRouter(prefix="/api/clients", tags=["Clients"])

@router.get("", response_model=List[ClientOut])
def get_clients(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM clients ORDER BY name ASC;")
    clients = cursor.fetchall()
    conn.close()
    return [dict(c) for c in clients]

@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM clients WHERE id = ?;", (client_id,))
    client = cursor.fetchone()
    conn.close()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return dict(client)

@router.post("", response_model=ClientOut)
def create_client(payload: ClientCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO clients (name, document_id, birth_date, passport_number, passport_expiry, email, phone, address, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, (payload.name, payload.document_id, payload.birth_date or "", payload.passport_number or "", payload.passport_expiry or "", payload.email, payload.phone, payload.address or "", payload.notes or ""))
    client_id = cursor.lastrowid
    conn.commit()

    cursor.execute("SELECT * FROM clients WHERE id = ?;", (client_id,))
    new_client = cursor.fetchone()
    conn.close()
    return dict(new_client)

@router.put("/{client_id}", response_model=ClientOut)
def update_client(client_id: int, payload: ClientCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM clients WHERE id = ?;", (client_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    cursor.execute("""
        UPDATE clients SET name = ?, document_id = ?, birth_date = ?, passport_number = ?, passport_expiry = ?, email = ?, phone = ?, address = ?, notes = ?
        WHERE id = ?;
    """, (payload.name, payload.document_id, payload.birth_date or "", payload.passport_number or "", payload.passport_expiry or "", payload.email, payload.phone, payload.address or "", payload.notes or "", client_id))
    conn.commit()

    cursor.execute("SELECT * FROM clients WHERE id = ?;", (client_id,))
    updated = cursor.fetchone()
    conn.close()
    return dict(updated)

@router.delete("/{client_id}")
def delete_client(client_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM clients WHERE id = ?;", (client_id,))
    conn.commit()
    conn.close()
    return {"message": "Cliente eliminado exitosamente"}
