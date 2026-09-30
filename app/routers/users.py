from fastapi import APIRouter, HTTPException, Depends, Header
from typing import List, Optional
from app.database import get_db_connection
from app.audit import record_activity
from app.schemas import LoginRequest, TokenResponse, UserCreate, UserOut, UserUpdate
from app.auth import verify_password, hash_password, create_access_token, decode_access_token

router = APIRouter(prefix="/api/users", tags=["Users"])

def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Debe iniciar sesión para continuar")
    token = authorization.split(" ")[1]
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")
    return payload

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?;", (payload.username,))
    user = cursor.fetchone()
    conn.close()

    if not user:
        record_activity("Inicio de sesión fallido", "POST", "/api/users/login", 400,
                        username=payload.username, details="Credenciales no válidas")
        raise HTTPException(status_code=400, detail="Usuario o contraseña incorrectos")

    if not user["is_active"]:
        record_activity("Inicio de sesión fallido", "POST", "/api/users/login", 400,
                        username=user["username"], role=user["role"], details="Usuario inactivo")
        raise HTTPException(status_code=400, detail="El usuario se encuentra inactivo")

    if not verify_password(user["password_hash"], payload.password):
        record_activity("Inicio de sesión fallido", "POST", "/api/users/login", 400,
                        username=user["username"], role=user["role"], details="Credenciales no válidas")
        raise HTTPException(status_code=400, detail="Usuario o contraseña incorrectos")

    token_data = {
        "id": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "email": user["email"],
        "role": user["role"]
    }
    access_token = create_access_token(token_data)
    record_activity("Inicio de sesión", "POST", "/api/users/login", 200, user=token_data,
                    details="Acceso exitoso")
    return {"access_token": access_token, "token_type": "bearer", "user": token_data}


@router.post("/logout")
def logout(current_user: dict = Depends(get_current_user)):
    record_activity("Cierre de sesión", "POST", "/api/users/logout", 200,
                    user=current_user, details="Sesión cerrada por el usuario")
    return {"message": "Sesión cerrada"}

@router.get("", response_model=List[UserOut])
def get_users(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, full_name, email, role, is_active, created_at FROM users ORDER BY id ASC;")
    users = cursor.fetchall()
    conn.close()
    return [dict(u) for u in users]

@router.post("", response_model=UserOut)
def create_user(payload: UserCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Se requieren permisos de administrador")

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM users WHERE username = ?;", (payload.username,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="El nombre de usuario ya existe")

    hashed = hash_password(payload.password)
    cursor.execute("""
        INSERT INTO users (username, full_name, email, password_hash, role, is_active)
        VALUES (?, ?, ?, ?, ?, ?);
    """, (payload.username, payload.full_name, payload.email, hashed, payload.role, 1 if payload.is_active else 0))
    user_id = cursor.lastrowid
    conn.commit()

    cursor.execute("SELECT id, username, full_name, email, role, is_active, created_at FROM users WHERE id = ?;", (user_id,))
    new_user = cursor.fetchone()
    conn.close()
    return dict(new_user)

@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Se requieren permisos de administrador")

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE id = ?;", (user_id,))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    full_name = payload.full_name if payload.full_name is not None else existing["full_name"]
    email = payload.email if payload.email is not None else existing["email"]
    role = payload.role if payload.role is not None else existing["role"]
    is_active = (1 if payload.is_active else 0) if payload.is_active is not None else existing["is_active"]

    if payload.password and payload.password.strip():
        hashed = hash_password(payload.password)
        cursor.execute("""
            UPDATE users SET full_name = ?, email = ?, role = ?, is_active = ?, password_hash = ?
            WHERE id = ?;
        """, (full_name, email, role, is_active, hashed, user_id))
    else:
        cursor.execute("""
            UPDATE users SET full_name = ?, email = ?, role = ?, is_active = ?
            WHERE id = ?;
        """, (full_name, email, role, is_active, user_id))

    conn.commit()

    cursor.execute("SELECT id, username, full_name, email, role, is_active, created_at FROM users WHERE id = ?;", (user_id,))
    updated = cursor.fetchone()
    conn.close()
    return dict(updated)

@router.delete("/{user_id}")
def delete_user(user_id: int, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Se requieren permisos de administrador")

    if user_id == current_user.get("id"):
        raise HTTPException(status_code=400, detail="No puede eliminar su propio usuario activo")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM users WHERE id = ?;", (user_id,))
    conn.commit()
    conn.close()
    return {"message": "Usuario eliminado exitosamente"}
