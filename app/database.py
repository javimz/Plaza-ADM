import sqlite3
import os
from app.auth import hash_password

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "travel_agency.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Table: users
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'agente',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Table: clients
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        birth_date TEXT,
        passport_number TEXT,
        passport_expiry TEXT,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Table: suppliers
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        cuit TEXT,
        category TEXT NOT NULL,
        contact_name TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Table: budgets
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        budget_number TEXT UNIQUE NOT NULL,
        client_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        destination TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        exchange_rate REAL DEFAULT 1.0,
        status TEXT NOT NULL DEFAULT 'Borrador',
        total_cost REAL NOT NULL DEFAULT 0.0,
        total_amount REAL NOT NULL DEFAULT 0.0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(client_id) REFERENCES clients(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)

    # Table: budget_items
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS budget_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        budget_id INTEGER NOT NULL,
        service_type TEXT NOT NULL,
        description TEXT NOT NULL,
        supplier_id INTEGER,
        cost_price REAL NOT NULL DEFAULT 0.0,
        sale_price REAL NOT NULL DEFAULT 0.0,
        quantity INTEGER NOT NULL DEFAULT 1,
        subtotal REAL NOT NULL DEFAULT 0.0,
        FOREIGN KEY(budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    );
    """)

    # Table: bookings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_number TEXT UNIQUE NOT NULL,
        budget_id INTEGER,
        client_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        destination TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'Confirmada',
        total_amount REAL NOT NULL DEFAULT 0.0,
        paid_amount REAL NOT NULL DEFAULT 0.0,
        balance_due REAL NOT NULL DEFAULT 0.0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(budget_id) REFERENCES budgets(id),
        FOREIGN KEY(client_id) REFERENCES clients(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS budget_sellers (
        budget_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (budget_id, user_id),
        FOREIGN KEY(budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS booking_sellers (
        booking_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (booking_id, user_id),
        FOREIGN KEY(booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS budget_clients (
        budget_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        PRIMARY KEY (budget_id, client_id),
        FOREIGN KEY(budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
        FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS booking_clients (
        booking_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        PRIMARY KEY (booking_id, client_id),
        FOREIGN KEY(booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
        FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_budget_clients_client ON budget_clients(client_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_booking_clients_client ON booking_clients(client_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_budget_sellers_user ON budget_sellers(user_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_booking_sellers_user ON booking_sellers(user_id);")

    # Table: payments
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_number TEXT UNIQUE NOT NULL,
        booking_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_date TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        concept TEXT,
        payment_type TEXT NOT NULL DEFAULT 'Parcial',
        reference_code TEXT,
        notes TEXT,
        registered_by_user_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(booking_id) REFERENCES bookings(id),
        FOREIGN KEY(client_id) REFERENCES clients(id),
        FOREIGN KEY(registered_by_user_id) REFERENCES users(id)
    );
    """)

    # Supplier payables and their partial/full payment history
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS supplier_payables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL,
        concept TEXT NOT NULL,
        invoice_number TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        total_amount REAL NOT NULL,
        issue_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        notes TEXT,
        created_by_user_id INTEGER,
        booking_id INTEGER,
        budget_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY(booking_id) REFERENCES bookings(id),
        FOREIGN KEY(budget_id) REFERENCES budgets(id),
        FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );
    """)
    cursor.execute("PRAGMA table_info(clients);")
    client_columns = {row["name"] for row in cursor.fetchall()}
    if "birth_date" not in client_columns:
        cursor.execute("ALTER TABLE clients ADD COLUMN birth_date TEXT;")
    if "passport_number" not in client_columns:
        cursor.execute("ALTER TABLE clients ADD COLUMN passport_number TEXT;")
    if "passport_expiry" not in client_columns:
        cursor.execute("ALTER TABLE clients ADD COLUMN passport_expiry TEXT;")

    cursor.execute("PRAGMA table_info(suppliers);")
    supplier_columns = {row["name"] for row in cursor.fetchall()}
    if "cuit" not in supplier_columns:
        cursor.execute("ALTER TABLE suppliers ADD COLUMN cuit TEXT;")
    if "address" not in supplier_columns:
        cursor.execute("ALTER TABLE suppliers ADD COLUMN address TEXT;")

    cursor.execute("PRAGMA table_info(payments);")
    payment_columns = {row["name"] for row in cursor.fetchall()}
    if "concept" not in payment_columns:
        cursor.execute("ALTER TABLE payments ADD COLUMN concept TEXT;")

    cursor.execute("PRAGMA table_info(supplier_payables);")
    payable_columns = {row["name"] for row in cursor.fetchall()}
    if "booking_id" not in payable_columns:
        cursor.execute("ALTER TABLE supplier_payables ADD COLUMN booking_id INTEGER REFERENCES bookings(id);")
    if "budget_id" not in payable_columns:
        cursor.execute("ALTER TABLE supplier_payables ADD COLUMN budget_id INTEGER REFERENCES budgets(id);")
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS supplier_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payable_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_date TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        reference TEXT,
        notes TEXT,
        registered_by_user_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(payable_id) REFERENCES supplier_payables(id) ON DELETE CASCADE,
        FOREIGN KEY(registered_by_user_id) REFERENCES users(id)
    );
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_supplier_payables_due_date ON supplier_payables(due_date);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_supplier_payables_booking ON supplier_payables(booking_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_supplier_payables_budget ON supplier_payables(budget_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_supplier_payments_payable ON supplier_payments(payable_id);")

    # Activity audit log (credentials and request payloads are never stored here)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT NOT NULL,
        role TEXT,
        action TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);")

    conn.commit()

    # Seed data if empty
    cursor.execute("SELECT COUNT(*) FROM users;")
    if cursor.fetchone()[0] == 0:
        seed_initial_data(conn)

    cursor.execute("UPDATE users SET role = 'ventas' WHERE role = 'contador';")
    cursor.execute("UPDATE activity_logs SET role = 'ventas' WHERE role = 'contador';")
    cursor.execute("""
        INSERT OR IGNORE INTO budget_sellers (budget_id, user_id)
        SELECT b.id, b.user_id
        FROM budgets b JOIN users u ON u.id = b.user_id
        WHERE u.role IN ('agente', 'ventas');
    """)
    cursor.execute("""
        INSERT OR IGNORE INTO budget_sellers (budget_id, user_id)
        SELECT b.id, (
            SELECT id FROM users
            WHERE is_active = 1 AND role IN ('agente', 'ventas')
            ORDER BY CASE role WHEN 'agente' THEN 0 ELSE 1 END, id
            LIMIT 1
        )
        FROM budgets b
        WHERE NOT EXISTS (SELECT 1 FROM budget_sellers bs WHERE bs.budget_id = b.id);
    """)
    cursor.execute("""
        INSERT OR IGNORE INTO booking_sellers (booking_id, user_id)
        SELECT bk.id, bs.user_id
        FROM bookings bk JOIN budget_sellers bs ON bs.budget_id = bk.budget_id;
    """)
    cursor.execute("""
        INSERT OR IGNORE INTO booking_sellers (booking_id, user_id)
        SELECT bk.id, bk.user_id
        FROM bookings bk JOIN users u ON u.id = bk.user_id
        WHERE u.role IN ('agente', 'ventas')
          AND NOT EXISTS (SELECT 1 FROM booking_sellers bs WHERE bs.booking_id = bk.id);
    """)
    cursor.execute("""
        INSERT OR IGNORE INTO booking_sellers (booking_id, user_id)
        SELECT bk.id, (
            SELECT id FROM users
            WHERE is_active = 1 AND role IN ('agente', 'ventas')
            ORDER BY CASE role WHEN 'agente' THEN 0 ELSE 1 END, id
            LIMIT 1
        )
        FROM bookings bk
        WHERE NOT EXISTS (SELECT 1 FROM booking_sellers bs WHERE bs.booking_id = bk.id);
    """)

    cursor.execute("""
        INSERT OR IGNORE INTO budget_clients (budget_id, client_id)
        SELECT id, client_id FROM budgets WHERE client_id IS NOT NULL;
    """)
    cursor.execute("""
        INSERT OR IGNORE INTO booking_clients (booking_id, client_id)
        SELECT id, client_id FROM bookings WHERE client_id IS NOT NULL;
    """)

    conn.close()

def seed_initial_data(conn):
    cursor = conn.cursor()

    # Default Users
    admin_pw = hash_password("admin123")
    agente_pw = hash_password("agente123")
    ventas_pw = hash_password("ventas123")

    cursor.execute("""
        INSERT INTO users (username, full_name, email, password_hash, role)
        VALUES 
        ('admin', 'Administrador Principal', 'admin@agenciaviajes.com', ?, 'admin'),
        ('agente', 'Laura Agente de Ventas', 'laura@agenciaviajes.com', ?, 'agente'),
        ('ventas', 'Carlos Responsable de Ventas', 'ventas@agenciaviajes.com', ?, 'ventas');
    """, (admin_pw, agente_pw, ventas_pw))

    # Default Clients
    cursor.execute("""
        INSERT INTO clients (name, document_id, email, phone, address, notes)
        VALUES
        ('María Fernández', 'DNI 35.892.102', 'maria.fernandez@gmail.com', '+54 9 11 4589-1234', 'Av. Corrientes 1420, CABA', 'Cliente frecuente - Preferencia vuelos ejecutivos'),
        ('Roberto Gómez', 'PAS K9823102', 'roberto.gomez@hotmail.com', '+54 9 11 6723-9911', 'Calle San Martín 450, Rosario', 'Viaje familiar proyectado para 4 personas'),
        ('Empresa Tech Solutions S.A.', 'CUIT 30-71239845-8', 'compras@techsolutions.com', '+54 9 11 3300-8800', 'Puerto Madero Edificio Norte, CABA', 'Cuenta corporativa - Requiere facturación A');
    """)

    # Default Suppliers
    cursor.execute("""
        INSERT INTO suppliers (name, category, contact_name, phone, email, notes)
        VALUES
        ('Aerolíneas Argentinas', 'Vuelos', 'Marta Torres', '+54 11 5168-9000', 'agencias@aerolineas.com.ar', 'Operador aéreo nacional e internacional'),
        ('Hotel Riu Cancún', 'Hotel', 'Javier Ramos', '+52 998 881 5000', 'reservas.cancun@riu.com', 'Resort All-Inclusive 5 estrellas'),
        ('Iberia', 'Vuelos', 'Carlos Ruiz', '+34 913 894 356', 'ventas.agencias@iberia.es', 'Conexiones a Europa'),
        ('Assist Card', 'Seguro de Viaje', 'Gisela Rossi', '+54 11 4310-1200', 'corporativo@assistcard.com', 'Cobertura médica y asistencia al viajero global');
    """)

    # Default Budget 1 (Aprobado) & Budget 2 (Borrador)
    cursor.execute("""
        INSERT INTO budgets (budget_number, client_id, user_id, title, destination, start_date, end_date, currency, exchange_rate, status, total_cost, total_amount, notes)
        VALUES
        ('PRES-2026-0001', 1, 2, 'Vacaciones en Cancún All-Inclusive', 'Cancún, México', '2026-11-10', '2026-11-20', 'USD', 1.0, 'Aprobado', 2200.0, 2800.0, 'Incluye pasajes aéreos, 10 noches de hotel y seguro de asistencia médica.'),
        ('PRES-2026-0002', 2, 2, 'Tour por Madrid y Barcelona', 'España', '2027-01-15', '2027-01-25', 'USD', 1.0, 'Borrador', 3400.0, 4200.0, 'Pendiente confirmar disponibilidad de hoteles en Madrid.');
    """)

    # Budget Items for Budget 1
    cursor.execute("""
        INSERT INTO budget_items (budget_id, service_type, description, supplier_id, cost_price, sale_price, quantity, subtotal)
        VALUES
        (1, 'Vuelo', 'Vuelo directo Bs. As. - Cancún ida y vuelta', 1, 1000.0, 1250.0, 1, 1250.0),
        (1, 'Hotel', 'Hotel Riu Cancún All Inclusive (10 noches)', 2, 1100.0, 1400.0, 1, 1400.0),
        (1, 'Seguro', 'Assist Card Cobertura USD 150.000', 4, 100.0, 150.0, 1, 150.0);
    """)

    # Budget Items for Budget 2
    cursor.execute("""
        INSERT INTO budget_items (budget_id, service_type, description, supplier_id, cost_price, sale_price, quantity, subtotal)
        VALUES
        (2, 'Vuelo', 'Vuelo Iberia Bs. As. - Madrid ida y vuelta', 3, 2000.0, 2400.0, 1, 2400.0),
        (2, 'Hotel', 'Hotel 4 estrellas centro de Madrid (7 noches)', 2, 1400.0, 1800.0, 1, 1800.0);
    """)

    # Convert Budget 1 to Booking 1 (RES-2026-0001)
    cursor.execute("""
        INSERT INTO bookings (booking_number, budget_id, client_id, user_id, title, destination, start_date, end_date, currency, status, total_amount, paid_amount, balance_due, notes)
        VALUES
        ('RES-2026-0001', 1, 1, 2, 'Vacaciones en Cancún All-Inclusive', 'Cancún, México', '2026-11-10', '2026-11-20', 'USD', 'Confirmada', 2800.0, 1000.0, 1800.0, 'Reserva confirmada. Seña del 35% recibida.');
    """)

    # Update Budget 1 status to 'Convertido'
    cursor.execute("UPDATE budgets SET status = 'Convertido' WHERE id = 1;")

    # Initial Partial Payment for Booking 1
    cursor.execute("""
        INSERT INTO payments (payment_number, booking_id, client_id, amount, payment_date, payment_method, payment_type, reference_code, notes, registered_by_user_id)
        VALUES
        ('PAG-2026-0001', 1, 1, 1000.0, '2026-09-25', 'Transferencia Bancaria', 'Parcial', 'TRF-8892104', 'Seña inicial para reserva de pasajes y seña de hotel.', 2);
    """)

    conn.commit()
