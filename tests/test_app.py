import unittest
import os
import sys
import tempfile
from datetime import date, timedelta
from fastapi.testclient import TestClient

# Ensure root directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.main import app
from app import database
from app.database import init_db

class TestTravelAgencyApp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_db_path = database.DB_PATH
        cls.test_directory = tempfile.TemporaryDirectory()
        database.DB_PATH = os.path.join(cls.test_directory.name, "test_travel_agency.db")
        init_db()
        cls.client = TestClient(app)
        login = cls.client.post("/api/users/login", json={"username": "admin", "password": "admin123"})
        if login.status_code == 200:
            cls.client.headers.update({"Authorization": f"Bearer {login.json()['access_token']}"})

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        database.DB_PATH = cls.original_db_path
        cls.test_directory.cleanup()

    def test_01_health_and_root(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)

    def test_02_login(self):
        response = self.client.post("/api/users/login", json={"username": "admin", "password": "admin123"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("access_token", data)
        self.assertEqual(data["user"]["role"], "admin")

    def test_03_clients(self):
        # List clients
        response = self.client.get("/api/clients")
        self.assertEqual(response.status_code, 200)
        clients = response.json()
        self.assertGreaterEqual(len(clients), 1)

        # Create client
        new_client = {
            "name": "Juan Pérez Test",
            "document_id": "DNI 40.111.222",
            "birth_date": "1990-04-15",
            "passport_number": "AAL987654",
            "passport_expiry": "2032-05-20",
            "email": "juan.perez@test.com",
            "phone": "+54 9 11 5555-4444",
            "address": "Calle Falsa 123",
            "notes": "Cliente test"
        }
        res = self.client.post("/api/clients", json=new_client)
        self.assertEqual(res.status_code, 200)
        c_data = res.json()
        self.assertEqual(c_data["name"], "Juan Pérez Test")
        self.assertEqual(c_data["birth_date"], "1990-04-15")
        self.assertEqual(c_data["passport_number"], "AAL987654")
        self.assertEqual(c_data["passport_expiry"], "2032-05-20")

    def test_04_suppliers(self):
        response = self.client.get("/api/suppliers")
        self.assertEqual(response.status_code, 200)
        suppliers = response.json()
        self.assertGreaterEqual(len(suppliers), 1)

        # Create supplier with cuit, address and notes
        new_supplier = {
            "name": "Hotel Test Plaza",
            "cuit": "30-99887766-5",
            "category": "Hotel",
            "contact_name": "Carlos Gomez",
            "phone": "+54 11 4433-2211",
            "email": "contacto@hoteltest.com",
            "address": "Av. Libertador 4500, CABA",
            "notes": "Tarifas corporativas acordadas"
        }
        res = self.client.post("/api/suppliers", json=new_supplier)
        self.assertEqual(res.status_code, 200)
        s_data = res.json()
        self.assertEqual(s_data["name"], "Hotel Test Plaza")
        self.assertEqual(s_data["cuit"], "30-99887766-5")
        self.assertEqual(s_data["address"], "Av. Libertador 4500, CABA")
        self.assertEqual(s_data["notes"], "Tarifas corporativas acordadas")

    def test_05_budgets_and_conversion(self):
        # Create budget
        budget_payload = {
            "client_id": 1,
            "title": "Viaje Test Bariloche",
            "destination": "Bariloche, Argentina",
            "start_date": "2026-12-01",
            "end_date": "2026-12-08",
            "currency": "USD",
            "status": "Aprobado",
            "notes": "Test de presupuesto",
            "items": [
                {
                    "service_type": "Vuelo",
                    "description": "Vuelo BsAs - Bariloche",
                    "supplier_id": 1,
                    "cost_price": 300.0,
                    "sale_price": 450.0,
                    "quantity": 1
                },
                {
                    "service_type": "Hotel",
                    "description": "Hotel Llao Llao 7 noches",
                    "supplier_id": 2,
                    "cost_price": 1000.0,
                    "sale_price": 1350.0,
                    "quantity": 1
                }
            ]
        }
        res = self.client.post("/api/budgets", json=budget_payload)
        self.assertEqual(res.status_code, 200)
        b_data = res.json()
        self.assertEqual(b_data["total_cost"], 1300.0)
        self.assertEqual(b_data["total_amount"], 1800.0)
        self.assertTrue(b_data["seller_ids"])

        budget_id = b_data["id"]

        # Convert to booking
        conv_res = self.client.post(f"/api/budgets/{budget_id}/convert-to-booking")
        self.assertEqual(conv_res.status_code, 200)
        conv_data = conv_res.json()
        self.assertIn("booking_id", conv_data)
        booking_id = conv_data["booking_id"]

        locked_update = self.client.put(f"/api/budgets/{budget_id}", json=budget_payload)
        self.assertEqual(locked_update.status_code, 409)
        self.assertEqual(self.client.delete(f"/api/budgets/{budget_id}").status_code, 409)

        # Check booking total and balance
        bk_res = self.client.get(f"/api/bookings/{booking_id}")
        self.assertEqual(bk_res.status_code, 200)
        bk_data = bk_res.json()
        self.assertEqual(bk_data["total_amount"], 1800.0)
        self.assertEqual(bk_data["paid_amount"], 0.0)
        self.assertEqual(bk_data["balance_due"], 1800.0)
        self.assertEqual(bk_data["seller_ids"], b_data["seller_ids"])
        self.assertEqual(len(bk_data["items"]), 2)
        self.assertEqual(bk_data["items"][0]["description"], "Vuelo BsAs - Bariloche")
        booking_update = self.client.put(f"/api/bookings/{conv_data['booking_id']}", json={
            "client_id": 1,
            "title": "No debe modificarse",
            "destination": "Prueba",
            "total_amount": 10,
        })
        self.assertEqual(booking_update.status_code, 409)

    def test_06_payments_partial_and_total(self):
        # Get active booking
        bookings = self.client.get("/api/bookings").json()
        booking = bookings[0]
        booking_id = booking["id"]
        initial_balance = booking["balance_due"]

        # Register partial payment of 500
        pay1 = {
            "booking_id": booking_id,
            "amount": 500.0,
            "payment_date": "2026-09-28",
            "payment_method": "Transferencia Bancaria",
            "reference_code": "TEST-TRF-001",
            "notes": "Seña de prueba"
        }
        res1 = self.client.post("/api/payments", json=pay1)
        self.assertEqual(res1.status_code, 200)
        p1_data = res1.json()
        self.assertEqual(p1_data["payment_type"], "Parcial")

        # Verify updated booking balance
        updated_bk = self.client.get(f"/api/bookings/{booking_id}").json()
        self.assertEqual(updated_bk["paid_amount"], booking["paid_amount"] + 500.0)
        self.assertEqual(updated_bk["balance_due"], initial_balance - 500.0)

    def test_07_profit_summary_without_commission_workflow(self):
        budget_payload = {
            "client_id": 1,
            "title": "Prueba de distribución parcial",
            "destination": "Destino de prueba",
            "currency": "USD",
            "status": "Aprobado",
            "items": [{
                "service_type": "Otro",
                "description": "Servicio de prueba",
                "cost_price": 250.0,
                "sale_price": 750.0,
                "quantity": 1
            }]
        }
        created = self.client.post("/api/budgets", json=budget_payload)
        self.assertEqual(created.status_code, 200)
        budget_id = created.json()["id"]

        summary = self.client.get("/api/profits/summary")
        self.assertEqual(summary.status_code, 200)
        budget_profit = next(b for b in summary.json()["budgets"] if b["id"] == budget_id)
        self.assertEqual(budget_profit["gross_profit"], 750.0)
        self.assertEqual(budget_profit["supplier_payments"], 0.0)
        self.assertEqual(budget_profit["net_profit"], 750.0)
        self.assertEqual(budget_profit["supplier_payment_details"], [])
        self.assertEqual(self.client.post("/api/profits/commissions", json={}).status_code, 404)

    def test_08_dashboard_metrics(self):
        res = self.client.get("/api/reports/dashboard")
        self.assertEqual(res.status_code, 200)
        dash = res.json()
        self.assertGreater(dash["total_sales"], 0)
        self.assertGreater(dash["total_collected"], 0)
        self.assertIn("month_collected", dash)
        self.assertIn("collection_rate", dash)
        self.assertIn("bookings_with_balance", dash)
        self.assertIn("monthly_collections", dash)
        self.assertIn("bookings_by_status", dash)

    def test_09_activity_audit_records_login_and_changes(self):
        audit_before = self.client.get("/api/audit")
        self.assertEqual(audit_before.status_code, 200)
        self.assertTrue(any(event["action"] == "Inicio de sesión" for event in audit_before.json()))

        change = self.client.post("/api/clients", json={
            "name": "Cliente Bitácora Test",
            "document_id": "DNI AUDIT-01",
            "email": "audit@example.com",
            "phone": "0000000000",
            "address": "",
            "notes": "Prueba de auditoría"
        })
        self.assertEqual(change.status_code, 200)

        audit_after = self.client.get("/api/audit")
        self.assertEqual(audit_after.status_code, 200)
        latest = audit_after.json()[0]
        self.assertEqual(latest["action"], "Creó cliente")
        self.assertEqual(latest["method"], "POST")
        self.assertEqual(latest["status_code"], 200)
        self.assertEqual(latest["username"], "admin")
        self.assertIn("Cliente Bitácora Test", latest["details"])

        logout = self.client.post("/api/users/logout")
        self.assertEqual(logout.status_code, 200)
        audit_final = self.client.get("/api/audit")
        self.assertEqual(audit_final.status_code, 200)
        self.assertEqual(audit_final.json()[0]["action"], "Cierre de sesión")
        self.assertNotIn("password", " ".join(event["details"] for event in audit_final.json()).lower())

    def test_10_supplier_payable_partial_payment_and_due_reminder(self):
        today = date.today()
        due_date = today + timedelta(days=4)
        payable_response = self.client.post("/api/supplier-payables", json={
            "supplier_id": 1,
            "concept": "Factura de prueba de proveedor",
            "invoice_number": "FACT-TEST-10",
            "currency": "USD",
            "total_amount": 900.0,
            "issue_date": today.isoformat(),
            "due_date": due_date.isoformat(),
            "notes": "Pago en dos partes"
        })
        self.assertEqual(payable_response.status_code, 200, payable_response.text)
        payable = payable_response.json()
        payable_id = payable["id"]
        self.assertEqual(payable["balance_due"], 900.0)
        self.assertEqual(payable["status"], "Vence pronto")

        partial = self.client.post(f"/api/supplier-payables/{payable_id}/payments", json={
            "amount": 350.0,
            "payment_date": today.isoformat(),
            "payment_method": "Transferencia",
            "reference": "TRF-PROV-10",
            "notes": "Anticipo"
        })
        self.assertEqual(partial.status_code, 200, partial.text)
        self.assertEqual(partial.json()["paid_amount"], 350.0)
        self.assertEqual(partial.json()["balance_due"], 550.0)
        self.assertEqual(len(partial.json()["payments"]), 1)

        overpayment = self.client.post(f"/api/supplier-payables/{payable_id}/payments", json={
            "amount": 550.01,
            "payment_date": today.isoformat(),
            "payment_method": "Efectivo"
        })
        self.assertEqual(overpayment.status_code, 400)

        summary = self.client.get("/api/supplier-payables/summary")
        self.assertEqual(summary.status_code, 200)
        reminder = next(item for item in summary.json()["reminders"] if item["id"] == payable_id)
        self.assertEqual(reminder["status"], "Vence pronto")
        self.assertEqual(reminder["balance_due"], 550.0)

        final_payment = self.client.post(f"/api/supplier-payables/{payable_id}/payments", json={
            "amount": 550.0,
            "payment_date": today.isoformat(),
            "payment_method": "Efectivo"
        })
        self.assertEqual(final_payment.status_code, 200)
        self.assertEqual(final_payment.json()["status"], "Pagado")
        self.assertEqual(final_payment.json()["balance_due"], 0.0)

        overdue = self.client.post("/api/supplier-payables", json={
            "supplier_id": 1,
            "concept": "Factura vencida de prueba",
            "currency": "USD",
            "total_amount": 100.0,
            "issue_date": (today - timedelta(days=5)).isoformat(),
            "due_date": (today - timedelta(days=1)).isoformat()
        })
        self.assertEqual(overdue.status_code, 200)
        self.assertEqual(overdue.json()["status"], "Vencido")
        updated_summary = self.client.get("/api/supplier-payables/summary").json()
        self.assertTrue(any(item["id"] == overdue.json()["id"] and item["status"] == "Vencido" for item in updated_summary["reminders"]))

    def test_11_revert_booking_preserves_payments_and_reuses_booking(self):
        budget = self.client.post("/api/budgets", json={
            "client_id": 1,
            "title": "Presupuesto para proteger pagos",
            "destination": "Prueba",
            "currency": "USD",
            "status": "Aprobado",
            "items": [{
                "service_type": "Otro",
                "description": "Servicio",
                "cost_price": 100,
                "sale_price": 200,
                "quantity": 1
            }]
        })
        self.assertEqual(budget.status_code, 200)
        budget_id = budget.json()["id"]
        converted = self.client.post(f"/api/budgets/{budget_id}/convert-to-booking")
        self.assertEqual(converted.status_code, 200)
        booking_id = converted.json()["booking_id"]

        payment = self.client.post("/api/payments", json={
            "booking_id": booking_id,
            "amount": 50,
            "payment_date": date.today().isoformat(),
            "payment_method": "Transferencia",
            "reference_code": "PRESERVE-TEST"
        })
        self.assertEqual(payment.status_code, 200)

        reverted = self.client.post(f"/api/bookings/{booking_id}/revert-to-budget")
        self.assertEqual(reverted.status_code, 200)
        self.assertTrue(reverted.json()["payments_preserved"])

        visible_bookings = self.client.get("/api/bookings").json()
        self.assertFalse(any(booking["id"] == booking_id for booking in visible_bookings))
        editable_budget = self.client.get(f"/api/budgets/{budget_id}")
        self.assertEqual(editable_budget.status_code, 200)
        edited_payload = {
            "client_id": 1,
            "title": editable_budget.json()["title"],
            "destination": editable_budget.json()["destination"],
            "currency": "USD",
            "status": "Borrador",
            "items": [
                {"service_type": "Otro", "description": "Servicio original", "cost_price": 100, "sale_price": 200, "quantity": 1},
                {"service_type": "Hotel", "description": "Nuevo adicional", "cost_price": 50, "sale_price": 100, "quantity": 1}
            ]
        }
        updated_budget = self.client.put(f"/api/budgets/{budget_id}", json=edited_payload)
        self.assertEqual(updated_budget.status_code, 200)
        self.assertEqual(len(updated_budget.json()["items"]), 2)

        reconverted = self.client.post(f"/api/budgets/{budget_id}/convert-to-booking")
        self.assertEqual(reconverted.status_code, 200)
        self.assertEqual(reconverted.json()["booking_id"], booking_id)

        restored = self.client.get(f"/api/bookings/{booking_id}")
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(len(restored.json()["payments"]), 1)
        self.assertEqual(restored.json()["payments"][0]["reference_code"], "PRESERVE-TEST")
        self.assertEqual(restored.json()["paid_amount"], 50.0)
        self.assertEqual(restored.json()["balance_due"], 250.0)

    def test_13_role_access_for_sales_and_administrative(self):
        tokens = {}
        for role in ("agente", "administrativa"):
            username = f"role_test_{role}"
            created = self.client.post("/api/users", json={
                "username": username,
                "full_name": f"Usuario {role}",
                "email": f"{username}@example.com",
                "password": "test-password-123",
                "role": role,
                "is_active": True,
            })
            self.assertEqual(created.status_code, 200, created.text)
            logged_in = self.client.post("/api/users/login", json={
                "username": username,
                "password": "test-password-123",
            })
            self.assertEqual(logged_in.status_code, 200, logged_in.text)
            tokens[role] = {"Authorization": f"Bearer {logged_in.json()['access_token']}"}

        for role in ("agente", "administrativa"):
            headers = tokens[role]
            self.assertEqual(self.client.get("/api/profits/summary", headers=headers).status_code, 403)
            self.assertEqual(self.client.get("/api/profits/commissions", headers=headers).status_code, 404)
            self.assertEqual(self.client.get("/api/audit", headers=headers).status_code, 403)
            self.assertEqual(self.client.get("/api/reports/dashboard", headers=headers).status_code, 200)

        self.assertEqual(self.client.get("/api/supplier-payables/summary", headers=tokens["agente"]).status_code, 403)
        self.assertEqual(self.client.get("/api/supplier-payables/summary", headers=tokens["administrativa"]).status_code, 200)
        ventas_login = self.client.post("/api/users/login", json={"username": "ventas", "password": "ventas123"})
        self.assertEqual(ventas_login.status_code, 200, ventas_login.text)
        ventas_headers = {"Authorization": f"Bearer {ventas_login.json()['access_token']}"}
        self.assertEqual(self.client.get("/api/profits/summary", headers=ventas_headers).status_code, 200)
        self.assertEqual(self.client.get("/api/audit", headers=ventas_headers).status_code, 403)
        self.assertEqual(self.client.get("/api/supplier-payables/summary", headers=ventas_headers).status_code, 200)

    def test_14_supplier_expense_is_negative_and_reduces_booking_cost_balance(self):
        before_supplier_payments = self.client.get("/api/profits/summary").json()["summary"]["supplier_payments_by_currency"].get("USD", 0)
        budget = self.client.post("/api/budgets", json={
            "client_id": 1,
            "title": "Costo asociado a reserva",
            "destination": "Prueba",
            "currency": "USD",
            "items": [{
                "service_type": "Hotel",
                "description": "Costo hotel",
                "supplier_id": 1,
                "cost_price": 100,
                "sale_price": 160,
                "quantity": 1,
            }],
        })
        self.assertEqual(budget.status_code, 200, budget.text)
        budget_id = budget.json()["id"]
        booking = self.client.post(f"/api/budgets/{budget_id}/convert-to-booking")
        self.assertEqual(booking.status_code, 200, booking.text)
        booking_id = booking.json()["booking_id"]

        customer_payment = self.client.post("/api/payments", json={
            "booking_id": booking_id,
            "amount": 25,
            "payment_date": date.today().isoformat(),
            "payment_method": "Transferencia",
            "reference_code": "CLIENT-IN-14",
        })
        self.assertEqual(customer_payment.status_code, 200, customer_payment.text)

        expense = self.client.post("/api/supplier-payables/expenses", json={
            "supplier_id": 1,
            "concept": "Pago hotel de reserva",
            "currency": "USD",
            "amount": 35,
            "payment_date": date.today().isoformat(),
            "payment_method": "Transferencia",
            "booking_id": booking_id,
        })
        self.assertEqual(expense.status_code, 200, expense.text)
        self.assertEqual(expense.json()["booking_id"], booking_id)

        detail = self.client.get(f"/api/bookings/{booking_id}").json()
        self.assertEqual(detail["budget_number"], budget.json()["budget_number"])
        self.assertEqual(detail["total_cost"], 100.0)
        self.assertEqual(detail["supplier_paid_amount"], 35.0)
        self.assertEqual(detail["cost_balance"], 65.0)
        booking_expense = next(payment for payment in detail["payments"] if payment.get("record_type") == "Proveedor")
        self.assertEqual(booking_expense["amount"], -35.0)
        listed_booking = next(item for item in self.client.get("/api/bookings").json() if item["id"] == booking_id)
        self.assertEqual(listed_booking["cost_balance"], 65.0)
        self.assertEqual(self.client.get(f"/api/budgets/{budget_id}").json()["booking_number"], booking.json()["booking_number"])

        supplier_movement = next(payment for payment in self.client.get("/api/payments").json() if payment.get("payable_id") == expense.json()["id"])
        self.assertEqual(supplier_movement["amount"], -35.0)
        profit_summary = self.client.get("/api/profits/summary").json()["summary"]
        self.assertEqual(profit_summary["supplier_payments_by_currency"]["USD"] - before_supplier_payments, 35.0)
        budget_profit = next(item for item in self.client.get("/api/profits/summary").json()["budgets"] if item["id"] == budget_id)
        self.assertEqual(budget_profit["supplier_payments"], 35.0)
        self.assertEqual(budget_profit["gross_profit"], 125.0)
        self.assertEqual(budget_profit["net_profit"], 125.0)
        self.assertEqual(budget_profit["supplier_payment_details"][0]["supplier_name"], "Aerolíneas Argentinas")
        self.assertEqual(budget_profit["supplier_payment_details"][0]["amount"], 35.0)
        self.assertEqual(budget_profit["customer_payment_details"][0]["payment_number"], customer_payment.json()["payment_number"])
        self.assertEqual(budget_profit["customer_payment_details"][0]["amount"], 25.0)

        direct_booking = self.client.post("/api/bookings", json={
            "client_id": 1,
            "title": "Reserva sin presupuesto",
            "destination": "Prueba directa",
            "currency": "USD",
            "total_amount": 80,
        })
        self.assertEqual(direct_booking.status_code, 200, direct_booking.text)
        direct_id = direct_booking.json()["id"]
        direct_expense = self.client.post("/api/supplier-payables/expenses", json={
            "supplier_id": 1,
            "concept": "Gasto sin presupuesto",
            "currency": "USD",
            "amount": 20,
            "payment_date": date.today().isoformat(),
            "payment_method": "Efectivo",
            "booking_id": direct_id,
        })
        self.assertEqual(direct_expense.status_code, 200, direct_expense.text)
        direct_detail = self.client.get(f"/api/bookings/{direct_id}").json()
        self.assertIsNone(direct_detail["budget_number"])
        self.assertEqual(direct_detail["cost_balance"], -20.0)
        direct_list_item = next(item for item in self.client.get("/api/bookings").json() if item["id"] == direct_id)
        self.assertEqual(direct_list_item["cost_balance"], -20.0)

    def test_15_agents_only_see_assigned_budgets_bookings_and_payments(self):
        ventas = next(user for user in self.client.get("/api/users").json() if user["role"] == "ventas")
        agent_name = "asignado_agente_test"
        agent_create = self.client.post("/api/users", json={
            "username": agent_name,
            "full_name": "Agente Asignado Test",
            "email": "asignado@example.com",
            "password": "test-password-123",
            "role": "agente",
            "is_active": True,
        })
        self.assertEqual(agent_create.status_code, 200, agent_create.text)
        agent_id = agent_create.json()["id"]

        def create_assigned_budget(title, seller_ids):
            created = self.client.post("/api/budgets", json={
                "client_id": 1,
                "title": title,
                "destination": "Destino asignado",
                "status": "Aprobado",
                "seller_ids": seller_ids,
                "items": [{
                    "service_type": "Otro",
                    "description": title,
                    "cost_price": 30,
                    "sale_price": 50,
                    "quantity": 1,
                }],
            })
            self.assertEqual(created.status_code, 200, created.text)
            converted = self.client.post(f"/api/budgets/{created.json()['id']}/convert-to-booking")
            self.assertEqual(converted.status_code, 200, converted.text)
            return created.json(), converted.json()["booking_id"]

        own_budget, own_booking_id = create_assigned_budget("Presupuesto del agente", [agent_id, ventas["id"]])
        other_budget, other_booking_id = create_assigned_budget("Presupuesto de ventas", [ventas["id"]])
        self.assertCountEqual(own_budget["seller_ids"], [agent_id, ventas["id"]])
        self.assertCountEqual(own_budget["seller_names"], ["Agente Asignado Test", ventas["full_name"]])
        self.assertEqual(self.client.delete(f"/api/users/{agent_id}").status_code, 400)
        self.assertEqual(self.client.put(f"/api/users/{agent_id}", json={"role": "admin"}).status_code, 400)
        for booking_id, amount in ((own_booking_id, 10), (other_booking_id, 20)):
            payment = self.client.post("/api/payments", json={
                "booking_id": booking_id,
                "amount": amount,
                "payment_date": date.today().isoformat(),
                "payment_method": "Transferencia",
            })
            self.assertEqual(payment.status_code, 200, payment.text)

        login = self.client.post("/api/users/login", json={
            "username": agent_name,
            "password": "test-password-123",
        })
        self.assertEqual(login.status_code, 200, login.text)
        agent_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        visible_budgets = self.client.get("/api/budgets", headers=agent_headers).json()
        self.assertIn(own_budget["id"], [item["id"] for item in visible_budgets])
        self.assertNotIn(other_budget["id"], [item["id"] for item in visible_budgets])
        self.assertEqual(self.client.get(f"/api/budgets/{other_budget['id']}", headers=agent_headers).status_code, 404)

        visible_bookings = self.client.get("/api/bookings", headers=agent_headers).json()
        self.assertEqual([item["id"] for item in visible_bookings], [own_booking_id])
        self.assertEqual(self.client.get(f"/api/bookings/{other_booking_id}", headers=agent_headers).status_code, 404)
        visible_payments = self.client.get("/api/payments", headers=agent_headers).json()
        self.assertEqual({item["booking_number"] for item in visible_payments}, {visible_bookings[0]["booking_number"]})
        dashboard = self.client.get("/api/reports/dashboard", headers=agent_headers).json()
        self.assertEqual(dashboard["total_bookings"], 1)
        self.assertTrue(all(item["booking_number"] == visible_bookings[0]["booking_number"] for item in dashboard["recent_payments"]))

    def test_16_budget_multiple_clients(self):
        created = self.client.post("/api/budgets", json={
            "client_ids": [1, 2],
            "title": "Viaje grupal 2 clientes",
            "destination": "Bariloche",
            "status": "Borrador",
            "items": [{
                "service_type": "Hotel",
                "description": "Hotel grupal",
                "cost_price": 500,
                "sale_price": 800,
                "quantity": 1,
            }],
        })
        self.assertEqual(created.status_code, 200, created.text)
        budget = created.json()
        self.assertCountEqual(budget["client_ids"], [1, 2])
        self.assertEqual(len(budget["client_names"]), 2)

        converted = self.client.post(f"/api/budgets/{budget['id']}/convert-to-booking")
        self.assertEqual(converted.status_code, 200, converted.text)
        booking = self.client.get(f"/api/bookings/{converted.json()['booking_id']}").json()
        self.assertCountEqual(booking["client_ids"], [1, 2])
        self.assertEqual(len(booking["client_names"]), 2)

    def test_17_clear_activity_logs_by_date_range(self):
        # Verify audit logs can be fetched
        audit_res = self.client.get("/api/audit")
        self.assertEqual(audit_res.status_code, 200)

        # Delete by date range in the past (should delete 0 or matching)
        del_range = self.client.delete("/api/audit?from_date=2020-01-01&to_date=2020-01-02")
        self.assertEqual(del_range.status_code, 200)
        self.assertIn("deleted_count", del_range.json())

        # Delete all logs
        del_all = self.client.delete("/api/audit")
        self.assertEqual(del_all.status_code, 200)
        self.assertIn("deleted_count", del_all.json())

        # Check logs are now empty or only contains newly triggered actions
    def test_18_delete_supplier_payable_and_payment(self):
        # 1. Create a direct expense payable (single payment created automatically)
        expense_payload = {
            "supplier_id": 1,
            "concept": "Gasto operativo test",
            "amount": 15000.0,
            "payment_date": str(date.today()),
            "currency": "ARS",
            "payment_method": "Transferencia",
            "account": "Banco Galicia",
            "receipt_number": "FAC-TEST-999"
        }
        res = self.client.post("/api/supplier-payables/expenses", json=expense_payload)
        self.assertEqual(res.status_code, 200, res.text)
        created_expense = res.json()
        payable_id = created_expense["id"]
        payment_id = created_expense["payments"][0]["id"]

        # Verify payable exists and is Pagado
        payable = self.client.get(f"/api/supplier-payables/{payable_id}")
        self.assertEqual(payable.status_code, 200)
        self.assertEqual(payable.json()["status"], "Pagado")

        # Void/Delete the supplier payment
        del_pay_res = self.client.delete(f"/api/supplier-payables/{payable_id}/payments/{payment_id}")
        self.assertEqual(del_pay_res.status_code, 200)

        # Because it was a direct expense with no other payments, the payable itself should be cleaned up
        payable_check = self.client.get(f"/api/supplier-payables/{payable_id}")
        self.assertEqual(payable_check.status_code, 404)

        # 2. Create a standard invoice payable and test DELETE /api/supplier-payables/{id}
        inv_payload = {
            "supplier_id": 1,
            "invoice_number": "FAC-INV-888",
            "concept": "Factura proveedor a pagar",
            "total_amount": 25000.0,
            "issue_date": str(date.today()),
            "due_date": str(date.today() + timedelta(days=15)),
            "currency": "ARS"
        }
        res_inv = self.client.post("/api/supplier-payables", json=inv_payload)
        self.assertEqual(res_inv.status_code, 200)
        inv_id = res_inv.json()["id"]

        # Delete the whole payable
        del_inv_res = self.client.delete(f"/api/supplier-payables/{inv_id}")
        self.assertEqual(del_inv_res.status_code, 200)

        # Verify it's gone
        inv_check = self.client.get(f"/api/supplier-payables/{inv_id}")
        self.assertEqual(inv_check.status_code, 404)

if __name__ == "__main__":
    unittest.main()

