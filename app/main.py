import os
import json
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.audit import record_activity
from app.auth import decode_access_token
from app.database import init_db
from app.routers import users, clients, suppliers, budgets, bookings, payments, reports, profits, audit, supplier_payables

app = FastAPI(
    title="Sistema de Gestión Administrativo - Plaza Bohemia Viajes",
    description="Sistema web de administración para agencia de viajes: Presupuestos, Pagos totales/parciales, Ganancias, Clientes, Proveedores y Usuarios.",
    version="1.1.0"
)

# Initialize Database and Seed Data
init_db()

# Include Routers
app.include_router(users.router)
app.include_router(clients.router)
app.include_router(suppliers.router)
app.include_router(budgets.router)
app.include_router(bookings.router)
app.include_router(payments.router)
app.include_router(reports.router)
app.include_router(profits.router)
app.include_router(audit.router)
app.include_router(supplier_payables.router)


@app.middleware("http")
async def audit_api_changes(request: Request, call_next):
    method = request.method.upper()
    path = request.url.path
    monitored_methods = {"GET", "POST", "PUT", "PATCH", "DELETE"}
    excluded_paths = {"/api/users/login", "/api/users/logout"}

    if (not path.startswith("/api/") or method not in monitored_methods
            or path in excluded_paths or path == "/api/audit"):
        return await call_next(request)

    captured_body = bytearray()
    original_receive = request.receive

    async def capture_request_body():
        message = await original_receive()
        if message["type"] == "http.request" and len(captured_body) < 32768:
            captured_body.extend(message.get("body", b"")[:32768 - len(captured_body)])
        return message

    request._receive = capture_request_body
    response = None
    try:
        response = await call_next(request)
        return response
    finally:
        authorization = request.headers.get("authorization", "")
        token = authorization[7:] if authorization.startswith("Bearer ") else ""
        actor = decode_access_token(token) if token else None
        status_code = response.status_code if response is not None else 500
        action = _describe_api_change(method, path)
        result = "Completado" if status_code < 400 else f"Solicitud rechazada (HTTP {status_code})"
        if response is not None and status_code < 400 and method in {"POST", "PUT", "PATCH"}:
            changed_values = _describe_request_values(captured_body, request.headers.get("content-type", ""))
            if changed_values:
                result = f"{result}. {changed_values}"
        try:
            record_activity(action, method, path, status_code, user=actor,
                            details=result)
        except Exception:
            # Audit storage must not hide the original API response/error.
            pass


def _describe_request_values(body: bytearray, content_type: str) -> str:
    if not body or "application/json" not in content_type.lower():
        return ""
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return ""
    if not isinstance(payload, dict):
        return ""

    values = []
    for key, value in payload.items():
        normalized_key = key.lower()
        if any(secret in normalized_key for secret in ("password", "token", "secret", "credential", "authorization")):
            continue
        if isinstance(value, (dict, list)):
            display_value = f"{len(value)} elemento(s)"
        elif isinstance(value, str):
            display_value = " ".join(value.split())[:120]
        elif value is None:
            display_value = "vacío"
        else:
            display_value = str(value)
        values.append(f"{key}: {display_value}")
    if not values:
        return ""
    return f"Valores recibidos: {'; '.join(values)}"[:1000]


def _describe_api_change(method: str, path: str) -> str:
    parts = [part for part in path.strip("/").split("/") if part]
    resource = parts[1] if len(parts) > 1 else "registro"
    names = {
        "budgets": "presupuesto", "bookings": "reserva", "payments": "pago",
        "clients": "cliente", "suppliers": "proveedor", "users": "usuario",
        "profits": "ganancia", "commissions": "retiro/comisión",
    }
    label = names.get(resource, resource.rstrip("s"))
    action_by_method = {
        "GET": "Consultó", "POST": "Creó", "PUT": "Actualizó",
        "PATCH": "Actualizó", "DELETE": "Eliminó"
    }
    if "convert-to-booking" in parts:
        return "Convirtió presupuesto en reserva"
    if "revert-to-budget" in parts or "revert-to-draft" in parts:
        return "Revirtió una operación"
    if "commissions" in parts:
        if method == "GET":
            return "Consultó retiros/comisiones"
        return "Registró retiro/comisión" if method == "POST" else "Anuló retiro/comisión"
    return f"{action_by_method.get(method, 'Modificó')} {label}"

# Mount Static Files
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def read_root():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Sistema de Gestión Administrativo para Agencia de Viajes API activo."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
