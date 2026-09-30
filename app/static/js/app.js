// Main JavaScript Controller for Travel Agency ADM System

let currentUser = null;
let authToken = '';
let clientsCache = [];
let suppliersCache = [];
let bookingsCache = [];
let profitsCache = [];
let commissionsCache = [];
let earningsUsersCache = [];
let supplierPayablesCache = [];
let currentReceiptData = null;

document.addEventListener('DOMContentLoaded', () => {
    // Set current date
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date-display').innerText = new Date().toLocaleDateString('es-ES', options);

    // Initial icon render
    if (window.lucide) lucide.createIcons();

    document.getElementById('login-username').focus();
});

async function loginUser(event) {
    event.preventDefault();
    const error = document.getElementById('login-error');
    const submit = document.getElementById('login-submit');
    error.classList.add('hidden');
    submit.disabled = true;
    submit.innerText = 'Verificando...';

    try {
        const response = await fetch('/api/users/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: document.getElementById('login-username').value.trim(),
                password: document.getElementById('login-password').value
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Usuario o contraseña incorrectos');

        authToken = data.access_token;
        currentUser = data.user;
        document.getElementById('user-display-name').innerText = currentUser.full_name || currentUser.username;
        document.getElementById('user-display-role').innerText = currentUser.role || 'usuario';
        document.getElementById('user-avatar').innerText = (currentUser.full_name || currentUser.username || 'U').charAt(0).toUpperCase();
        document.getElementById('nav-audit').classList.toggle('hidden', !['admin', 'contador'].includes(currentUser.role));
        document.getElementById('nav-user-earnings').classList.toggle('hidden', !['admin', 'contador'].includes(currentUser.role));
        document.getElementById('login-password').value = '';
        document.getElementById('login-screen').classList.add('hidden');
        loadClientsCache();
        loadSuppliersCache();
        switchTab('dashboard');
    } catch (err) {
        error.innerText = err.message || 'No se pudo iniciar sesión. Intente nuevamente.';
        error.classList.remove('hidden');
        document.getElementById('login-password').value = '';
        document.getElementById('login-password').focus();
    } finally {
        submit.disabled = false;
        submit.innerHTML = '<i data-lucide="log-in" class="w-4 h-4"></i> Ingresar al sistema';
        if (window.lucide) lucide.createIcons();
    }
}

// Helper for HTTP requests
async function apiFetch(url, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    try {
        const response = await fetch(url, config);
        if (!response.ok) {
            const errData = await response.json();
            if (response.status === 401 && authToken) {
                logout('La sesión expiró. Inicie sesión nuevamente.');
                throw new Error('Sesión expirada');
            }
            throw new Error(errData.detail || 'Error en la solicitud');
        }
        return await response.json();
    } catch (err) {
        if (err.message !== 'Sesión expirada') alert('Error: ' + err.message);
        throw err;
    }
}

// TAB SWITCHING
function switchTab(tabId) {
    const tabs = ['dashboard', 'budgets', 'bookings', 'payments', 'supplier-payables', 'profits', 'user-earnings', 'audit', 'clients', 'suppliers', 'users'];
    const pageTitles = {
        'dashboard': 'Dashboard General',
        'budgets': 'Gestión de Presupuestos',
        'bookings': 'Expedientes & Control de Pagos',
        'payments': 'Historial General de Pagos Parciales',
        'supplier-payables': 'Pagos a Proveedores',
        'profits': 'Ganancias y Comisiones',
        'user-earnings': 'Ganancias por Usuario',
        'audit': 'Log de Actividad',
        'clients': 'Directorio de Clientes',
        'suppliers': 'Catálogo de Proveedores',
        'users': 'Administración de Usuarios'
    };

    tabs.forEach(t => {
        const view = document.getElementById(`view-${t}`);
        const navBtn = document.getElementById(`nav-${t}`);
        if (view) view.classList.add('hidden');
        if (navBtn) {
            navBtn.classList.remove('bg-blue-600', 'text-white');
            navBtn.classList.add('text-slate-300');
        }
    });

    const activeView = document.getElementById(`view-${tabId}`);
    const activeNav = document.getElementById(`nav-${tabId}`);
    if (activeView) activeView.classList.remove('hidden');
    if (activeNav) {
        activeNav.classList.add('bg-blue-600', 'text-white');
        activeNav.classList.remove('text-slate-300');
    }

    document.getElementById('page-title').innerText = pageTitles[tabId] || 'Panel de Administración';

    // Refresh tab content
    if (tabId === 'dashboard') loadDashboard();
    if (tabId === 'budgets') loadBudgets();
    if (tabId === 'bookings') loadBookings();
    if (tabId === 'payments') loadPaymentsHistory();
    if (tabId === 'supplier-payables') loadSupplierPayables();
    if (tabId === 'profits') loadProfits();
    if (tabId === 'user-earnings') loadUserEarningsDashboard();
    if (tabId === 'audit') loadAuditLogs();
    if (tabId === 'clients') loadClients();
    if (tabId === 'suppliers') loadSuppliers();
    if (tabId === 'users') loadUsers();

    if (window.lucide) lucide.createIcons();
}

function localDateString(date = new Date()) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function canManageSupplierPayables() {
    return currentUser && ['admin', 'contador'].includes(currentUser.role);
}

async function loadSupplierPayables() {
    try {
        const data = await apiFetch('/api/supplier-payables/summary');
        supplierPayablesCache = data.payables || [];
        const byCurrency = data.by_currency || {};
        const outstanding = Object.entries(byCurrency).map(([currency, totals]) => formatProfitAmount(currency, totals.balance_due)).join(' · ') || formatProfitAmount('USD', 0);
        const overdueCount = supplierPayablesCache.filter(item => item.status === 'Vencido').length;
        const dueSoonCount = supplierPayablesCache.filter(item => item.status === 'Vence pronto').length;
        document.getElementById('supplier-payables-kpis').innerHTML = `
            <div class="rounded-2xl border border-blue-200 bg-blue-50 p-4"><p class="text-[10px] font-semibold uppercase text-blue-700">Saldo pendiente</p><p class="mt-1 text-sm font-bold text-blue-900">${outstanding}</p></div>
            <div class="rounded-2xl border border-slate-200 bg-white p-4"><p class="text-[10px] font-semibold uppercase text-slate-500">Cuentas abiertas</p><p class="mt-1 text-xl font-bold text-slate-900">${supplierPayablesCache.filter(item => item.balance_due > 0.009).length}</p></div>
            <div class="rounded-2xl border border-rose-200 bg-rose-50 p-4"><p class="text-[10px] font-semibold uppercase text-rose-700">Vencidas</p><p class="mt-1 text-xl font-bold text-rose-900">${overdueCount}</p></div>
            <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p class="text-[10px] font-semibold uppercase text-amber-700">Vencen en 7 días</p><p class="mt-1 text-xl font-bold text-amber-900">${dueSoonCount}</p></div>`;

        renderSupplierReminders(data.reminders || []);
        renderSupplierPayables();
    } catch (e) { console.error(e); }
}

function renderSupplierReminders(reminders) {
    const container = document.getElementById('supplier-reminders-list');
    document.getElementById('supplier-reminders-count').innerText = reminders.length;
    if (!reminders.length) {
        container.innerHTML = '<p class="text-sm text-emerald-800 md:col-span-2 xl:col-span-3">No hay cuentas vencidas ni vencimientos en los próximos 7 días.</p>';
        return;
    }
    container.innerHTML = reminders.map(item => {
        const overdue = item.status === 'Vencido';
        return `<button type="button" onclick="showSupplierPayableDetails(${item.id})" class="text-left rounded-xl border ${overdue ? 'border-rose-200 bg-white' : 'border-amber-200 bg-white'} p-3 hover:shadow-sm transition">
            <div class="flex items-center justify-between gap-2"><span class="text-xs font-bold ${overdue ? 'text-rose-700' : 'text-amber-800'}">${overdue ? 'VENCIDO' : 'PRÓXIMO'}</span><span class="text-[11px] text-slate-500">${escapeProfitText(item.due_date)}</span></div>
            <p class="mt-1 text-sm font-semibold text-slate-800 truncate">${escapeProfitText(item.supplier_name)}</p>
            <div class="flex items-center justify-between gap-2 text-xs"><span class="text-slate-500 truncate">${escapeProfitText(item.concept)}</span><b class="whitespace-nowrap ${overdue ? 'text-rose-700' : 'text-amber-800'}">${formatProfitAmount(item.currency, item.balance_due)}</b></div>
        </button>`;
    }).join('');
}

function renderSupplierPayables() {
    const tbody = document.getElementById('supplier-payables-table-body');
    const query = (document.getElementById('supplier-payables-search').value || '').trim().toLocaleLowerCase('es');
    const selectedStatus = document.getElementById('supplier-payables-status').value;
    const rows = supplierPayablesCache.filter(item => {
        const matchesQuery = !query || [item.supplier_name, item.concept, item.invoice_number, item.notes].join(' ').toLocaleLowerCase('es').includes(query);
        return matchesQuery && (selectedStatus === 'all' || item.status === selectedStatus);
    });
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-5 text-center text-slate-400">No hay cuentas por pagar para estos filtros.</td></tr>';
        return;
    }
    const canManage = canManageSupplierPayables();
    const statusStyles = {
        'Vencido': 'bg-rose-100 text-rose-800',
        'Vence pronto': 'bg-amber-100 text-amber-800',
        'Parcial': 'bg-blue-100 text-blue-800',
        'Pendiente': 'bg-slate-100 text-slate-700',
        'Pagado': 'bg-emerald-100 text-emerald-800'
    };
    tbody.innerHTML = rows.map(item => `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
            <td class="p-4 font-semibold text-slate-800">${escapeProfitText(item.supplier_name)}<span class="block text-xs font-normal text-slate-500">${escapeProfitText(item.supplier_category || '')}</span></td>
            <td class="p-4">${escapeProfitText(item.concept)}<span class="block text-xs text-slate-500">${escapeProfitText(item.invoice_number || 'Sin Nº de factura')}</span></td>
            <td class="p-4 whitespace-nowrap">${escapeProfitText(item.due_date)}</td>
            <td class="p-4 text-right">${formatProfitAmount(item.currency, item.total_amount)}</td>
            <td class="p-4 text-right text-emerald-700">${formatProfitAmount(item.currency, item.paid_amount)}</td>
            <td class="p-4 text-right font-bold ${item.balance_due > 0.009 ? 'text-amber-700' : 'text-slate-400'}">${formatProfitAmount(item.currency, item.balance_due)}</td>
            <td class="p-4"><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[item.status] || 'bg-slate-100 text-slate-700'}">${escapeProfitText(item.status)}</span></td>
            <td class="p-4 text-right"><div class="flex justify-end gap-1.5"><button onclick="showSupplierPayableDetails(${item.id})" class="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">Detalle (${item.payment_count})</button>${canManage && item.balance_due > 0.009 ? `<button onclick="openSupplierPaymentModal(${item.id})" class="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Registrar pago</button>` : ''}</div></td>
        </tr>`).join('');
}

async function openSupplierPayableModal() {
    if (!canManageSupplierPayables()) return alert('Se requieren permisos de administración o contabilidad.');
    try {
        if (!suppliersCache.length) suppliersCache = await apiFetch('/api/suppliers');
        const select = document.getElementById('sp-supplier-id');
        select.innerHTML = '<option value="">Seleccionar proveedor...</option>' + suppliersCache.map(supplier =>
            `<option value="${supplier.id}">${escapeProfitText(supplier.name)} · ${escapeProfitText(supplier.category)}</option>`
        ).join('');
        document.getElementById('form-supplier-payable').reset();
        const today = localDateString();
        document.getElementById('sp-issue-date').value = today;
        const dueDefault = new Date(`${today}T12:00:00`);
        dueDefault.setDate(dueDefault.getDate() + 30);
        document.getElementById('sp-due-date').value = localDateString(dueDefault);
        openModal('modal-supplier-payable');
    } catch (e) { console.error(e); }
}

async function saveSupplierPayable(event) {
    event.preventDefault();
    const payload = {
        supplier_id: parseInt(document.getElementById('sp-supplier-id').value),
        concept: document.getElementById('sp-concept').value.trim(),
        invoice_number: document.getElementById('sp-invoice').value.trim(),
        currency: document.getElementById('sp-currency').value,
        total_amount: parseFloat(document.getElementById('sp-total').value),
        issue_date: document.getElementById('sp-issue-date').value,
        due_date: document.getElementById('sp-due-date').value,
        notes: document.getElementById('sp-notes').value.trim()
    };
    try {
        await apiFetch('/api/supplier-payables', 'POST', payload);
        closeModal('modal-supplier-payable');
        await loadSupplierPayables();
    } catch (e) { console.error(e); }
}

function openSupplierPaymentModal(payableId) {
    if (!canManageSupplierPayables()) return alert('Se requieren permisos de administración o contabilidad.');
    const payable = supplierPayablesCache.find(item => item.id === payableId);
    if (!payable || payable.balance_due <= 0.009) return;
    document.getElementById('form-supplier-payment').reset();
    document.getElementById('supplier-payment-payable-id').value = payable.id;
    document.getElementById('supplier-payment-subtitle').innerText = `${payable.supplier_name} · ${payable.concept}`;
    document.getElementById('supplier-payment-balance').innerText = formatProfitAmount(payable.currency, payable.balance_due);
    const amount = document.getElementById('supplier-payment-amount');
    amount.max = payable.balance_due.toFixed(2);
    amount.value = payable.balance_due.toFixed(2);
    document.getElementById('supplier-payment-date').value = localDateString();
    openModal('modal-supplier-payment');
}

async function saveSupplierPayment(event) {
    event.preventDefault();
    const payableId = document.getElementById('supplier-payment-payable-id').value;
    const payload = {
        amount: parseFloat(document.getElementById('supplier-payment-amount').value),
        payment_date: document.getElementById('supplier-payment-date').value,
        payment_method: document.getElementById('supplier-payment-method').value,
        reference: document.getElementById('supplier-payment-reference').value.trim(),
        notes: document.getElementById('supplier-payment-notes').value.trim()
    };
    try {
        await apiFetch(`/api/supplier-payables/${payableId}/payments`, 'POST', payload);
        closeModal('modal-supplier-payment');
        await loadSupplierPayables();
    } catch (e) { console.error(e); }
}

async function showSupplierPayableDetails(payableId) {
    try {
        const payable = await apiFetch(`/api/supplier-payables/${payableId}`);
        document.getElementById('supplier-payable-detail-title').innerText = `${payable.supplier_name} · ${payable.concept}`;
        document.getElementById('supplier-payable-detail-subtitle').innerText = `Factura ${payable.invoice_number || '—'} · Emitida ${payable.issue_date} · Vence ${payable.due_date} · ${payable.status}`;
        document.getElementById('supplier-detail-total').innerText = formatProfitAmount(payable.currency, payable.total_amount);
        document.getElementById('supplier-detail-paid').innerText = formatProfitAmount(payable.currency, payable.paid_amount);
        document.getElementById('supplier-detail-balance').innerText = formatProfitAmount(payable.currency, payable.balance_due);
        const body = document.getElementById('supplier-payable-payments-body');
        body.innerHTML = payable.payments?.length ? payable.payments.map(payment => `
            <tr class="border-b border-slate-100"><td class="p-3">${escapeProfitText(payment.payment_date)}</td><td class="p-3 text-right font-semibold text-emerald-700">${formatProfitAmount(payable.currency, payment.amount)}</td><td class="p-3">${escapeProfitText(payment.payment_method)}</td><td class="p-3">${escapeProfitText(payment.reference || '-')}</td><td class="p-3">${escapeProfitText(payment.registered_by_name || '-')}</td><td class="p-3">${escapeProfitText(payment.notes || '-')}</td></tr>`).join('') : '<tr><td colspan="6" class="p-5 text-center text-slate-400">Todavía no hay pagos registrados para esta cuenta.</td></tr>';
        openModal('modal-supplier-payable-detail');
    } catch (e) { console.error(e); }
}

// GANANCIAS Y DISTRIBUCIONES
function formatProfitAmount(currency, amount) {
    return `${currency || 'USD'} $ ${Number(amount || 0).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

function formatProfitTotals(byCurrency, key, fallback = 0) {
    const entries = Object.entries(byCurrency || {});
    if (entries.length === 0) return formatProfitAmount('USD', fallback);
    return entries.map(([currency, totals]) => formatProfitAmount(currency, totals[key])).join(' · ');
}

function escapeProfitText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

async function loadProfits() {
    try {
        const [data, commissions] = await Promise.all([
            apiFetch('/api/profits/summary'),
            apiFetch('/api/profits/commissions')
        ]);
        profitsCache = data.budgets || [];
        commissionsCache = commissions || [];
        const totals = data.summary || {};
        const byCurrency = totals.by_currency || {};
        document.getElementById('kpi-total-sale').innerText = formatProfitTotals(byCurrency, 'total_sale', totals.total_sale);
        document.getElementById('kpi-total-cost').innerText = formatProfitTotals(byCurrency, 'total_cost', totals.total_cost);
        document.getElementById('kpi-gross-profit').innerText = formatProfitTotals(byCurrency, 'gross_profit', totals.gross_profit);
        document.getElementById('kpi-paid-comm').innerText = formatProfitTotals(byCurrency, 'paid_commissions', totals.paid_commissions);
        document.getElementById('kpi-pending-comm').innerText = formatProfitTotals(byCurrency, 'pending_commissions', totals.pending_commissions);

        const body = document.getElementById('profits-table-body');
        if (profitsCache.length === 0) {
            body.innerHTML = '<tr><td colspan="11" class="p-6 text-center text-slate-400">No hay presupuestos para calcular ganancias</td></tr>';
        } else {
            body.innerHTML = profitsCache.map(b => {
                const canPay = ['Aprobado', 'Convertido'].includes(b.status) && b.pending_commissions > 0.009;
                const operation = b.booking_number || b.budget_number;
                const paymentCount = commissionsCache.filter(payment => payment.budget_id === b.id).length;
                return `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td class="p-3 font-semibold text-slate-800">${escapeProfitText(operation)}<span class="block text-xs font-normal text-slate-400">${escapeProfitText(b.booking_number ? b.budget_number : '')}</span></td>
                        <td class="p-3">${escapeProfitText(b.client_name || 'Sin cliente')}</td>
                        <td class="p-3">${escapeProfitText(b.destination || '-')}<span class="block text-xs text-slate-400">${escapeProfitText(b.title || '')}</span></td>
                        <td class="p-3 text-right">${formatProfitAmount(b.currency, b.total_amount)}</td>
                        <td class="p-3 text-right">${formatProfitAmount(b.currency, b.total_cost)}</td>
                        <td class="p-3 text-right font-bold ${b.gross_profit >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${formatProfitAmount(b.currency, b.gross_profit)}</td>
                        <td class="p-3 text-right">${Number(b.margin_pct || 0).toFixed(2)}%</td>
                        <td class="p-3 text-right text-violet-700">${formatProfitAmount(b.currency, b.paid_commissions)}</td>
                        <td class="p-3 text-right font-semibold text-rose-700">${formatProfitAmount(b.currency, b.pending_commissions)}</td>
                        <td class="p-3 text-center"><span class="px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-700">${escapeProfitText(b.booking_status || b.status)}</span></td>
                        <td class="p-3 text-center"><div class="flex flex-col items-center gap-1.5"><button onclick="openProfitPaymentDetails(${b.id})" class="whitespace-nowrap bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-lg">Ver detalle (${paymentCount})</button>${canPay ? `<button onclick="openProfitDistribution(${b.id})" class="whitespace-nowrap bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-lg">Registrar pago</button>` : '<span class="text-xs text-slate-400">Saldo completo o no disponible</span>'}</div></td>
                    </tr>`;
            }).join('');
        }

        const historyBody = document.getElementById('commissions-table-body');
        if (!commissions.length) {
            historyBody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">Sin pagos de ganancias registrados</td></tr>';
        } else {
            const canDelete = ['admin', 'contador'].includes(currentUser.role);
            historyBody.innerHTML = commissions.map(p => `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td class="p-3 font-semibold">${escapeProfitText(p.budget_number)}<span class="block text-xs font-normal text-slate-400">${escapeProfitText(p.budget_title || '')}</span></td>
                    <td class="p-3">${escapeProfitText(p.user_name || '-')}</td>
                    <td class="p-3 text-right font-bold text-violet-700">${formatProfitAmount(p.currency, p.amount)}</td>
                    <td class="p-3">${escapeProfitText(p.payment_method || '-')}</td>
                    <td class="p-3">${escapeProfitText(p.payment_date || '-')}</td>
                    <td class="p-3">${escapeProfitText(p.notes || '-')}</td>
                    <td class="p-3 text-center">${canDelete ? `<button onclick="deleteProfitDistribution(${p.id})" class="text-rose-500 hover:text-rose-700 text-xs font-semibold">Anular</button>` : '-'}</td>
                </tr>`).join('');
        }
            applySectionSearch('view-profits');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error(e); }
}

async function loadUserEarningsDashboard() {
    try {
        const [commissions, users] = await Promise.all([
            apiFetch('/api/profits/commissions'),
            apiFetch('/api/users')
        ]);
        commissionsCache = commissions || [];
        earningsUsersCache = (users || []).filter(user => user.is_active);
        const userSelect = document.getElementById('earnings-filter-user');
        const selectedUser = userSelect.value || 'all';
        const currencies = new Set();
        commissionsCache.forEach(payment => {
            currencies.add(payment.currency || 'USD');
        });

        userSelect.innerHTML = '<option value="all">Todos los usuarios</option>' +
            earningsUsersCache.slice().sort((a, b) => a.full_name.localeCompare(b.full_name, 'es')).map(user =>
                `<option value="${user.id}">${escapeProfitText(user.full_name)}</option>`
            ).join('');
        userSelect.value = earningsUsersCache.some(user => String(user.id) === selectedUser) ? selectedUser : 'all';

        const currencySelect = document.getElementById('earnings-filter-currency');
        const selectedCurrency = currencySelect.value || 'all';
        currencySelect.innerHTML = '<option value="all">Todas las monedas</option>' +
            [...currencies].sort().map(currency => `<option value="${escapeProfitText(currency)}">${escapeProfitText(currency)}</option>`).join('');
        currencySelect.value = currencies.has(selectedCurrency) ? selectedCurrency : 'all';
        renderUserEarningsDashboard();
    } catch (e) { console.error(e); }
}

function renderUserEarningsDashboard() {
    const userFilter = document.getElementById('earnings-filter-user').value;
    const currencyFilter = document.getElementById('earnings-filter-currency').value;
    const dateFrom = document.getElementById('earnings-filter-from').value;
    const dateTo = document.getElementById('earnings-filter-to').value;
    const filtered = commissionsCache.filter(payment => {
        const date = String(payment.payment_date || '').slice(0, 10);
        return (userFilter === 'all' || String(payment.user_id) === userFilter) &&
            (currencyFilter === 'all' || (payment.currency || 'USD') === currencyFilter) &&
            (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
    });

    const totalsByCurrency = {};
    const byUserCurrency = new Map();
    const byMonthCurrency = new Map();
    const userNames = new Set();
    filtered.forEach(payment => {
        const currency = payment.currency || 'USD';
        const amount = Number(payment.amount || 0);
        const userKey = `${payment.user_id}|${currency}`;
        const userSummary = byUserCurrency.get(userKey) || {
            user_id: payment.user_id,
            user_name: payment.user_name || `Usuario ${payment.user_id}`,
            user_role: payment.user_role || '-',
            currency,
            total: 0,
            count: 0,
            latest: ''
        };
        userSummary.total += amount;
        userSummary.count += 1;
        userSummary.latest = userSummary.latest > payment.payment_date ? userSummary.latest : payment.payment_date;
        byUserCurrency.set(userKey, userSummary);
        userNames.add(String(payment.user_id));

        totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + amount;
        const month = String(payment.payment_date || '').slice(0, 7) || 'Sin fecha';
        const monthKey = `${month}|${currency}`;
        byMonthCurrency.set(monthKey, (byMonthCurrency.get(monthKey) || 0) + amount);
    });

    const totalLabel = Object.keys(totalsByCurrency).length
        ? Object.entries(totalsByCurrency).sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => formatProfitAmount(currency, amount)).join(' · ')
        : formatProfitAmount(currencyFilter === 'all' ? 'USD' : currencyFilter, 0);
    document.getElementById('earnings-kpi-total').innerText = totalLabel;
    document.getElementById('earnings-kpi-payments').innerText = String(filtered.length);
    document.getElementById('earnings-kpi-users').innerText = String(userNames.size);

    const summaryRows = [...byUserCurrency.values()];
    const visibleUsers = earningsUsersCache.filter(user => userFilter === 'all' || String(user.id) === userFilter);
    const availableCurrencies = [...new Set(commissionsCache.map(payment => payment.currency || 'USD'))].sort();
    visibleUsers.forEach(user => {
        const userCurrencies = currencyFilter === 'all'
            ? (availableCurrencies.length ? availableCurrencies : ['-'])
            : [currencyFilter];
        userCurrencies.forEach(currency => {
            const key = `${user.id}|${currency}`;
            if (!byUserCurrency.has(key)) {
                summaryRows.push({
                    user_id: user.id,
                    user_name: user.full_name,
                    user_role: user.role || '-',
                    currency,
                    total: 0,
                    count: 0,
                    latest: '-'
                });
            }
        });
    });
    summaryRows.sort((a, b) => a.user_name.localeCompare(b.user_name, 'es') || a.currency.localeCompare(b.currency));
    const summaryBody = document.getElementById('earnings-user-summary-body');
    summaryBody.innerHTML = summaryRows.length ? summaryRows.map(row => `
        <tr class="border-b border-slate-100 hover:bg-slate-50">
            <td class="p-4 font-semibold text-slate-800">${escapeProfitText(row.user_name)}</td>
            <td class="p-4 capitalize">${escapeProfitText(row.user_role)}</td>
            <td class="p-4">${escapeProfitText(row.currency)}</td>
            <td class="p-4 text-right font-bold text-violet-700">${formatProfitAmount(row.currency, row.total)}</td>
            <td class="p-4 text-right">${row.count}</td>
            <td class="p-4">${escapeProfitText(row.latest || '-')}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="p-5 text-center text-slate-400">No hay pagos en el período y filtros seleccionados.</td></tr>';

    renderUserEarningsCharts(summaryRows, filtered);

    const detailBody = document.getElementById('earnings-payment-detail-body');
    detailBody.innerHTML = filtered.length ? filtered.map(payment => `
        <tr class="border-b border-slate-100 hover:bg-slate-50">
            <td class="p-4 whitespace-nowrap">${escapeProfitText(payment.payment_date || '-')}</td>
            <td class="p-4 font-semibold">${escapeProfitText(payment.user_name || '-')}<span class="block text-xs font-normal text-slate-500 capitalize">${escapeProfitText(payment.user_role || '')}</span></td>
            <td class="p-4">${escapeProfitText(payment.budget_number || '-')}<span class="block text-xs text-slate-500">${escapeProfitText(payment.budget_title || '')}</span></td>
            <td class="p-4 text-right font-bold text-violet-700">${formatProfitAmount(payment.currency, payment.amount)}</td>
            <td class="p-4">${escapeProfitText(payment.payment_method || '-')}</td>
            <td class="p-4">${escapeProfitText(payment.notes || '-')}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="p-5 text-center text-slate-400">No hay distribuciones para mostrar con estos filtros.</td></tr>';
}

function renderUserEarningsCharts(summaryRows, filteredPayments) {
    const userChart = document.getElementById('earnings-user-chart');
    const currencies = [...new Set(summaryRows.map(row => row.currency))].sort();
    if (!summaryRows.length) {
        userChart.innerHTML = '<p class="text-sm text-slate-400 py-8 text-center">No hay datos para graficar.</p>';
    } else {
        userChart.innerHTML = currencies.map(currency => {
            const rows = summaryRows.filter(row => row.currency === currency).sort((a, b) => b.total - a.total);
            const maxTotal = Math.max(...rows.map(row => row.total), 1);
            return `<div class="space-y-3 ${currencies.length > 1 ? 'mb-5' : ''}">
                ${currencies.length > 1 ? `<p class="text-xs font-bold uppercase tracking-wide text-slate-500">${escapeProfitText(currency)}</p>` : ''}
                ${rows.map(row => `<div>
                    <div class="flex justify-between gap-3 text-xs mb-1"><span class="font-medium text-slate-700 truncate">${escapeProfitText(row.user_name)}</span><span class="font-bold text-slate-800 whitespace-nowrap">${formatProfitAmount(currency, row.total)}</span></div>
                    <div class="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div class="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style="width:${Math.max(2, (row.total / maxTotal) * 100)}%"></div></div>
                </div>`).join('')}
            </div>`;
        }).join('');
    }

    const monthChart = document.getElementById('earnings-month-chart');
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const chartColors = ['#0f766e', '#334155', '#ef4444', '#eab308', '#8b5cf6', '#0284c7', '#f97316', '#db2777', '#65a30d', '#0891b2'];
    const chartsByCurrency = [...new Set(filteredPayments.map(payment => payment.currency || 'USD'))].sort();
    if (!filteredPayments.length) {
        monthChart.innerHTML = '<p class="w-full text-sm text-slate-400 py-8 text-center">Sin pagos dentro del período elegido.</p>';
        return;
    }

    const svgWidth = 960;
    const svgHeight = 220;
    const plot = { left: 54, right: 22, top: 20, bottom: 38 };
    const plotWidth = svgWidth - plot.left - plot.right;
    const plotHeight = svgHeight - plot.top - plot.bottom;
    monthChart.classList.remove('min-h-56', 'flex', 'items-end', 'gap-2', 'overflow-x-auto', 'border-b', 'border-slate-200', 'pb-2');
    monthChart.classList.add('space-y-3');

    monthChart.innerHTML = chartsByCurrency.map(currency => {
        const series = new Map();
        filteredPayments.filter(payment => (payment.currency || 'USD') === currency).forEach(payment => {
            const month = Number(String(payment.payment_date || '').slice(5, 7)) - 1;
            if (month < 0 || month > 11) return;
            const userId = String(payment.user_id ?? payment.user_name ?? 'unknown');
            if (!series.has(userId)) {
                series.set(userId, {
                    name: payment.user_name || `Usuario ${userId}`,
                    values: Array(12).fill(0)
                });
            }
            series.get(userId).values[month] += Number(payment.amount || 0);
        });

        const users = [...series.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'));
        if (!users.length) return '';
        const maxValue = Math.max(...users.flatMap(([, row]) => row.values), 0);
        const yMax = maxValue > 0 ? maxValue * 1.15 : 1;
        const x = index => plot.left + (index * plotWidth / 11);
        const y = value => plot.top + plotHeight - (value / yMax) * plotHeight;
        const grid = Array.from({length: 4}, (_, index) => {
            const value = yMax * index / 3;
            const yPos = y(value);
            return `<g><line x1="${plot.left}" y1="${yPos}" x2="${svgWidth - plot.right}" y2="${yPos}" stroke="#e2e8f0" stroke-width="1"/><text x="${plot.left - 8}" y="${yPos + 4}" text-anchor="end" fill="#64748b" font-size="10">${value.toLocaleString('es-AR', {maximumFractionDigits: 0})}</text></g>`;
        }).join('');
        const xLabels = months.map((month, index) => `<text x="${x(index)}" y="${svgHeight - 15}" text-anchor="middle" fill="#475569" font-size="11" font-weight="600">${month}</text>`).join('');
        const lines = users.map(([userId, row], userIndex) => {
            const values = row.values;
            const color = chartColors[userIndex % chartColors.length];
            const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
            const dots = values.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="${value > 0 ? 4 : 2}" fill="${color}"><title>${months[index]} · ${escapeProfitText(row.name)}: ${formatProfitAmount(currency, value)}</title></circle>${value > 0 ? `<text x="${x(index)}" y="${y(value) - 8}" text-anchor="middle" fill="#475569" font-size="9">${value.toLocaleString('es-AR', {maximumFractionDigits: 0})}</text>` : ''}`).join('');
            return `<g data-user-id="${escapeProfitText(userId)}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}</g>`;
        }).join('');
        const legend = users.map(([, row], index) => `<span class="inline-flex items-center gap-1.5 text-xs text-slate-600"><span class="w-2.5 h-2.5 rounded-full" style="background:${chartColors[index % chartColors.length]}"></span>${escapeProfitText(row.name)}</span>`).join('');

        return `<div class="rounded-xl border border-slate-100 p-3">
            <div class="flex items-center justify-between gap-3 mb-2"><p class="text-xs font-semibold text-slate-500 uppercase">${escapeProfitText(currency)}</p><div class="flex flex-wrap gap-x-3 gap-y-1">${legend}</div></div>
            <div class="w-full min-w-0"><svg viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Ganancias mensuales en ${escapeProfitText(currency)} por usuario" class="block w-full max-w-full h-auto">${grid}${xLabels}${lines}</svg></div>
        </div>`;
    }).join('') || '<p class="w-full text-sm text-slate-400 py-8 text-center">No hay fechas de pago válidas para graficar.</p>';
}

function openProfitPaymentDetails(budgetId) {
    const budget = profitsCache.find(item => item.id === budgetId);
    if (!budget) return;
    const payments = commissionsCache.filter(payment => payment.budget_id === budgetId);
    document.getElementById('profit-history-title').innerText = `Pagos registrados · ${budget.budget_number}`;
    document.getElementById('profit-history-subtitle').innerText = `${budget.title} · ${budget.client_name || 'Sin cliente'} · Ganancia ${formatProfitAmount(budget.currency, budget.gross_profit)}`;
    const totalWithdrawn = payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
    document.getElementById('profit-history-total').innerText = formatProfitAmount(budget.currency, totalWithdrawn);
    document.getElementById('profit-history-balance').innerText = formatProfitAmount(budget.currency, Math.max(0, Number(budget.gross_profit || 0) - totalWithdrawn));
    document.getElementById('profit-history-payment-count').innerText = `${payments.length} ${payments.length === 1 ? 'pago' : 'pagos'}`;
    const tbody = document.getElementById('profit-history-table-body');
    if (!payments.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">No hay pagos registrados para esta ganancia.</td></tr>';
    } else {
        tbody.innerHTML = payments.map(payment => `
            <tr class="border-b border-slate-100 hover:bg-slate-50">
                <td class="p-3">${escapeProfitText(payment.payment_date || '-')}</td>
                <td class="p-3 font-semibold">${escapeProfitText(payment.user_name || '-')}</td>
                <td class="p-3 text-right font-bold text-violet-700">${formatProfitAmount(budget.currency, payment.amount)}</td>
                <td class="p-3">${escapeProfitText(payment.payment_method || '-')}</td>
                <td class="p-3">${escapeProfitText(payment.notes || '-')}</td>
                <td class="p-3 text-xs text-slate-500">${escapeProfitText(payment.created_at || '-')}</td>
            </tr>`).join('');
    }
    openModal('modal-profit-history');
}

async function openProfitDistribution(budgetId) {
    const budget = profitsCache.find(item => item.id === budgetId);
    if (!budget || !['Aprobado', 'Convertido'].includes(budget.status) || budget.pending_commissions <= 0.009) {
        alert('No hay saldo disponible para distribuir en esta operación.');
        return;
    }

    const users = await apiFetch('/api/users');
    const activeUsers = users.filter(user => user.is_active);
    const select = document.getElementById('pdist-user-id');
    select.innerHTML = '<option value="">Seleccionar usuario...</option>' + activeUsers.map(user =>
        `<option value="${user.id}">${escapeProfitText(user.full_name)} (${escapeProfitText(user.role)})</option>`
    ).join('');
    document.getElementById('pdist-profit-id').value = budget.profit_id;
    document.getElementById('profit-modal-subtitle').innerText = `${budget.budget_number} · ${budget.title}`;
    document.getElementById('pdist-gross-profit').innerText = formatProfitAmount(budget.currency, budget.gross_profit);
    document.getElementById('pdist-paid').innerText = formatProfitAmount(budget.currency, budget.paid_commissions);
    document.getElementById('pdist-pending').innerText = formatProfitAmount(budget.currency, budget.pending_commissions);
    const amount = document.getElementById('pdist-amount');
    amount.value = '';
    amount.min = '0.01';
    amount.max = budget.pending_commissions.toFixed(2);
    document.getElementById('pdist-date').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    document.getElementById('pdist-notes').value = '';
    openModal('modal-profit-distribution');
}

async function saveProfitDistribution(e) {
    e.preventDefault();
    const payload = {
        profit_id: parseInt(document.getElementById('pdist-profit-id').value),
        user_id: parseInt(document.getElementById('pdist-user-id').value),
        amount: parseFloat(document.getElementById('pdist-amount').value),
        payment_date: document.getElementById('pdist-date').value,
        payment_method: document.getElementById('pdist-method').value,
        notes: document.getElementById('pdist-notes').value
    };
    try {
        await apiFetch('/api/profits/commissions', 'POST', payload);
        closeModal('modal-profit-distribution');
        document.getElementById('form-profit-distribution').reset();
        await loadProfits();
    } catch (e) { console.error(e); }
}

async function deleteProfitDistribution(paymentId) {
    if (!confirm('¿Confirma anular este pago? El saldo volverá a quedar disponible para distribuir.')) return;
    try {
        await apiFetch(`/api/profits/commissions/${paymentId}`, 'DELETE');
        await loadProfits();
    } catch (e) { console.error(e); }
}

async function loadAuditLogs() {
    try {
        const logs = await apiFetch('/api/audit?limit=1000');
        const tbody = document.getElementById('audit-table-body');
        document.getElementById('audit-results-count').innerText = `Mostrando ${logs.length} actividades recientes`;
        if (!logs.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">Todavía no hay actividades registradas.</td></tr>';
        } else {
            tbody.innerHTML = logs.map(log => {
                const successful = Number(log.status_code) >= 200 && Number(log.status_code) < 400;
                return `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td class="p-4 whitespace-nowrap">${escapeProfitText(log.created_at || '-')}</td>
                        <td class="p-4 font-semibold text-slate-800">${escapeProfitText(log.username || 'Anónimo')}<span class="block text-xs font-normal text-slate-500">${escapeProfitText(log.role || 'sin rol')}</span></td>
                        <td class="p-4 font-medium">${escapeProfitText(log.action || '-')}</td>
                        <td class="p-4"><span class="font-mono text-xs">${escapeProfitText(log.method || '')}</span><span class="block text-xs text-slate-500">${escapeProfitText(log.path || '-')}</span></td>
                        <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${successful ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${Number(log.status_code)} · ${successful ? 'Correcto' : 'Error'}</span></td>
                        <td class="p-4 text-xs text-slate-500">${escapeProfitText(log.details || '-')}</td>
                    </tr>`;
            }).join('');
        }
        applySectionSearch('view-audit');
    } catch (e) { console.error(e); }
}

// CACHE LOADERS
async function loadClientsCache() {
    try {
        clientsCache = await apiFetch('/api/clients');
    } catch (e) { console.error(e); }
}

async function loadSuppliersCache() {
    try {
        suppliersCache = await apiFetch('/api/suppliers');
    } catch (e) { console.error(e); }
}

// DASHBOARD
async function loadDashboard() {
    try {
        const data = await apiFetch('/api/reports/dashboard');
        document.getElementById('dash-total-sales').innerText = `$ ${data.total_sales.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        document.getElementById('dash-total-collected').innerText = `$ ${data.total_collected.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        document.getElementById('dash-total-pending').innerText = `$ ${data.total_pending.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        document.getElementById('dash-total-bookings').innerText = data.total_bookings;
        document.getElementById('dash-month-collected').innerText = `$ ${Number(data.month_collected || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        document.getElementById('dash-collection-rate').innerText = `${Number(data.collection_rate || 0).toLocaleString('es-AR', {maximumFractionDigits: 1})}%`;
        document.getElementById('dash-bookings-with-balance').innerText = data.bookings_with_balance || 0;
        document.getElementById('dash-total-budgets').innerText = data.total_budgets;
        document.getElementById('dash-approved-budgets').innerText = data.approved_budgets;
        document.getElementById('dash-total-clients').innerText = data.total_clients;
        document.getElementById('dash-total-suppliers').innerText = data.total_suppliers;
        renderDashboardCharts(data.monthly_collections || [], data.bookings_by_status || {});

        const tbody = document.getElementById('dash-recent-payments-body');
        if (!data.recent_payments || data.recent_payments.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">Sin pagos registrados recientemente</td></tr>`;
            applySectionSearch('view-dashboard');
        } else {
            tbody.innerHTML = data.recent_payments.map(p => `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td class="p-3 font-semibold text-slate-800">${p.payment_number}</td>
                    <td class="p-3">${p.client_name || 'Cliente'}</td>
                    <td class="p-3 font-bold text-emerald-600">$ ${p.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="p-3 text-xs text-slate-500">${p.payment_date}</td>
                    <td class="p-3"><span class="px-2 py-0.5 rounded-full text-xs font-semibold ${p.payment_type === 'Total' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${p.payment_type}</span></td>
                </tr>
            `).join('');
            applySectionSearch('view-dashboard');
        }

    } catch (e) { console.error(e); }
}

function renderDashboardCharts(monthlyCollections, bookingsByStatus) {
    const monthlyChart = document.getElementById('dashboard-monthly-chart');
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const now = new Date();
    const months = Array.from({length: 6}, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        return {key, label: `${monthNames[date.getMonth()]} ${String(date.getFullYear()).slice(-2)}`};
    });
    const currencyValues = new Map();
    monthlyCollections.forEach(row => {
        const currency = row.currency || 'USD';
        if (!currencyValues.has(currency)) currencyValues.set(currency, new Map());
        currencyValues.get(currency).set(row.month, Number(row.total || 0));
    });
    if (!currencyValues.size) currencyValues.set('USD', new Map());

    const maxCollection = Math.max(1, ...[...currencyValues.values()].flatMap(values => months.map(month => values.get(month.key) || 0)));
    monthlyChart.innerHTML = [...currencyValues.entries()].map(([currency, values]) => `
        <div class="min-w-full h-full flex flex-col">
            <p class="text-[10px] text-slate-400 mb-2">${escapeProfitText(currency)}${currencyValues.size > 1 ? ' · montos separados' : ''}</p>
            <div class="flex-1 flex items-end gap-2 sm:gap-4 border-b border-slate-200">
                ${months.map(month => {
                    const amount = values.get(month.key) || 0;
                    const height = amount > 0 ? Math.max(4, amount / maxCollection * 100) : 1;
                    return `<div class="flex-1 h-full flex flex-col justify-end items-center gap-2" title="${month.label}: ${formatProfitAmount(currency, amount)}">
                        <span class="text-[9px] sm:text-[10px] text-slate-500 whitespace-nowrap">${amount ? amount.toLocaleString('es-AR', {maximumFractionDigits: 0}) : ''}</span>
                        <div class="w-full max-w-12 rounded-t-md ${amount ? 'bg-gradient-to-t from-blue-600 to-cyan-400' : 'bg-slate-100'}" style="height:${height}%"></div>
                        <span class="text-[9px] sm:text-[10px] text-slate-500 whitespace-nowrap">${month.label}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>`).join('');

    const statusChart = document.getElementById('dashboard-status-chart');
    const statuses = Object.entries(bookingsByStatus).sort((a, b) => b[1] - a[1]);
    const totalBookings = statuses.reduce((total, [, count]) => total + Number(count || 0), 0);
    const statusColors = ['bg-emerald-500', 'bg-blue-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500', 'bg-slate-500'];
    statusChart.innerHTML = statuses.length ? statuses.map(([status, count], index) => {
        const percent = totalBookings ? (Number(count) / totalBookings * 100) : 0;
        return `<div>
            <div class="flex justify-between gap-3 text-xs mb-1"><span class="text-slate-600">${escapeProfitText(status)}</span><span class="font-bold text-slate-800">${count} <span class="text-slate-400 font-normal">(${percent.toFixed(0)}%)</span></span></div>
            <div class="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div class="h-full rounded-full ${statusColors[index % statusColors.length]}" style="width:${percent}%"></div></div>
        </div>`;
    }).join('') : '<p class="text-sm text-slate-400 py-8 text-center">Todavía no hay reservas.</p>';
}

// PRESUPUESTOS
async function loadBudgets() {
    try {
        const budgets = await apiFetch('/api/budgets');
        const tbody = document.getElementById('budgets-table-body');
        if (budgets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No hay presupuestos registrados</td></tr>`;
            applySectionSearch('view-budgets');
            return;
        }

        tbody.innerHTML = budgets.map(b => {
            const statusColors = {
                'Borrador': 'bg-slate-100 text-slate-700',
                'Enviado': 'bg-blue-100 text-blue-800',
                'Aprobado': 'bg-emerald-100 text-emerald-800',
                'Rechazado': 'bg-rose-100 text-rose-800',
                'Convertido': 'bg-indigo-100 text-indigo-800'
            };
            return `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td class="p-4 font-bold text-slate-900">${b.budget_number}</td>
                    <td class="p-4">${b.client_name || 'N/A'}</td>
                    <td class="p-4 font-semibold text-slate-800">${b.title} <span class="block text-xs font-normal text-slate-500">${b.destination}</span></td>
                    <td class="p-4 text-xs text-slate-500">${b.start_date || 'TBD'} al ${b.end_date || 'TBD'}</td>
                    <td class="p-4 font-bold text-slate-900">${b.currency} $ ${b.total_amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${statusColors[b.status] || 'bg-slate-100'}">${b.status}</span></td>
                    <td class="p-4 text-right space-x-1">
                        ${b.status !== 'Convertido' ? `
                            <button onclick="convertToBooking(${b.id})" class="text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold px-2.5 py-1 rounded-lg transition" title="Convertir a Reserva">
                                &check; Convertir a Reserva
                            </button>
                        ` : `
                            <button onclick="revertBudgetToDraft(${b.id})" class="text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 font-semibold px-2 py-1 rounded-lg transition" title="Volver a Presupuesto/Borrador">
                                &olarr; Revertir a Presupuesto
                            </button>
                        `}
                        <button onclick="editBudget(${b.id})" class="text-slate-400 hover:text-blue-600 p-1" title="Editar"><i data-lucide="edit" class="w-4 h-4"></i></button>
                        <button onclick="deleteBudget(${b.id})" class="text-slate-400 hover:text-rose-600 p-1" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </td>
                </tr>
            `;
        }).join('');

        applySectionSearch('view-budgets');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error(e); }
}

function openNewBudgetModal() {
    document.getElementById('modal-budget-title').innerText = 'Nuevo Presupuesto';
    document.getElementById('budget-id').value = '';
    document.getElementById('form-budget').reset();
    populateClientSelect('budget-client-id');

    const itemsContainer = document.getElementById('budget-items-container');
    itemsContainer.innerHTML = '';
    addBudgetItemRow(); // Add 1 default empty item row

    openModal('modal-budget');
}

function addBudgetItemRow(item = {}) {
    const container = document.getElementById('budget-items-container');
    const rowId = 'item-row-' + Date.now() + '-' + Math.floor(Math.random()*1000);

    const suppliersOpts = suppliersCache.map(s => `<option value="${s.id}" ${item.supplier_id === s.id ? 'selected' : ''}>${s.name}</option>`).join('');

    const html = `
        <div id="${rowId}" class="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
            <div class="col-span-2">
                <select class="item-type w-full p-2 border border-slate-300 rounded-lg outline-none">
                    <option value="Vuelo" ${item.service_type === 'Vuelo' ? 'selected' : ''}>Vuelo</option>
                    <option value="Hotel" ${item.service_type === 'Hotel' ? 'selected' : ''}>Hotel</option>
                    <option value="Tour" ${item.service_type === 'Tour' ? 'selected' : ''}>Tour / Excursión</option>
                    <option value="Traslado" ${item.service_type === 'Traslado' ? 'selected' : ''}>Traslado</option>
                    <option value="Seguro" ${item.service_type === 'Seguro' ? 'selected' : ''}>Seguro Méd</option>
                    <option value="Otro" ${item.service_type === 'Otro' ? 'selected' : ''}>Otro</option>
                </select>
            </div>
            <div class="col-span-3">
                <input type="text" class="item-desc w-full p-2 border border-slate-300 rounded-lg outline-none" placeholder="Descripción del servicio" value="${item.description || ''}">
            </div>
            <div class="col-span-2">
                <select class="item-supplier w-full p-2 border border-slate-300 rounded-lg outline-none">
                    <option value="">-- Proveedor --</option>
                    ${suppliersOpts}
                </select>
            </div>
            <div class="col-span-2">
                <input type="number" step="0.01" class="item-cost w-full p-2 border border-slate-300 rounded-lg outline-none" placeholder="Costo" value="${item.cost_price || ''}">
            </div>
            <div class="col-span-2">
                <input type="number" step="0.01" class="item-sale w-full p-2 border border-slate-300 rounded-lg outline-none" placeholder="Venta" value="${item.sale_price || ''}">
            </div>
            <div class="col-span-1 text-center">
                <button type="button" onclick="document.getElementById('${rowId}').remove()" class="text-rose-500 hover:text-rose-700 p-1"><i data-lucide="trash" class="w-4 h-4"></i></button>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
    if (window.lucide) lucide.createIcons();
}

async function saveBudget(e) {
    e.preventDefault();
    const id = document.getElementById('budget-id').value;

    const itemRows = document.querySelectorAll('#budget-items-container > div');
    const items = Array.from(itemRows).map(row => ({
        service_type: row.querySelector('.item-type').value,
        description: row.querySelector('.item-desc').value,
        supplier_id: row.querySelector('.item-supplier').value ? parseInt(row.querySelector('.item-supplier').value) : null,
        cost_price: parseFloat(row.querySelector('.item-cost').value) || 0.0,
        sale_price: parseFloat(row.querySelector('.item-sale').value) || 0.0,
        quantity: 1
    }));

    const payload = {
        client_id: parseInt(document.getElementById('budget-client-id').value),
        title: document.getElementById('budget-title-input').value,
        destination: document.getElementById('budget-destination').value,
        start_date: document.getElementById('budget-start-date').value,
        end_date: document.getElementById('budget-end-date').value,
        currency: document.getElementById('budget-currency').value,
        status: document.getElementById('budget-status').value,
        notes: document.getElementById('budget-notes').value,
        items: items
    };

    if (id) {
        await apiFetch(`/api/budgets/${id}`, 'PUT', payload);
    } else {
        await apiFetch('/api/budgets', 'POST', payload);
    }

    closeModal('modal-budget');
    loadBudgets();
}

async function editBudget(id) {
    const b = await apiFetch(`/api/budgets/${id}`);
    document.getElementById('modal-budget-title').innerText = `Editar Presupuesto ${b.budget_number}`;
    document.getElementById('budget-id').value = b.id;
    populateClientSelect('budget-client-id', b.client_id);
    document.getElementById('budget-title-input').value = b.title;
    document.getElementById('budget-destination').value = b.destination;
    document.getElementById('budget-start-date').value = b.start_date || '';
    document.getElementById('budget-end-date').value = b.end_date || '';
    document.getElementById('budget-currency').value = b.currency;
    document.getElementById('budget-status').value = b.status;
    document.getElementById('budget-notes').value = b.notes || '';

    const itemsContainer = document.getElementById('budget-items-container');
    itemsContainer.innerHTML = '';
    if (b.items && b.items.length > 0) {
        b.items.forEach(item => addBudgetItemRow(item));
    } else {
        addBudgetItemRow();
    }

    openModal('modal-budget');
}

async function convertToBooking(budgetId) {
    if (!confirm('¿Desea convertir este presupuesto en una Reserva Activa?')) return;
    await apiFetch(`/api/budgets/${budgetId}/convert-to-booking`, 'POST');
    alert('Presupuesto convertido a Reserva exitosamente!');
    loadBudgets();
}

async function deleteBudget(id) {
    if (!confirm('¿Está seguro de eliminar este presupuesto?')) return;
    await apiFetch(`/api/budgets/${id}`, 'DELETE');
    loadBudgets();
}

// RESERVAS Y PAGOS
async function loadBookings() {
    try {
        const bookings = await apiFetch('/api/bookings');
        bookingsCache = bookings;
        const tbody = document.getElementById('bookings-table-body');
        if (bookings.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">No hay reservas registradas</td></tr>`;
            applySectionSearch('view-bookings');
            return;
        }

        tbody.innerHTML = bookings.map(b => {
            const progress = b.total_amount > 0 ? Math.min(100, Math.round((b.paid_amount / b.total_amount) * 100)) : 0;
            return `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td class="p-4 font-bold text-blue-600">${b.booking_number}</td>
                    <td class="p-4 font-medium text-slate-800">${b.client_name || 'N/A'}</td>
                    <td class="p-4">${b.title} <span class="block text-xs text-slate-500">${b.destination}</span></td>
                    <td class="p-4 font-bold text-slate-900">${b.currency} $ ${b.total_amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="p-4 font-semibold text-emerald-600">
                        $ ${b.paid_amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                        <div class="w-full bg-slate-200 h-1.5 rounded-full mt-1 overflow-hidden">
                            <div class="bg-emerald-500 h-full" style="width: ${progress}%"></div>
                        </div>
                    </td>
                    <td class="p-4 font-bold ${b.balance_due > 0 ? 'text-amber-600' : 'text-slate-400'}">$ ${b.balance_due.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">${b.status}</span></td>
                    <td class="p-4 text-right space-x-1">
                        <button onclick="editBooking(${b.id})" class="text-slate-400 hover:text-blue-600 p-1" title="Editar Reserva e Importe"><i data-lucide="edit" class="w-4 h-4"></i></button>
                        <button onclick="showBookingPaymentsHistory(${b.id})" class="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold px-2 py-1.5 rounded-lg transition shadow-sm" title="Ver Detalle de Pagos Parciales">
                            Ver Pagos
                        </button>
                        ${b.balance_due > 0 ? `
                            <button onclick="openPaymentModal(${b.id})" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-2.5 py-1.5 rounded-lg transition shadow-sm" title="Registrar Pago">
                                + Pago
                            </button>
                        ` : `
                            <span class="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">Pagado 100%</span>
                        `}
                        ${Number(b.paid_amount || 0) > 0.009 ? `
                            <button disabled class="text-xs bg-slate-100 text-slate-400 font-semibold px-2 py-1.5 rounded-lg cursor-not-allowed" title="No se puede volver a presupuesto mientras existan pagos registrados">
                                Tiene pagos
                            </button>
                        ` : `
                            <button onclick="revertBookingToBudget(${b.id})" class="text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 font-semibold px-2 py-1.5 rounded-lg transition" title="Volver a Presupuesto">
                                A Presupuesto
                            </button>
                        `}
                        <button onclick="deleteBooking(${b.id})" class="text-slate-400 hover:text-rose-600 p-1" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </td>
                </tr>
            `;
        }).join('');

        applySectionSearch('view-bookings');
        const salesPaymentsPanel = document.getElementById('sales-payments-panel');
        if (!salesPaymentsPanel.classList.contains('hidden')) loadSalesPaymentsDetails();
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error(e); }
}

async function showBookingPaymentsHistory(bookingId) {
    try {
        const b = await apiFetch(`/api/bookings/${bookingId}`);
        document.getElementById('hist-modal-title').innerText = `Historial de Pagos - ${b.booking_number}`;
        document.getElementById('hist-modal-subtitle').innerText = `${b.title} | Cliente: ${b.client_name}`;
        document.getElementById('hist-modal-total').innerText = `${b.currency} $ ${b.total_amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        document.getElementById('hist-modal-paid').innerText = `${b.currency} $ ${b.paid_amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        document.getElementById('hist-modal-balance').innerText = `${b.currency} $ ${b.balance_due.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;

        const addBtn = document.getElementById('hist-modal-add-payment-btn');
        if (b.balance_due > 0) {
            addBtn.style.display = 'inline-block';
            addBtn.onclick = () => { closeModal('modal-booking-payments'); openPaymentModal(b.id); };
        } else {
            addBtn.style.display = 'none';
        }

        const tbody = document.getElementById('hist-modal-payments-body');
        if (!b.payments || b.payments.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-400">No se han registrado pagos para esta reserva</td></tr>`;
        } else {
            tbody.innerHTML = b.payments.map(p => {
                const timePart = p.created_at ? (p.created_at.includes(' ') ? p.created_at.split(' ')[1] : p.created_at) : '-';
                return `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition text-xs">
                        <td class="p-3 font-bold text-slate-900">${p.payment_number}</td>
                        <td class="p-3 font-medium text-slate-800">${p.payment_date}</td>
                        <td class="p-3 text-slate-500 font-mono">${timePart}</td>
                        <td class="p-3 font-bold text-emerald-600">${b.currency} $ ${p.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                        <td class="p-3 text-slate-700">${p.payment_method}</td>
                        <td class="p-3"><span class="px-2 py-0.5 rounded-full font-semibold ${p.payment_type === 'Total' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${p.payment_type}</span></td>
                        <td class="p-3 text-slate-500">${p.reference_code || '-'} ${p.notes ? '<span class="block italic text-[11px] text-slate-400">'+p.notes+'</span>' : ''}</td>
                        <td class="p-3 text-slate-600 font-medium">${p.registered_by_user_name || 'Agente'}</td>
                        <td class="p-3 text-right space-x-1">
                            <button onclick="showReceiptModal(${p.id})" class="bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold px-2 py-1 rounded-lg transition" title="Ver Recibo Oficial">
                                Recibo
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        openModal('modal-booking-payments');
    } catch (e) { console.error(e); }
}

async function loadPaymentsHistory() {
    try {
        const payments = await apiFetch('/api/payments');
        const tbody = document.getElementById('payments-table-body');
        if (payments.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="p-4 text-center text-slate-400">No hay pagos registrados en el sistema</td></tr>`;
            applySectionSearch('view-payments');
            return;
        }

        tbody.innerHTML = payments.map(p => {
            const timePart = p.created_at ? (p.created_at.includes(' ') ? p.created_at.split(' ')[1] : p.created_at) : '-';
            return `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td class="p-4 font-bold text-slate-900">${p.payment_number}</td>
                    <td class="p-4 font-medium text-slate-800">
                        ${p.booking_number || 'Reserva'}
                        <span class="block text-xs font-normal text-slate-500">${p.client_name || 'Cliente'}</span>
                    </td>
                    <td class="p-4 text-slate-700">${p.payment_date}</td>
                    <td class="p-4 text-xs font-mono text-slate-500">${timePart}</td>
                    <td class="p-4 font-bold text-emerald-600">$ ${p.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="p-4 text-slate-700">${p.payment_method}</td>
                    <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${p.payment_type === 'Total' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${p.payment_type}</span></td>
                    <td class="p-4 text-xs text-slate-600">${p.reference_code || '-'} ${p.notes ? '<span class="block italic text-[11px] text-slate-400">'+p.notes+'</span>' : ''}</td>
                    <td class="p-4 text-xs font-medium text-slate-700">${p.registered_by_user_name || 'Agente'}</td>
                    <td class="p-4 text-right space-x-1">
                        <button onclick="showReceiptModal(${p.id})" class="text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold px-2.5 py-1 rounded-lg transition" title="Ver Recibo Oficial">
                            Recibo
                        </button>
                        <button onclick="anularPago(${p.id})" class="text-slate-400 hover:text-rose-600 p-1" title="Anular Pago"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </td>
                </tr>
            `;
        }).join('');

        applySectionSearch('view-payments');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error(e); }
}

async function anularPago(paymentId) {
    if (!confirm('¿Está seguro de anular este pago? Se restará del monto cobrado y aumentará el saldo pendiente de la reserva.')) return;
    await apiFetch(`/api/payments/${paymentId}`, 'DELETE');
    alert('Pago anulado exitosamente.');
    loadPaymentsHistory();
    loadBookings();
    if (!document.getElementById('sales-payments-panel').classList.contains('hidden')) loadSalesPaymentsDetails();
}

function openPaymentModal(bookingId) {
    const booking = bookingsCache.find(b => b.id === bookingId);
    if (!booking) return;

    document.getElementById('payment-booking-id').value = booking.id;
    document.getElementById('pay-modal-booking-title').innerText = `${booking.booking_number} - ${booking.title}`;
    document.getElementById('pay-modal-client-name').innerText = `Cliente: ${booking.client_name}`;
    document.getElementById('pay-modal-balance-due').innerText = `${booking.currency} $ ${booking.balance_due.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;

    document.getElementById('payment-amount').value = booking.balance_due;
    document.getElementById('payment-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('payment-reference').value = '';
    document.getElementById('payment-notes').value = '';

    openModal('modal-payment');
}

async function savePayment(e) {
    e.preventDefault();
    const payload = {
        booking_id: parseInt(document.getElementById('payment-booking-id').value),
        amount: parseFloat(document.getElementById('payment-amount').value),
        payment_date: document.getElementById('payment-date').value,
        payment_method: document.getElementById('payment-method').value,
        reference_code: document.getElementById('payment-reference').value,
        notes: document.getElementById('payment-notes').value
    };

    const paymentRes = await apiFetch('/api/payments', 'POST', payload);
    closeModal('modal-payment');

    // Show receipt modal
    showReceiptModal(paymentRes.id);
    loadBookings();
}

async function showReceiptModal(paymentId) {
    const p = await apiFetch(`/api/payments/${paymentId}`);
    currentReceiptData = p;
    document.getElementById('rec-number').innerText = p.payment_number;
    document.getElementById('rec-date').innerText = `Fecha: ${p.payment_date}`;
    document.getElementById('rec-client-name').innerText = p.client_name;
    document.getElementById('rec-client-doc').innerText = `Doc/DNI: ${p.client_doc || 'N/A'}`;
    document.getElementById('rec-booking-title').innerText = p.booking_title;
    document.getElementById('rec-booking-number').innerText = `Reserva: ${p.booking_number}`;
    document.getElementById('rec-amount').innerText = `${p.currency} $ ${p.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
    document.getElementById('rec-method').innerText = p.payment_method;
    document.getElementById('rec-type').innerText = p.payment_type === 'Total' ? 'Pago Total / Liquidación Completa' : 'Pago Parcial / Seña';
    document.getElementById('rec-reference').innerText = p.reference_code || 'N/A';
    document.getElementById('rec-agent-name').innerText = p.registered_by_user_name || 'Agente de Ventas';

    openModal('modal-receipt');
}

async function createReceiptPdfFile() {
    if (!currentReceiptData) throw new Error('Primero abra un recibo de pago.');
    if (!window.jspdf?.jsPDF) throw new Error('No se pudo cargar el generador PDF. Compruebe su conexión y vuelva a intentar.');

    const p = currentReceiptData;
    const doc = new window.jspdf.jsPDF({unit: 'mm', format: 'a4'});
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 18;
    let y = 20;
    const logo = document.querySelector('#printable-area img');
    if (logo?.complete && logo.naturalWidth) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = logo.naturalWidth;
            canvas.height = logo.naturalHeight;
            canvas.getContext('2d').drawImage(logo, 0, 0);
            doc.addImage(canvas.toDataURL('image/png'), 'PNG', margin, y, 23, 23);
        } catch (e) { console.warn('Se omitió el logo del PDF', e); }
    }
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text('Plaza Bohemia Viajes', margin + 29, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('EVT Legajo 18492 | CUIT: 30-71982301-4', margin + 29, y + 13);
    doc.text('Av. Corrientes 1250, Piso 4, CABA', margin + 29, y + 18);
    y += 32;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 64, 175);
    doc.setFontSize(14);
    doc.text('RECIBO OFICIAL DE PAGO', margin, y);
    y += 9;
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    doc.text(`Recibo: ${p.payment_number || '-'}`, margin, y);
    doc.text(`Fecha: ${p.payment_date || '-'}`, pageWidth - margin, y, {align: 'right'});
    y += 12;

    const leftX = margin;
    const rightX = pageWidth / 2 + 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('RECIBIDO DE', leftX, y);
    doc.text('EN CONCEPTO DE', rightX, y);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text(doc.splitTextToSize(p.client_name || 'Cliente', 78), leftX, y);
    doc.text(doc.splitTextToSize(p.booking_title || 'Servicio', 78), rightX, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Documento: ${p.client_doc || 'N/A'}`, leftX, y);
    doc.text(`Reserva: ${p.booking_number || 'N/A'}`, rightX, y);
    y += 13;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageWidth - margin, y);
    y += 11;

    const amountText = `${p.currency || 'USD'} $ ${Number(p.amount || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
    const rows = [
        ['Monto abonado', amountText],
        ['Método de pago', p.payment_method || '-'],
        ['Tipo de pago', p.payment_type === 'Total' ? 'Pago total' : 'Pago parcial'],
        ['Referencia / comprobante', p.reference_code || 'N/A'],
    ];
    rows.forEach(([label, value], index) => {
        doc.setFont('helvetica', index === 0 ? 'bold' : 'normal');
        doc.setFontSize(index === 0 ? 12 : 10);
        doc.setTextColor(index === 0 ? 5 : 71, index === 0 ? 150 : 85, index === 0 ? 105 : 105);
        doc.text(label, margin, y);
        doc.text(doc.splitTextToSize(String(value), 95), pageWidth - margin, y, {align: 'right'});
        y += index === 0 ? 11 : 9;
    });
    y += 6;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageWidth - margin, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text('Atendido por:', margin, y);
    doc.setFont('helvetica', 'bold');
    doc.text(p.registered_by_user_name || 'Agente de Ventas', margin + 27, y);
    y += 24;
    doc.setDrawColor(148, 163, 184);
    doc.line(pageWidth - margin - 57, y, pageWidth - margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Firma y Sello Agencia', pageWidth - margin - 28.5, y + 5, {align: 'center'});

    const safeNumber = String(p.payment_number || 'recibo').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${safeNumber}.pdf`;
    const blob = doc.output('blob');
    return new File([blob], fileName, {type: 'application/pdf'});
}

async function shareReceiptOnWhatsApp() {
    if (!currentReceiptData) return alert('Abra un recibo antes de compartirlo.');
    try {
        const file = await createReceiptPdfFile();
        const p = currentReceiptData;
        const message = `Hola ${p.client_name || ''}, te compartimos el recibo ${p.payment_number} por ${p.currency || 'USD'} ${Number(p.amount || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}.`;
        if (navigator.canShare && navigator.canShare({files: [file]}) && navigator.share) {
            await navigator.share({files: [file], title: `Recibo ${p.payment_number}`, text: message});
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        const downloadLink = document.createElement('a');
        downloadLink.href = objectUrl;
        downloadLink.download = file.name;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        URL.revokeObjectURL(objectUrl);

        const phone = String(p.client_phone || '').replace(/\D/g, '');
        const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(`${message} Adjunta el PDF descargado para enviarlo.`)}`;
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
        alert('Descargamos el recibo PDF. Adjuntalo en el chat de WhatsApp que se abrió.');
    } catch (error) {
        if (error.name !== 'AbortError') alert(error.message || 'No se pudo preparar el PDF para WhatsApp.');
    }
}

async function deleteBooking(id) {
    if (!confirm('¿Está seguro de eliminar esta reserva y sus pagos asociados?')) return;
    await apiFetch(`/api/bookings/${id}`, 'DELETE');
    loadBookings();
}

// CLIENTES
async function loadClients() {
    try {
        const clients = await apiFetch('/api/clients');
        clientsCache = clients;
        const tbody = document.getElementById('clients-table-body');
        if (clients.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No hay clientes registrados</td></tr>`;
            applySectionSearch('view-clients');
            return;
        }

        tbody.innerHTML = clients.map(c => `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                <td class="p-4 font-bold text-slate-900">${c.name}</td>
                <td class="p-4 font-medium text-slate-700">${c.document_id}</td>
                <td class="p-4 text-slate-600">${c.email}</td>
                <td class="p-4 text-slate-600">${c.phone}</td>
                <td class="p-4 text-xs text-slate-500">${c.notes || '-'}</td>
                <td class="p-4 text-right space-x-1">
                    <button onclick="editClient(${c.id})" class="text-slate-400 hover:text-blue-600 p-1" title="Editar"><i data-lucide="edit" class="w-4 h-4"></i></button>
                    <button onclick="deleteClient(${c.id})" class="text-slate-400 hover:text-rose-600 p-1" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
            </tr>
        `).join('');

        applySectionSearch('view-clients');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error(e); }
}

function openClientModal() {
    document.getElementById('modal-client-title').innerText = 'Nuevo Cliente';
    document.getElementById('client-id').value = '';
    document.getElementById('form-client').reset();
    openModal('modal-client');
}

async function saveClient(e) {
    e.preventDefault();
    const id = document.getElementById('client-id').value;
    const payload = {
        name: document.getElementById('client-name').value,
        document_id: document.getElementById('client-doc').value,
        email: document.getElementById('client-email').value,
        phone: document.getElementById('client-phone').value,
        address: document.getElementById('client-address').value,
        notes: document.getElementById('client-notes').value
    };

    if (id) {
        await apiFetch(`/api/clients/${id}`, 'PUT', payload);
    } else {
        await apiFetch('/api/clients', 'POST', payload);
    }

    closeModal('modal-client');
    loadClientsCache();
    loadClients();
}

async function editClient(id) {
    const c = await apiFetch(`/api/clients/${id}`);
    document.getElementById('modal-client-title').innerText = 'Editar Cliente';
    document.getElementById('client-id').value = c.id;
    document.getElementById('client-name').value = c.name;
    document.getElementById('client-doc').value = c.document_id;
    document.getElementById('client-email').value = c.email;
    document.getElementById('client-phone').value = c.phone;
    document.getElementById('client-address').value = c.address || '';
    document.getElementById('client-notes').value = c.notes || '';
    openModal('modal-client');
}

async function deleteClient(id) {
    if (!confirm('¿Está seguro de eliminar este cliente?')) return;
    await apiFetch(`/api/clients/${id}`, 'DELETE');
    loadClientsCache();
    loadClients();
}

// PROVEEDORES
async function loadSuppliers() {
    try {
        const suppliers = await apiFetch('/api/suppliers');
        suppliersCache = suppliers;
        const tbody = document.getElementById('suppliers-table-body');
        if (suppliers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No hay proveedores registrados</td></tr>`;
            applySectionSearch('view-suppliers');
            return;
        }

        tbody.innerHTML = suppliers.map(s => `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                <td class="p-4 font-bold text-slate-900">${s.name}</td>
                <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">${s.category}</span></td>
                <td class="p-4 font-medium text-slate-700">${s.contact_name || '-'}</td>
                <td class="p-4 text-xs text-slate-600">${s.phone} ${s.email ? '| ' + s.email : ''}</td>
                <td class="p-4 text-right space-x-1">
                    <button onclick="editSupplier(${s.id})" class="text-slate-400 hover:text-blue-600 p-1" title="Editar"><i data-lucide="edit" class="w-4 h-4"></i></button>
                    <button onclick="deleteSupplier(${s.id})" class="text-slate-400 hover:text-rose-600 p-1" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
            </tr>
        `).join('');

        applySectionSearch('view-suppliers');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error(e); }
}

function openSupplierModal() {
    document.getElementById('modal-supplier-title').innerText = 'Nuevo Proveedor';
    document.getElementById('supplier-id').value = '';
    document.getElementById('form-supplier').reset();
    openModal('modal-supplier');
}

async function saveSupplier(e) {
    e.preventDefault();
    const id = document.getElementById('supplier-id').value;
    const payload = {
        name: document.getElementById('supplier-name').value,
        category: document.getElementById('supplier-category').value,
        contact_name: document.getElementById('supplier-contact').value,
        phone: document.getElementById('supplier-phone').value,
        email: document.getElementById('supplier-email').value,
        notes: ''
    };

    if (id) {
        await apiFetch(`/api/suppliers/${id}`, 'PUT', payload);
    } else {
        await apiFetch('/api/suppliers', 'POST', payload);
    }

    closeModal('modal-supplier');
    loadSuppliersCache();
    loadSuppliers();
}

async function editSupplier(id) {
    const s = await apiFetch(`/api/suppliers/${id}`);
    document.getElementById('modal-supplier-title').innerText = 'Editar Proveedor';
    document.getElementById('supplier-id').value = s.id;
    document.getElementById('supplier-name').value = s.name;
    document.getElementById('supplier-category').value = s.category;
    document.getElementById('supplier-contact').value = s.contact_name || '';
    document.getElementById('supplier-phone').value = s.phone || '';
    document.getElementById('supplier-email').value = s.email || '';
    openModal('modal-supplier');
}

async function deleteSupplier(id) {
    if (!confirm('¿Está seguro de eliminar este proveedor?')) return;
    await apiFetch(`/api/suppliers/${id}`, 'DELETE');
    loadSuppliersCache();
    loadSuppliers();
}

// USUARIOS
async function loadUsers() {
    try {
        const users = await apiFetch('/api/users');
        const tbody = document.getElementById('users-table-body');
        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No hay usuarios registrados</td></tr>`;
            applySectionSearch('view-users');
            return;
        }

        tbody.innerHTML = users.map(u => `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                <td class="p-4 font-bold text-slate-900">${u.username}</td>
                <td class="p-4 font-medium text-slate-700">${u.full_name}</td>
                <td class="p-4 text-slate-600">${u.email}</td>
                <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 capitalize">${u.role}</span></td>
                <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${u.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}">${u.is_active ? 'Activo' : 'Inactivo'}</span></td>
                <td class="p-4 text-right space-x-1">
                    <button onclick="editUser(${u.id})" class="text-slate-400 hover:text-blue-600 p-1" title="Editar"><i data-lucide="edit" class="w-4 h-4"></i></button>
                    <button onclick="deleteUser(${u.id})" class="text-slate-400 hover:text-rose-600 p-1" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
            </tr>
        `).join('');

        applySectionSearch('view-users');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error(e); }
}

function openUserModal() {
    document.getElementById('modal-user-title').innerText = 'Nuevo Usuario';
    document.getElementById('user-id').value = '';
    document.getElementById('form-user').reset();
    document.getElementById('user-pw-hint').innerText = '(obligatoria para nuevos)';
    document.getElementById('user-password').required = true;
    openModal('modal-user');
}

async function saveUser(e) {
    e.preventDefault();
    const id = document.getElementById('user-id').value;
    const payload = {
        username: document.getElementById('user-username').value,
        full_name: document.getElementById('user-fullname').value,
        email: document.getElementById('user-email').value,
        password: document.getElementById('user-password').value,
        role: document.getElementById('user-role').value,
        is_active: true
    };

    if (id) {
        await apiFetch(`/api/users/${id}`, 'PUT', payload);
    } else {
        await apiFetch('/api/users', 'POST', payload);
    }

    closeModal('modal-user');
    loadUsers();
}

async function editUser(id) {
    const users = await apiFetch('/api/users');
    const u = users.find(x => x.id === id);
    if (!u) return;

    document.getElementById('modal-user-title').innerText = 'Editar Usuario';
    document.getElementById('user-id').value = u.id;
    document.getElementById('user-username').value = u.username;
    document.getElementById('user-fullname').value = u.full_name;
    document.getElementById('user-email').value = u.email;
    document.getElementById('user-role').value = u.role;
    document.getElementById('user-password').value = '';
    document.getElementById('user-password').required = false;
    document.getElementById('user-pw-hint').innerText = '(dejar en blanco para mantener actual)';
    openModal('modal-user');
}

async function deleteUser(id) {
    if (!confirm('¿Está seguro de eliminar este usuario?')) return;
    await apiFetch(`/api/users/${id}`, 'DELETE');
    loadUsers();
}

async function editBooking(id) {
    try {
        const b = await apiFetch(`/api/bookings/${id}`);
        document.getElementById('modal-booking-edit-title').innerText = `Editar Reserva ${b.booking_number}`;
        document.getElementById('booking-edit-id').value = b.id;
        populateClientSelect('booking-edit-client-id', b.client_id);
        document.getElementById('booking-edit-title').value = b.title;
        document.getElementById('booking-edit-destination').value = b.destination;
        document.getElementById('booking-edit-start-date').value = b.start_date || '';
        document.getElementById('booking-edit-end-date').value = b.end_date || '';
        document.getElementById('booking-edit-currency').value = b.currency;
        document.getElementById('booking-edit-total-amount').value = b.total_amount;
        document.getElementById('booking-edit-status').value = b.status;
        document.getElementById('booking-edit-notes').value = b.notes || '';

        openModal('modal-edit-booking');
    } catch (e) { console.error(e); }
}

async function saveBookingEdit(e) {
    e.preventDefault();
    const id = document.getElementById('booking-edit-id').value;
    const payload = {
        client_id: parseInt(document.getElementById('booking-edit-client-id').value),
        title: document.getElementById('booking-edit-title').value,
        destination: document.getElementById('booking-edit-destination').value,
        start_date: document.getElementById('booking-edit-start-date').value,
        end_date: document.getElementById('booking-edit-end-date').value,
        currency: document.getElementById('booking-edit-currency').value,
        total_amount: parseFloat(document.getElementById('booking-edit-total-amount').value),
        status: document.getElementById('booking-edit-status').value,
        notes: document.getElementById('booking-edit-notes').value
    };

    await apiFetch(`/api/bookings/${id}`, 'PUT', payload);
    closeModal('modal-edit-booking');
    loadBookings();
}

async function revertBookingToBudget(id) {
    if (!confirm('¿Desea volver esta Reserva nuevamente a Presupuesto/Borrador?')) return;
    try {
        await apiFetch(`/api/bookings/${id}/revert-to-budget`, 'POST');
        alert('Reserva revertida a Presupuesto exitosamente.');
        loadBookings();
        loadBudgets();
    } catch (e) { console.error(e); }
}

async function revertBudgetToDraft(budgetId) {
    if (!confirm('¿Desea revertir este presupuesto a estado Borrador para poder modificarlo?')) return;
    await apiFetch(`/api/budgets/${budgetId}/revert-to-draft`, 'POST');
    alert('Presupuesto revertido a Borrador exitosamente!');
    loadBudgets();
    loadBookings();
}

// UTILS
function populateClientSelect(selectId, selectedId = null) {
    const select = document.getElementById(selectId);
    select.innerHTML = clientsCache.map(c => `<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>${c.name} (${c.document_id})</option>`).join('');
}

function openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('hidden');
}

function closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('hidden');
}

function filterSectionRows(sectionId, query) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase('es');

    section.querySelectorAll('tbody').forEach(tbody => {
        const dataRows = Array.from(tbody.querySelectorAll('tr')).filter(row =>
            !row.hasAttribute('data-filter-empty') && !row.querySelector('td[colspan]')
        );
        let visibleCount = 0;
        dataRows.forEach(row => {
            const matches = !normalizedQuery || row.innerText.toLocaleLowerCase('es').includes(normalizedQuery);
            row.classList.toggle('hidden', !matches);
            if (matches) visibleCount += 1;
        });

        let emptyRow = tbody.querySelector('[data-filter-empty]');
        if (normalizedQuery && dataRows.length > 0 && visibleCount === 0) {
            if (!emptyRow) {
                emptyRow = document.createElement('tr');
                emptyRow.setAttribute('data-filter-empty', 'true');
                const cell = document.createElement('td');
                cell.className = 'p-4 text-center text-slate-400';
                cell.colSpan = Math.max(1, tbody.closest('table')?.querySelectorAll('thead th').length || 1);
                cell.textContent = 'No hay resultados para esta búsqueda';
                emptyRow.appendChild(cell);
                tbody.appendChild(emptyRow);
            }
            emptyRow.classList.remove('hidden');
        } else if (emptyRow) {
            emptyRow.remove();
        }
    });
}

function applySectionSearch(sectionId) {
    const section = document.getElementById(sectionId);
    const input = section?.querySelector('input[type="search"]');
    if (input) filterSectionRows(sectionId, input.value);
}

async function toggleSalesPayments() {
    const panel = document.getElementById('sales-payments-panel');
    const button = document.querySelector('#view-bookings button[onclick="toggleSalesPayments()"]');
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    if (button) button.innerHTML = `<i data-lucide="receipt-text" class="w-4 h-4"></i> ${opening ? 'Ocultar pagos' : 'Ver todos los pagos'}`;
    if (window.lucide) lucide.createIcons();
    if (opening) await loadSalesPaymentsDetails();
}

async function loadSalesPaymentsDetails() {
    try {
        const payments = await apiFetch('/api/payments');
        const tbody = document.getElementById('sales-payments-table-body');
        if (!payments.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-400">Todavía no hay pagos registrados</td></tr>';
        } else {
            tbody.innerHTML = payments.map(p => {
                const timePart = p.created_at ? (p.created_at.includes(' ') ? p.created_at.split(' ')[1] : p.created_at) : '-';
                return `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td class="p-4 font-bold text-slate-900">${escapeProfitText(p.payment_number)}</td>
                        <td class="p-4 font-medium text-slate-800">${escapeProfitText(p.booking_number || 'Reserva')}<span class="block text-xs font-normal text-slate-500">${escapeProfitText(p.client_name || 'Cliente')}</span></td>
                        <td class="p-4 text-slate-700">${escapeProfitText(p.payment_date)}<span class="block text-xs font-mono text-slate-400">${escapeProfitText(timePart)}</span></td>
                        <td class="p-4 text-right font-bold text-emerald-600">${Number(p.amount || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                        <td class="p-4">${escapeProfitText(p.payment_method)}<span class="block text-xs text-slate-500">${escapeProfitText(p.payment_type)}</span></td>
                        <td class="p-4 text-xs">${escapeProfitText(p.reference_code || '-')}<span class="block italic text-slate-400">${escapeProfitText(p.notes || '')}</span></td>
                        <td class="p-4">${escapeProfitText(p.registered_by_user_name || 'Agente')}</td>
                        <td class="p-4 text-right"><button onclick="showReceiptModal(${p.id})" class="text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold px-2.5 py-1 rounded-lg transition">Ver recibo</button></td>
                    </tr>`;
            }).join('');
        }
        applySectionSearch('view-bookings');
    } catch (e) { console.error(e); }
}

async function logout(message = '') {
    if (authToken) {
        try {
            await fetch('/api/users/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
        } catch (e) { console.error('No se pudo registrar el cierre de sesión', e); }
    }
    authToken = '';
    currentUser = null;
    document.getElementById('login-form').reset();
    const error = document.getElementById('login-error');
    error.innerText = message;
    error.classList.toggle('hidden', !message);
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('user-display-name').innerText = 'Usuario';
    document.getElementById('user-display-role').innerText = '';
    document.getElementById('user-avatar').innerText = 'U';
    document.querySelectorAll('[id^="modal-"]').forEach(modal => modal.classList.add('hidden'));
    document.getElementById('login-username').focus();
}
