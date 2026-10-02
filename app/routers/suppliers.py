from fastapi import APIRouter, HTTPException, Depends
from typing import List
from app.database import get_db_connection
from app.schemas import SupplierCreate, SupplierOut
from app.routers.users import get_current_user

router = APIRouter(prefix="/api/suppliers", tags=["Suppliers"])

@router.get("", response_model=List[SupplierOut])
def get_suppliers(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM suppliers ORDER BY name ASC;")
    suppliers = cursor.fetchall()
    conn.close()
    return [dict(s) for s in suppliers]

@router.get("/{supplier_id}", response_model=SupplierOut)
def get_supplier(supplier_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM suppliers WHERE id = ?;", (supplier_id,))
    supplier = cursor.fetchone()
    conn.close()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    return dict(supplier)

@router.post("", response_model=SupplierOut)
def create_supplier(payload: SupplierCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO suppliers (name, cuit, category, contact_name, phone, email, address, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    """, (payload.name, payload.cuit or "", payload.category, payload.contact_name or "", payload.phone or "", payload.email or "", payload.address or "", payload.notes or ""))
    supplier_id = cursor.lastrowid
    conn.commit()

    cursor.execute("SELECT * FROM suppliers WHERE id = ?;", (supplier_id,))
    new_supplier = cursor.fetchone()
    conn.close()
    return dict(new_supplier)

@router.put("/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: int, payload: SupplierCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM suppliers WHERE id = ?;", (supplier_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")

    cursor.execute("""
        UPDATE suppliers SET name = ?, cuit = ?, category = ?, contact_name = ?, phone = ?, email = ?, address = ?, notes = ?
        WHERE id = ?;
    """, (payload.name, payload.cuit or "", payload.category, payload.contact_name or "", payload.phone or "", payload.email or "", payload.address or "", payload.notes or "", supplier_id))
    conn.commit()

    cursor.execute("SELECT * FROM suppliers WHERE id = ?;", (supplier_id,))
    updated = cursor.fetchone()
    conn.close()
    return dict(updated)

@router.delete("/{supplier_id}")
def delete_supplier(supplier_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM suppliers WHERE id = ?;", (supplier_id,))
    conn.commit()
    conn.close()
    return {"message": "Proveedor eliminado exitosamente"}
