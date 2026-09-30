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
            "email": "juan.perez@test.com",
            "phone": "+54 9 11 5555-4444",
            "address": "Calle Falsa 123",
            "notes": "Cliente test"
        }
        res = self.client.post("/api/clients", json=new_client)
        self.assertEqual(res.status_code, 200)
        c_data = res.json()
        self.assertEqual(c_data["name"], "Juan Pérez Test")

    def test_04_suppliers(self):
        response = self.client.get("/api/suppliers")
        self.assertEqual(response.status_code, 200)
        suppliers = response.json()
        self.assertGreaterEqual(len(suppliers), 1)

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

        budget_id = b_data["id"]

        # Convert to booking
        conv_res = self.client.post(f"/api/budgets/{budget_id}/convert-to-booking")
        self.assertEqual(conv_res.status_code, 200)
        conv_data = conv_res.json()
        self.assertIn("booking_id", conv_data)
        booking_id = conv_data["booking_id"]

        # Check booking total and balance
        bk_res = self.client.get(f"/api/bookings/{booking_id}")
        self.assertEqual(bk_res.status_code, 200)
        bk_data = bk_res.json()
        self.assertEqual(bk_data["total_amount"], 1800.0)
        self.assertEqual(bk_data["paid_amount"], 0.0)
        self.assertEqual(bk_data["balance_due"], 1800.0)

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

    def test_07_profits_and_partial_distributions(self):
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
        self.assertEqual(budget_profit["gross_profit"], 500.0)
        self.assertEqual(budget_profit["pending_commissions"], 500.0)

        first_payment = self.client.post("/api/profits/commissions", json={
            "profit_id": budget_profit["profit_id"],
            "user_id": 2,
            "amount": 125.0,
            "payment_date": "2026-09-28",
            "payment_method": "Transferencia",
            "notes": "Primer pago parcial"
        })
        self.assertEqual(first_payment.status_code, 200)

        second_payment = self.client.post("/api/profits/commissions", json={
            "profit_id": budget_profit["profit_id"],
            "user_id": 2,
            "amount": 375.0,
            "payment_date": "2026-09-28",
            "payment_method": "Efectivo",
            "notes": "Liquidación del saldo"
        })
        self.assertEqual(second_payment.status_code, 200)

        overpayment = self.client.post("/api/profits/commissions", json={
            "profit_id": budget_profit["profit_id"],
            "user_id": 2,
            "amount": 0.01,
            "payment_date": "2026-09-28",
            "payment_method": "Efectivo"
        })
        self.assertEqual(overpayment.status_code, 400)

        updated = self.client.get("/api/profits/summary").json()
        updated_profit = next(b for b in updated["budgets"] if b["id"] == budget_id)
        self.assertEqual(updated_profit["paid_commissions"], 500.0)
        self.assertEqual(updated_profit["pending_commissions"], 0.0)

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

        logout = self.client.post("/api/users/logout")
        self.assertEqual(logout.status_code, 200)
        audit_final = self.client.get("/api/audit")
        self.assertEqual(audit_final.status_code, 200)
        self.assertEqual(audit_final.json()[0]["action"], "Cierre de sesión")

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

        self.assertEqual(self.client.get("/api/bookings").json(), [])
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

if __name__ == "__main__":
    unittest.main()
