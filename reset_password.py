import sys
import os
from app.database import get_db_connection
from app.auth import hash_password

def reset_password(username, new_password):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, role FROM users WHERE username = ?;", (username,))
    user = cursor.fetchone()
    if not user:
        print(f"❌ Error: El usuario '{username}' no existe en la base de datos.")
        cursor.execute("SELECT id, username, role, is_active FROM users;")
        all_users = cursor.fetchall()
        print("\nUsuarios existentes en la base de datos:")
        for u in all_users:
            print(f" - ID {u['id']}: '{u['username']}' (Rol: {u['role']}, Activo: {u['is_active']})")
        conn.close()
        return False

    new_hash = hash_password(new_password)
    cursor.execute("UPDATE users SET password_hash = ?, is_active = 1 WHERE username = ?;", (new_hash, username))
    conn.commit()
    conn.close()
    print(f"[OK] Contrasena de '{username}' actualizada correctamente.")
    print("-> Ahora puedes iniciar sesion con:")
    print(f"   Usuario: {username}")
    print(f"   Contrasena: {new_password}\n")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python reset_password.py <nombre_usuario> <nueva_contrasena>")
        print("Ejemplo: python reset_password.py admin admin123")
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, role, is_active FROM users;")
        all_users = cursor.fetchall()
        print("\nUsuarios registrados en el sistema:")
        for u in all_users:
            print(f" - '{u['username']}' ({u['role']})")
        conn.close()
    else:
        u_name = sys.argv[1].strip()
        p_word = sys.argv[2]
        reset_password(u_name, p_word)
