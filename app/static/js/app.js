// Main JavaScript Controller for Travel Agency ADM System

let currentUser = null;
let authToken = '';
let clientsCache = [];
let suppliersCache = [];
let bookingsCache = [];
let profitsCache = [];
let commissionsCache = [];
let earningsUsersCache = [];
let salespeopleCache = [];
let supplierPayablesCache = [];
let currentReceiptData = null;

let budgetSelectedClientIds = [];
let budgetSelectedSellerIds = [];

document.addEventListener('DOMContentLoaded', () => {
    // Set current date
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date-display').innerText = new Date().toLocaleDateString('es-ES', options);

    // Initial icon render
    if (window.lucide) lucide.createIcons();

    setupBudgetSearchInputs();

    document.getElementById('login-username').focus();
});

const API_BASE = window.location.pathname.startsWith('/adm') ? '/adm' : '';

async function loginUser(event) {
    event.preventDefault();
    const error = document.getElementById('login-error');
    const submit = document.getElementById('login-submit');
    error.classList.add('hidden');
    submit.disabled = true;
    submit.innerText = 'Verificando...';

    try {
        const response = await fetch(`${API_BASE}/api/users/login`, {
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
        applyRolePermissions();
        document.getElementById('login-password').value = '';
        document.getElementById('login-screen').classList.add('hidden');
        loadClientsCache();
        loadSuppliersCache();
        loadSalespeopleCache();
        const initialTab = (ROLE_ALLOWED_TABS[currentUser.role] || ['budgets'])[0];
        switchTab(initialTab);
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

    const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;

    try {
        const response = await fetch(fullUrl, config);
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

// TAB SWITCHING & PERMISSIONS
const ROLE_ALLOWED_TABS = {
    'admin': ['dashboard', 'budgets', 'bookings', 'payments', 'clients', 'suppliers', 'supplier-payables', 'profits', 'audit', 'users'],
    'ventas': ['dashboard', 'budgets', 'bookings', 'payments', 'clients', 'suppliers', 'supplier-payables', 'profits'],
    'administrativa': ['budgets', 'bookings', 'payments', 'clients', 'suppliers', 'supplier-payables'],
    'agente': ['budgets', 'bookings', 'payments', 'clients', 'suppliers']
};

function toggleMobileSidebar(open) {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar) return;
    const shouldOpen = open !== undefined ? open : sidebar.classList.contains('-translate-x-full');
    if (shouldOpen) {
        sidebar.classList.remove('-translate-x-full');
        if (backdrop) backdrop.classList.remove('hidden');
    } else {
        sidebar.classList.add('-translate-x-full');
        if (backdrop) backdrop.classList.add('hidden');
    }
}

function switchTab(tabId) {
    const tabs = ['dashboard', 'budgets', 'bookings', 'payments', 'supplier-payables', 'profits', 'audit', 'clients', 'suppliers', 'users'];
    const pageTitles = {
        'dashboard': 'Dashboard General',
        'budgets': 'Gestión de Presupuestos',
        'bookings': 'Expedientes & Control de Pagos',
        'payments': 'Historial General de Pagos Parciales',
        'supplier-payables': 'Pagos a Proveedores',
        'profits': 'Ganancias y Comisiones',
        'audit': 'Log de Actividad',
        'clients': 'Directorio de Clientes',
        'suppliers': 'Catálogo de Proveedores',
        'users': 'Administración de Usuarios'
    };

    const role = currentUser?.role || 'agente';
    const allowedTabs = ROLE_ALLOWED_TABS[role] || ROLE_ALLOWED_TABS['agente'];
    if (!allowedTabs.includes(tabId)) {
        tabId = allowedTabs[0] || 'budgets';
    }

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

    // Auto-close mobile sidebar drawer on selection
    toggleMobileSidebar(false);

    // Refresh tab content
    if (tabId === 'dashboard') loadDashboard();
    if (tabId === 'budgets') loadBudgets();
    if (tabId === 'bookings') loadBookings();
    if (tabId === 'payments') loadPaymentsHistory();
    if (tabId === 'supplier-payables') loadSupplierPayables();
    if (tabId === 'profits') loadProfits();
    if (tabId === 'audit') loadAuditLogs();
    if (tabId === 'clients') loadClients();
    if (tabId === 'suppliers') loadSuppliers();
    if (tabId === 'users') loadUsers();

    if (window.lucide) lucide.createIcons();
}

function localDateString(date = new Date()) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function loadSalespeopleCache() {
    try {
        const users = await apiFetch('/api/users');
        salespeopleCache = users.filter(user => user.is_active && ['agente', 'ventas'].includes(user.role));
    } catch (error) { console.error(error); }
}

function setupBudgetSearchInputs() {
    const clientInput = document.getElementById('budget-client-search');
    const sellerInput = document.getElementById('budget-seller-search');

    if (clientInput) {
        clientInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleBudgetClientSearch(clientInput.value.trim());
            }
        });
        clientInput.addEventListener('input', () => {
            const val = clientInput.value.trim();
            if (val.length >= 3) {
                handleBudgetClientSearch(val);
            } else {
                hideBudgetDropdown('budget-client-dropdown');
            }
        });
    }

    if (sellerInput) {
        sellerInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleBudgetSellerSearch(sellerInput.value.trim());
            }
        });
        sellerInput.addEventListener('input', () => {
            const val = sellerInput.value.trim();
            if (val.length >= 3) {
                handleBudgetSellerSearch(val);
            } else {
                hideBudgetDropdown('budget-seller-dropdown');
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#budget-client-search') && !e.target.closest('#budget-client-dropdown')) {
            hideBudgetDropdown('budget-client-dropdown');
        }
        if (!e.target.closest('#budget-seller-search') && !e.target.closest('#budget-seller-dropdown')) {
            hideBudgetDropdown('budget-seller-dropdown');
        }
    });
}

function hideBudgetDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) dropdown.classList.add('hidden');
}

function handleBudgetClientSearch(query) {
    const dropdown = document.getElementById('budget-client-dropdown');
    if (!dropdown) return;
    if (!clientsCache.length) loadClientsCache();
    const q = query.toLowerCase();
    const matches = clientsCache.filter(c => 
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.document_id && c.document_id.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
    );

    if (!matches.length) {
        dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">No se encontraron clientes que coincidan con "${escapeProfitText(query)}"</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    dropdown.innerHTML = matches.map(c => {
        const isSelected = budgetSelectedClientIds.includes(c.id);
        return `
            <div onclick="toggleBudgetClientSelection(${c.id})" class="p-3 hover:bg-blue-50 cursor-pointer flex items-center justify-between transition text-xs">
                <div>
                    <span class="font-bold text-slate-800">${escapeProfitText(c.name)}</span>
                    <span class="text-slate-500 ml-2">(${escapeProfitText(c.document_id || 'Sin doc')})</span>
                    <span class="text-slate-400 block text-[11px]">${escapeProfitText(c.email || '')}</span>
                </div>
                <div>
                    ${isSelected ? '<span class="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">Agregado</span>' : '<span class="text-xs text-blue-600 font-semibold hover:underline">+ Agregar</span>'}
                </div>
            </div>
        `;
    }).join('');
    dropdown.classList.remove('hidden');
}

function toggleBudgetClientSelection(clientId) {
    const id = Number(clientId);
    if (budgetSelectedClientIds.includes(id)) {
        budgetSelectedClientIds = budgetSelectedClientIds.filter(x => x !== id);
    } else {
        budgetSelectedClientIds.push(id);
    }
    renderBudgetSelectedClients();
    const searchInput = document.getElementById('budget-client-search');
    if (searchInput && searchInput.value.trim().length >= 3) {
        handleBudgetClientSearch(searchInput.value.trim());
    }
}

function renderBudgetSelectedClients() {
    const container = document.getElementById('budget-selected-clients');
    if (!container) return;
    if (!budgetSelectedClientIds.length) {
        container.innerHTML = '<span class="text-xs text-slate-400 italic">No hay clientes agregados. Busque arriba por nombre o DNI y presione ENTER para agregar.</span>';
        return;
    }
    container.innerHTML = budgetSelectedClientIds.map(id => {
        const client = clientsCache.find(c => c.id === id) || { name: `Cliente #${id}`, document_id: '' };
        return `
            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-100 border border-sky-300 text-sky-900 rounded-xl text-xs font-semibold shadow-sm">
                <span>${escapeProfitText(client.name)} ${client.document_id ? `(${escapeProfitText(client.document_id)})` : ''}</span>
                <button type="button" onclick="toggleBudgetClientSelection(${id})" class="text-sky-700 hover:text-rose-600 font-bold ml-1 text-sm leading-none" title="Quitar cliente">&times;</button>
            </span>
        `;
    }).join('');
}

function handleBudgetSellerSearch(query) {
    const dropdown = document.getElementById('budget-seller-dropdown');
    if (!dropdown) return;
    const q = query.toLowerCase();
    const matches = salespeopleCache.filter(u => 
        (u.full_name && u.full_name.toLowerCase().includes(q)) ||
        (u.username && u.username.toLowerCase().includes(q))
    );

    if (!matches.length) {
        dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">No se encontraron vendedores que coincidan con "${escapeProfitText(query)}"</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    dropdown.innerHTML = matches.map(u => {
        const isSelected = budgetSelectedSellerIds.includes(u.id);
        return `
            <div onclick="toggleBudgetSellerSelection(${u.id})" class="p-3 hover:bg-blue-50 cursor-pointer flex items-center justify-between transition text-xs">
                <div>
                    <span class="font-bold text-slate-800">${escapeProfitText(u.full_name)}</span>
                    <span class="text-slate-500 ml-2">(${escapeProfitText(u.role)})</span>
                </div>
                <div>
                    ${isSelected ? '<span class="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">Asignado</span>' : '<span class="text-xs text-blue-600 font-semibold hover:underline">+ Asignar</span>'}
                </div>
            </div>
        `;
    }).join('');
    dropdown.classList.remove('hidden');
}

function toggleBudgetSellerSelection(sellerId) {
    const id = Number(sellerId);
    if (budgetSelectedSellerIds.includes(id)) {
        budgetSelectedSellerIds = budgetSelectedSellerIds.filter(x => x !== id);
    } else {
        budgetSelectedSellerIds.push(id);
    }
    renderBudgetSelectedSellers();
    const searchInput = document.getElementById('budget-seller-search');
    if (searchInput && searchInput.value.trim().length >= 3) {
        handleBudgetSellerSearch(searchInput.value.trim());
    }
}

function renderBudgetSelectedSellers() {
    const container = document.getElementById('budget-selected-sellers');
    if (!container) return;
    if (!budgetSelectedSellerIds.length) {
        container.innerHTML = '<span class="text-xs text-slate-400 italic">No hay vendedores asignados. Busque arriba por nombre o presione ENTER.</span>';
        return;
    }
    container.innerHTML = budgetSelectedSellerIds.map(id => {
        const user = salespeopleCache.find(u => u.id === id) || { full_name: `Usuario #${id}` };
        return `
            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 border border-blue-300 text-blue-900 rounded-xl text-xs font-semibold shadow-sm">
                <span>${escapeProfitText(user.full_name)}</span>
                <button type="button" onclick="toggleBudgetSellerSelection(${id})" class="text-blue-700 hover:text-rose-600 font-bold ml-1 text-sm leading-none" title="Quitar vendedor">&times;</button>
            </span>
        `;
    }).join('');
}

function canManageSupplierPayables() {
    return currentUser && ['admin', 'ventas', 'administrativa'].includes(currentUser.role);
}

function applyRolePermissions() {
    const role = currentUser?.role || 'agente';
    const allowed = ROLE_ALLOWED_TABS[role] || ROLE_ALLOWED_TABS['agente'];
    const allNavTabs = ['dashboard', 'budgets', 'bookings', 'payments', 'clients', 'suppliers', 'supplier-payables', 'profits', 'audit', 'users'];

    allNavTabs.forEach(t => {
        const btn = document.getElementById(`nav-${t}`);
        if (btn) {
            btn.classList.toggle('hidden', !allowed.includes(t));
        }
    });

    const adminSection = document.getElementById('nav-admin-section');
    if (adminSection) {
        const adminTabs = ['supplier-payables', 'profits', 'audit', 'users'];
        const hasAnyAdminTab = adminTabs.some(t => allowed.includes(t));
        adminSection.classList.toggle('hidden', !hasAnyAdminTab);
    }
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
            <td class="p-4 font-semibold text-slate-800">${escapeProfitText(item.supplier_name)}<span class="block text-xs font-normal text-slate-500">${escapeProfitText(item.supplier_category || '')}</span>${item.booking_number ? `<span class="block text-xs text-blue-700">${escapeProfitText(item.booking_number)}</span>` : ''}${item.budget_number ? `<span class="block text-xs text-slate-500">${escapeProfitText(item.budget_number)}</span>` : ''}</td>
            <td class="p-4">${escapeProfitText(item.concept)}<span class="block text-xs text-slate-500">${escapeProfitText(item.invoice_number || 'Sin Nº de factura')}</span></td>
            <td class="p-4 whitespace-nowrap">${escapeProfitText(item.due_date)}</td>
            <td class="p-4 text-right">${formatProfitAmount(item.currency, item.total_amount)}</td>
            <td class="p-4 text-right text-emerald-700">${formatProfitAmount(item.currency, item.paid_amount)}</td>
            <td class="p-4 text-right font-bold ${item.balance_due > 0.009 ? 'text-amber-700' : 'text-slate-400'}">${formatProfitAmount(item.currency, item.balance_due)}</td>
            <td class="p-4"><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[item.status] || 'bg-slate-100 text-slate-700'}">${escapeProfitText(item.status)}</span></td>
            <td class="p-4 text-right"><div class="flex justify-end gap-1.5"><button onclick="showSupplierPayableDetails(${item.id})" class="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">Detalle (${item.payment_count})</button>${canManage && item.balance_due > 0.009 ? `<button onclick="openSupplierPaymentModal(${item.id})" class="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Registrar pago</button>` : ''}</div></td>
        </tr>`).join('');
}

async function openSupplierPayableModal(budgetId = null, bookingId = null) {
    if (!canManageSupplierPayables()) return alert('Se requieren permisos de administración o contabilidad.');
    try {
        if (!suppliersCache.length) suppliersCache = await apiFetch('/api/suppliers');
        const [budgets, bookings] = await Promise.all([apiFetch('/api/budgets'), apiFetch('/api/bookings')]);
        const select = document.getElementById('sp-supplier-id');
        select.innerHTML = '<option value="">Seleccionar proveedor...</option>' + suppliersCache.map(supplier =>
            `<option value="${supplier.id}">${escapeProfitText(supplier.name)} · ${escapeProfitText(supplier.category)}</option>`
        ).join('');
        document.getElementById('form-supplier-payable').reset();
        document.getElementById('sp-budget-id').innerHTML = '<option value="">Sin presupuesto</option>' + budgets.map(budget =>
            `<option value="${budget.id}" data-booking-id="${budget.booking_id || ''}">${escapeProfitText(budget.budget_number)} · ${escapeProfitText(budget.title)}</option>`
        ).join('');
        document.getElementById('sp-booking-id').innerHTML = '<option value="">Sin reserva</option>' + bookings.map(booking =>
            `<option value="${booking.id}" data-budget-id="${booking.budget_id || ''}">${escapeProfitText(booking.booking_number)} · ${escapeProfitText(booking.title)}</option>`
        ).join('');
        document.getElementById('sp-budget-id').value = budgetId || '';
        document.getElementById('sp-booking-id').value = bookingId || (budgetId ? budgets.find(budget => budget.id === budgetId)?.booking_id || '' : '');
        const today = localDateString();
        document.getElementById('sp-issue-date').value = today;
        const dueDefault = new Date(`${today}T12:00:00`);
        dueDefault.setDate(dueDefault.getDate() + 30);
        document.getElementById('sp-due-date').value = localDateString(dueDefault);
        if (bookingId) {
            const booking = bookings.find(item => item.id === bookingId);
            if (booking?.budget_id) document.getElementById('sp-budget-id').value = booking.budget_id;
        }
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
        total_amount: parseCurrencyInput(document.getElementById('sp-total').value),
        issue_date: document.getElementById('sp-issue-date').value,
        due_date: document.getElementById('sp-due-date').value,
        notes: document.getElementById('sp-notes').value.trim(),
        booking_id: document.getElementById('sp-booking-id').value ? parseInt(document.getElementById('sp-booking-id').value) : null,
        budget_id: document.getElementById('sp-budget-id').value ? parseInt(document.getElementById('sp-budget-id').value) : null
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
    amount.value = payable.balance_due ? payable.balance_due.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '';
    document.getElementById('supplier-payment-date').value = localDateString();
    openModal('modal-supplier-payment');
}

async function saveSupplierPayment(event) {
    event.preventDefault();
    const payableId = document.getElementById('supplier-payment-payable-id').value;
    const payload = {
        amount: parseCurrencyInput(document.getElementById('supplier-payment-amount').value),
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
        const relation = [payable.booking_number, payable.budget_number].filter(Boolean).join(' · ');
        document.getElementById('supplier-payable-detail-subtitle').innerText = `Factura ${payable.invoice_number || '—'} · Emitida ${payable.issue_date} · Vence ${payable.due_date} · ${payable.status}${relation ? ` · ${relation}` : ''}`;
        document.getElementById('supplier-detail-total').innerText = formatProfitAmount(payable.currency, payable.total_amount);
        document.getElementById('supplier-detail-paid').innerText = formatProfitAmount(payable.currency, payable.paid_amount);
        document.getElementById('supplier-detail-balance').innerText = formatProfitAmount(payable.currency, payable.balance_due);
        const body = document.getElementById('supplier-payable-payments-body');
        body.innerHTML = payable.payments?.length ? payable.payments.map(payment => `
            <tr class="border-b border-slate-100"><td class="p-3">${escapeProfitText(payment.payment_date)}</td><td class="p-3 text-right font-semibold text-emerald-700">${formatProfitAmount(payable.currency, payment.amount)}</td><td class="p-3">${escapeProfitText(payment.payment_method)}</td><td class="p-3">${escapeProfitText(payment.reference || '-')}</td><td class="p-3">${escapeProfitText(payment.registered_by_name || '-')}</td><td class="p-3">${escapeProfitText(payment.notes || '-')}</td></tr>`).join('') : '<tr><td colspan="6" class="p-5 text-center text-slate-400">Todavía no hay pagos registrados para esta cuenta.</td></tr>';
        openModal('modal-supplier-payable-detail');
    } catch (e) { console.error(e); }
}

// PARSERS & FORMATTERS MONETARIOS
function parseCurrencyInput(value) {
    if (value === null || value === undefined) return 0.0;
    if (typeof value === 'number') return isNaN(value) ? 0.0 : value;
    let str = String(value).trim();
    if (!str) return 0.0;

    // Remover signos de monedas y espacios
    str = str.replace(/[$€£\s]/g, '');

    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');

    if (lastComma !== -1 && lastDot !== -1) {
        if (lastComma > lastDot) {
            // Formato español/argentino (p. ej. 5.259.638,70): puntos son miles, coma es decimal
            str = str.replace(/\./g, '').replace(',', '.');
        } else {
            // Formato inglés/US (p. ej. 5,259,638.70): comas son miles, punto es decimal
            str = str.replace(/,/g, '');
        }
    } else if (lastComma !== -1) {
        const commaCount = (str.match(/,/g) || []).length;
        if (commaCount === 1) {
            // Una sola coma (p. ej. 5259638,70 o 1500,5): coma decimal
            str = str.replace(',', '.');
        } else {
            // Múltiples comas (p. ej. 5,259,638): separador de miles
            str = str.replace(/,/g, '');
        }
    } else if (lastDot !== -1) {
        const dotCount = (str.match(/\./g) || []).length;
        if (dotCount > 1) {
            // Múltiples puntos (p. ej. 5.259.638): separador de miles
            str = str.replace(/\./g, '');
        }
    }

    const num = parseFloat(str);
    return isNaN(num) ? 0.0 : num;
}

function formatCurrencyInput(value) {
    if (value === '' || value === null || value === undefined) return '';
    const num = typeof value === 'number' ? value : parseCurrencyInput(value);
    if (isNaN(num)) return '';
    return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function handleCurrencyBlur(input) {
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;
    const num = parseCurrencyInput(raw);
    input.value = num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
        const data = await apiFetch('/api/profits/summary');
        profitsCache = data.budgets || [];
        const totals = data.summary || {};
        const byCurrency = totals.by_currency || {};
        const supplierPayments = totals.supplier_payments_by_currency || {};
        const financialCurrencies = [...new Set([...Object.keys(byCurrency), ...Object.keys(supplierPayments)])].sort();
        document.getElementById('kpi-total-sale').innerText = formatProfitTotals(byCurrency, 'total_sale', totals.total_sale);
        document.getElementById('kpi-total-cost').innerText = formatProfitTotals(byCurrency, 'total_cost', totals.total_cost);
        document.getElementById('kpi-gross-profit').innerText = formatProfitTotals(byCurrency, 'gross_profit', totals.gross_profit);
        document.getElementById('kpi-paid-comm').innerText = financialCurrencies.map(currency => formatProfitAmount(currency, supplierPayments[currency] || 0)).join(' · ') || formatProfitAmount('USD', 0);
        document.getElementById('kpi-pending-comm').innerText = financialCurrencies.map(currency => formatProfitAmount(
            currency,
            Number((byCurrency[currency] || {}).gross_profit || 0) - Number(supplierPayments[currency] || 0)
        )).join(' · ') || formatProfitAmount('USD', 0);

        const body = document.getElementById('profits-table-body');
        if (profitsCache.length === 0) {
            body.innerHTML = '<tr><td colspan="10" class="p-6 text-center text-slate-400">No hay presupuestos para calcular ganancias</td></tr>';
        } else {
            body.innerHTML = profitsCache.map(b => {
                const operation = b.booking_number || b.budget_number;
                const paymentCount = (b.supplier_payment_details || []).length + (b.customer_payment_details || []).length;
                return `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td class="p-3 font-semibold text-slate-800">${escapeProfitText(operation)}<span class="block text-xs font-normal text-slate-400">${escapeProfitText(b.booking_number ? b.budget_number : '')}</span></td>
                        <td class="p-3">${escapeProfitText(b.client_name || 'Sin cliente')}</td>
                        <td class="p-3">${escapeProfitText(b.destination || '-')}<span class="block text-xs text-slate-400">${escapeProfitText(b.title || '')}</span></td>
                        <td class="p-3 text-right">${formatProfitAmount(b.currency, b.total_amount)}</td>
                        <td class="p-3 text-right">${formatProfitAmount(b.currency, b.total_cost)}</td>
                        <td class="p-3 text-right">${formatProfitAmount(b.currency, b.supplier_payments)}</td>
                        <td class="p-3 text-right font-bold ${b.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${formatProfitAmount(b.currency, b.net_profit)}</td>
                        <td class="p-3 text-right">${Number(b.margin_pct || 0).toFixed(2)}%</td>
                        <td class="p-3 text-center"><span class="px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-700">${escapeProfitText(b.booking_status || b.status)}</span></td>
                        <td class="p-3 text-center"><button onclick="openProfitPaymentDetails(${b.id})" class="whitespace-nowrap bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-lg">Ver detalle (${paymentCount})</button></td>
                    </tr>`;
            }).join('');
        }
            applySectionSearch('view-profits');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error(e); }
}

async function loadUserEarningsDashboard() {
    try {
        const [commissions, users] = await Promise.all([
            Promise.resolve([]),
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
    const supplierPayments = (budget.supplier_payment_details || []).map(payment => ({
        ...payment,
        movement_type: 'Proveedor',
        party_name: payment.supplier_name,
        display_reference: payment.invoice_number || payment.concept,
        display_amount: -Number(payment.amount || 0),
        display_currency: payment.currency || budget.currency,
    }));
    const customerPayments = (budget.customer_payment_details || []).map(payment => ({
        ...payment,
        movement_type: 'Cliente',
        party_name: payment.client_name,
        display_reference: payment.reference_code || payment.payment_number,
        display_amount: Number(payment.amount || 0),
        display_currency: payment.currency || budget.currency,
    }));
    const payments = [...supplierPayments, ...customerPayments]
        .sort((first, second) => String(second.payment_date || '').localeCompare(String(first.payment_date || '')));
    document.getElementById('profit-history-title').innerText = `Pagos de clientes y proveedores · ${budget.booking_number || budget.budget_number}`;
    document.getElementById('profit-history-subtitle').innerText = `${budget.title} · ${budget.client_name || 'Sin cliente'} · ${budget.budget_number}`;
    document.getElementById('profit-history-total').innerText = formatProfitAmount(budget.currency, budget.supplier_payments);
    document.getElementById('profit-history-balance').innerText = formatProfitAmount(budget.currency, budget.net_profit);
    document.getElementById('profit-history-payment-count').innerText = `${payments.length} ${payments.length === 1 ? 'pago' : 'pagos'}`;
    const tbody = document.getElementById('profit-history-table-body');
    if (!payments.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">No hay pagos de clientes o proveedores asociados a esta operación.</td></tr>';
    } else {
        tbody.innerHTML = payments.map(payment => `
            <tr class="border-b border-slate-100 hover:bg-slate-50">
                <td class="p-3">${escapeProfitText(payment.payment_date || '-')}</td>
                <td class="p-3"><span class="rounded px-2 py-1 text-xs font-semibold ${payment.movement_type === 'Proveedor' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}">${payment.movement_type}</span></td>
                <td class="p-3 font-semibold">${escapeProfitText(payment.party_name || '-')}</td>
                <td class="p-3 text-right font-bold ${payment.display_amount < 0 ? 'text-rose-700' : 'text-emerald-700'}">${formatProfitAmount(payment.display_currency, payment.display_amount)}</td>
                <td class="p-3">${escapeProfitText(payment.payment_method || '-')}</td>
                <td class="p-3">${escapeProfitText(payment.display_reference || payment.notes || '-')}</td>
                <td class="p-3">${escapeProfitText(payment.booking_number || budget.booking_number || '-')}</td>
            </tr>`).join('');
    }
    openModal('modal-profit-history');
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

function openClearAuditModal() {
    const fromInput = document.getElementById('clear-audit-from');
    const toInput = document.getElementById('clear-audit-to');
    if (fromInput) fromInput.value = '';
    if (toInput) toInput.value = '';
    openModal('modal-clear-audit');
    if (window.lucide) lucide.createIcons();
}

async function executeClearAuditByRange(event) {
    if (event) event.preventDefault();
    const fromDate = document.getElementById('clear-audit-from').value;
    const toDate = document.getElementById('clear-audit-to').value;

    if (!fromDate && !toDate) {
        alert('Por favor seleccione al menos una fecha (Desde o Hasta), o use el botón "Vaciar Todo el Historial".');
        return;
    }

    if (fromDate && toDate && fromDate > toDate) {
        alert('La fecha "Desde" no puede ser posterior a la fecha "Hasta".');
        return;
    }

    const rangeDesc = (fromDate && toDate)
        ? `entre el ${fromDate} y el ${toDate}`
        : (fromDate ? `desde el ${fromDate} en adelante` : `hasta el ${toDate}`);

    if (!confirm(`¿Está seguro de eliminar los registros del log de actividad ${rangeDesc}? Esta acción no se puede deshacer.`)) return;

    try {
        const params = new URLSearchParams();
        if (fromDate) params.append('from_date', fromDate);
        if (toDate) params.append('to_date', toDate);

        const res = await apiFetch(`/api/audit?${params.toString()}`, 'DELETE');
        closeModal('modal-clear-audit');
        alert(res?.message || 'Registros de actividad eliminados correctamente.');
        await loadAuditLogs();
    } catch (e) {
        console.error(e);
    }
}

async function executeClearAuditAll() {
    if (!confirm('¿Está seguro de que desea vaciar TODO el historial del log de actividad? Esta acción no se puede deshacer.')) return;
    try {
        const res = await apiFetch('/api/audit', 'DELETE');
        closeModal('modal-clear-audit');
        alert(res?.message || 'Log de actividad vaciado por completo.');
        await loadAuditLogs();
    } catch (e) {
        console.error(e);
    }
}

function clearAuditLogs() {
    openClearAuditModal();
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
        document.getElementById('dash-total-suppliers').innerText = data.total_suppliers;

        // Recordatorios de Pago a Proveedores
        const reminders = data.supplier_reminders || [];
        const remindersCount = document.getElementById('dash-supplier-reminders-count');
        const remindersList = document.getElementById('dash-supplier-reminders-list');
        if (remindersCount) remindersCount.innerText = reminders.length;
        if (remindersList) {
            if (!reminders.length) {
                remindersList.innerHTML = '<p class="text-sm text-amber-900/70 py-2 col-span-full">No hay cuentas vencidas ni vencimientos próximos en los siguientes 7 días.</p>';
            } else {
                remindersList.innerHTML = reminders.map(item => `
                    <div class="rounded-xl border ${item.status === 'Vencido' ? 'border-rose-300 bg-rose-50/70' : 'border-amber-300 bg-white/90'} p-3.5 flex flex-col justify-between gap-2 shadow-xs">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <p class="text-xs font-bold text-slate-900 truncate">${escapeProfitText(item.supplier_name)}</p>
                                <p class="text-xs text-slate-600 truncate">${escapeProfitText(item.concept)}</p>
                            </div>
                            <span class="rounded px-2 py-0.5 text-[11px] font-bold ${item.status === 'Vencido' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}">${item.status}</span>
                        </div>
                        <div class="flex items-end justify-between gap-2 text-xs pt-2 border-t border-slate-100">
                            <div>
                                <span class="text-slate-400 text-[10px]">Vence: </span>
                                <span class="font-semibold text-slate-700">${escapeProfitText(item.due_date)}</span>
                            </div>
                            <span class="font-bold text-slate-900">${formatProfitAmount(item.currency, item.balance_due)}</span>
                        </div>
                    </div>
                `).join('');
            }
        }

        // Grilla de Vencimiento de Pasaportes (próximos 6 meses)
        const passportAlerts = data.passport_alerts || [];
        const passportCount = document.getElementById('dash-passport-alerts-count');
        const passportBody = document.getElementById('dash-passport-alerts-body');
        if (passportCount) passportCount.innerText = passportAlerts.length;
        if (passportBody) {
            if (!passportAlerts.length) {
                passportBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-400">No hay pasaportes a vencer en los próximos 6 meses.</td></tr>';
            } else {
                passportBody.innerHTML = passportAlerts.map(c => `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td class="p-2.5 font-bold text-slate-900">${escapeProfitText(c.name)}</td>
                        <td class="p-2.5 font-medium text-slate-700">${escapeProfitText(c.passport_number)}</td>
                        <td class="p-2.5 text-xs text-slate-600 font-semibold">${escapeProfitText(c.passport_expiry)}</td>
                        <td class="p-2.5"><span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${c.days_left < 0 ? 'bg-rose-100 text-rose-800' : (c.days_left <= 30 ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')}">${c.status}</span></td>
                        <td class="p-2.5 text-right text-xs text-slate-500">${escapeProfitText(c.phone || c.email)}</td>
                    </tr>
                `).join('');
            }
        }

        // Grilla de Cumpleaños (próximos 7 días)
        const birthdayAlerts = data.birthday_alerts || [];
        const birthdayCount = document.getElementById('dash-birthday-alerts-count');
        const birthdayBody = document.getElementById('dash-birthday-alerts-body');
        if (birthdayCount) birthdayCount.innerText = birthdayAlerts.length;
        if (birthdayBody) {
            if (!birthdayAlerts.length) {
                birthdayBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-400">No hay cumpleaños de clientes en los próximos 7 días.</td></tr>';
            } else {
                birthdayBody.innerHTML = birthdayAlerts.map(c => `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td class="p-2.5 font-bold text-slate-900">${escapeProfitText(c.name)}</td>
                        <td class="p-2.5 text-xs font-semibold text-slate-700">${escapeProfitText(c.birthday_formatted)}</td>
                        <td class="p-2.5 text-xs text-slate-600 font-medium">Cumple ${c.turning_age} años</td>
                        <td class="p-2.5"><span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${c.days_to_bday === 0 ? 'bg-emerald-100 text-emerald-800 animate-pulse' : 'bg-indigo-100 text-indigo-800'}">${c.label}</span></td>
                        <td class="p-2.5 text-right text-xs text-slate-500">${escapeProfitText(c.phone || c.email)}</td>
                    </tr>
                `).join('');
            }
        }

        renderDashboardCharts(data.monthly_collections || [], data.monthly_expenses || [], data.bookings_by_status || {});

        // Grilla de Próximas Salidas de Viaje (salidas más cercanas, destacando en rojo <= 7 días)
        const upcomingDepartures = data.upcoming_departures || [];
        const upcomingCount = document.getElementById('dash-upcoming-departures-count');
        const upcomingBody = document.getElementById('dash-upcoming-departures-body');
        if (upcomingCount) upcomingCount.innerText = upcomingDepartures.length;
        if (upcomingBody) {
            if (!upcomingDepartures.length) {
                upcomingBody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-400">No hay reservas con salidas programadas próximas.</td></tr>';
            } else {
                upcomingBody.innerHTML = upcomingDepartures.map(item => {
                    const isUrgent = item.is_urgent; // <= 7 días
                    return `
                        <tr class="border-b border-slate-100 transition ${isUrgent ? 'bg-rose-50/70 hover:bg-rose-100/70' : 'hover:bg-slate-50'}">
                            <td class="p-3 font-bold ${isUrgent ? 'text-rose-900' : 'text-slate-900'}">
                                ${escapeProfitText(item.booking_number)}
                            </td>
                            <td class="p-3 font-medium ${isUrgent ? 'text-rose-950' : 'text-slate-800'}">
                                ${escapeProfitText(item.client_names)}
                            </td>
                            <td class="p-3 text-xs ${isUrgent ? 'text-rose-800' : 'text-slate-600'}">
                                <span class="font-semibold block ${isUrgent ? 'text-rose-900' : 'text-slate-800'}">${escapeProfitText(item.destination || '-')}</span>
                                <span class="text-slate-500">${escapeProfitText(item.title || '')}</span>
                            </td>
                            <td class="p-3 whitespace-nowrap ${isUrgent ? 'font-bold text-rose-700' : 'font-semibold text-slate-700'}">
                                <i data-lucide="calendar" class="w-3.5 h-3.5 inline mr-1 ${isUrgent ? 'text-rose-600' : 'text-slate-400'}"></i>${escapeProfitText(item.start_date)}
                            </td>
                            <td class="p-3 whitespace-nowrap text-xs text-slate-500">
                                ${escapeProfitText(item.end_date || '-')}
                            </td>
                            <td class="p-3 whitespace-nowrap">
                                <span class="px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1 ${isUrgent ? 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse' : 'bg-blue-50 text-blue-700 border border-blue-200'}">
                                    <i data-lucide="${isUrgent ? 'alert-triangle' : 'clock'}" class="w-3.5 h-3.5"></i>
                                    ${escapeProfitText(item.departure_status)}
                                </span>
                            </td>
                            <td class="p-3 text-right whitespace-nowrap">
                                <span class="${item.balance_due > 0.009 ? 'font-bold text-amber-700' : 'text-emerald-600 font-semibold'}">
                                    ${formatProfitAmount(item.currency, item.balance_due)}
                                </span>
                                ${item.balance_due > 0.009 ? '<span class="block text-[10px] text-amber-600 font-normal">Pendiente</span>' : '<span class="block text-[10px] text-emerald-600 font-normal">Saldado</span>'}
                            </td>
                            <td class="p-3 text-center">
                                <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${item.status === 'Confirmada' ? 'bg-emerald-100 text-emerald-800' : item.status === 'En Curso' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}">
                                    ${escapeProfitText(item.status)}
                                </span>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

        const tbody = document.getElementById('dash-recent-payments-body');
        if (!data.recent_payments || data.recent_payments.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Sin pagos registrados recientemente</td></tr>`;
        } else {
            tbody.innerHTML = data.recent_payments.map(p => `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td class="p-3 font-semibold text-slate-800">${escapeProfitText(p.payment_number)}</td>
                    <td class="p-3">${escapeProfitText(p.client_name || 'Cliente')}</td>
                    <td class="p-3 text-xs text-slate-600">${escapeProfitText(p.concept || p.booking_title || '-')}</td>
                    <td class="p-3 font-bold text-emerald-600">$ ${p.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="p-3 text-xs text-slate-500">${escapeProfitText(p.payment_date)}</td>
                    <td class="p-3"><span class="px-2 py-0.5 rounded-full text-xs font-semibold ${p.payment_type === 'Total' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${escapeProfitText(p.payment_type)}</span></td>
                </tr>
            `).join('');
        }

        if (window.lucide) lucide.createIcons();

    } catch (e) { console.error(e); }
}

function renderDashboardCharts(monthlyCollections, monthlyExpenses, bookingsByStatus) {
    const monthlyChart = document.getElementById('dashboard-monthly-chart');
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const now = new Date();
    const months = Array.from({length: 6}, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        return {key, label: `${monthNames[date.getMonth()]} ${String(date.getFullYear()).slice(-2)}`};
    });

    const currencies = new Set();
    monthlyCollections.forEach(r => currencies.add(r.currency || 'USD'));
    monthlyExpenses.forEach(r => currencies.add(r.currency || 'USD'));
    if (!currencies.size) currencies.add('USD');

    const chartsHtml = [...currencies].sort().map(currency => {
        const incomeMap = new Map();
        monthlyCollections.filter(r => (r.currency || 'USD') === currency).forEach(r => incomeMap.set(r.month, Number(r.total || 0)));

        const expenseMap = new Map();
        monthlyExpenses.filter(r => (r.currency || 'USD') === currency).forEach(r => expenseMap.set(r.month, Number(r.total || 0)));

        const maxVal = Math.max(1, ...months.flatMap(m => [incomeMap.get(m.key) || 0, expenseMap.get(m.key) || 0]));

        return `
            <div class="min-w-full h-full flex flex-col">
                <div class="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span class="font-bold text-slate-600">${escapeProfitText(currency)}</span>
                </div>
                <div class="flex-1 flex items-end gap-2 sm:gap-6 border-b border-slate-200 pb-1">
                    ${months.map(month => {
                        const inc = incomeMap.get(month.key) || 0;
                        const exp = expenseMap.get(month.key) || 0;
                        const incHeight = inc > 0 ? Math.max(5, (inc / maxVal) * 100) : 2;
                        const expHeight = exp > 0 ? Math.max(5, (exp / maxVal) * 100) : 2;

                        return `
                            <div class="flex-1 h-full flex flex-col justify-end items-center gap-1.5 group relative" title="${month.label} | Ingresos: ${formatProfitAmount(currency, inc)} - Egresos: ${formatProfitAmount(currency, exp)}">
                                <div class="flex items-end gap-1.5 w-full justify-center h-44">
                                    <!-- Ingresos -->
                                    <div class="w-full max-w-5 rounded-t-md ${inc ? 'bg-gradient-to-t from-blue-600 to-cyan-400' : 'bg-slate-100'} transition-all duration-300 relative group/bar" style="height:${incHeight}%">
                                        ${inc ? `<div class="opacity-0 group-hover/bar:opacity-100 absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap z-10 pointer-events-none">${inc.toLocaleString('es-AR', {maximumFractionDigits: 0})}</div>` : ''}
                                    </div>
                                    <!-- Egresos -->
                                    <div class="w-full max-w-5 rounded-t-md ${exp ? 'bg-gradient-to-t from-rose-600 to-rose-400' : 'bg-slate-100'} transition-all duration-300 relative group/bar" style="height:${expHeight}%">
                                        ${exp ? `<div class="opacity-0 group-hover/bar:opacity-100 absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap z-10 pointer-events-none">${exp.toLocaleString('es-AR', {maximumFractionDigits: 0})}</div>` : ''}
                                    </div>
                                </div>
                                <span class="text-[10px] sm:text-xs text-slate-500 font-semibold whitespace-nowrap mt-1">${month.label}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');

    monthlyChart.innerHTML = chartsHtml || '<p class="text-sm text-slate-400 py-8 text-center">No hay datos para mostrar.</p>';

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
                    <td class="p-4 font-bold text-slate-900">${b.budget_number}<span class="block text-xs font-normal text-slate-500">${b.booking_number ? `Reserva: ${b.booking_number}` : 'Sin reserva asociada'}</span><span class="block text-xs font-normal text-slate-500">${escapeProfitText((b.seller_names || []).join(', '))}</span></td>
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
                        ${b.status !== 'Convertido' ? `<button onclick="editBudget(${b.id})" class="text-slate-400 hover:text-blue-600 p-1" title="Editar presupuesto"><i data-lucide="edit" class="w-4 h-4"></i></button><button onclick="deleteBudget(${b.id})" class="text-slate-400 hover:text-rose-600 p-1" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        applySectionSearch('view-budgets');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error(e); }
}

async function openNewBudgetModal() {
    document.getElementById('modal-budget-title').innerText = 'Nuevo Presupuesto';
    document.getElementById('budget-id').value = '';
    document.getElementById('budget-associated-booking').value = 'Sin reserva asociada';
    document.getElementById('form-budget').reset();

    if (!salespeopleCache.length) await loadSalespeopleCache();
    if (!clientsCache.length) await loadClientsCache();

    budgetSelectedClientIds = [];
    renderBudgetSelectedClients();

    budgetSelectedSellerIds = [];
    renderBudgetSelectedSellers();

    hideBudgetDropdown('budget-client-dropdown');
    hideBudgetDropdown('budget-seller-dropdown');

    const itemsContainer = document.getElementById('budget-items-container');
    itemsContainer.innerHTML = '';
    addBudgetItemRow(); // Add 1 default empty item row

    openModal('modal-budget');
}

function addBudgetItemRow(item = {}) {
    const container = document.getElementById('budget-items-container');
    const rowId = 'item-row-' + Date.now() + '-' + Math.floor(Math.random()*1000);

    const suppliersOpts = suppliersCache.map(s => `<option value="${s.id}" ${item.supplier_id === s.id ? 'selected' : ''}>${escapeProfitText(s.name)}</option>`).join('');

    const costVal = (item.cost_price !== undefined && item.cost_price !== null && item.cost_price !== '') 
        ? formatCurrencyInput(item.cost_price)
        : '';
    const saleVal = (item.sale_price !== undefined && item.sale_price !== null && item.sale_price !== '') 
        ? formatCurrencyInput(item.sale_price)
        : '';

    const html = `
        <div id="${rowId}" class="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
            <div class="col-span-2">
                <select class="item-type w-full p-2 border border-slate-300 rounded-lg outline-none bg-white">
                    <option value="Vuelo" ${item.service_type === 'Vuelo' ? 'selected' : ''}>Vuelo</option>
                    <option value="Hotel" ${item.service_type === 'Hotel' ? 'selected' : ''}>Hotel</option>
                    <option value="Tour" ${item.service_type === 'Tour' ? 'selected' : ''}>Tour / Excursión</option>
                    <option value="Traslado" ${item.service_type === 'Traslado' ? 'selected' : ''}>Traslado</option>
                    <option value="Seguro" ${item.service_type === 'Seguro' ? 'selected' : ''}>Seguro Méd</option>
                    <option value="Otro" ${item.service_type === 'Otro' ? 'selected' : ''}>Otro</option>
                </select>
            </div>
            <div class="col-span-3">
                <input type="text" class="item-desc w-full p-2 border border-slate-300 rounded-lg outline-none bg-white" placeholder="Descripción del servicio" value="${escapeProfitText(item.description || '')}">
            </div>
            <div class="col-span-2">
                <select class="item-supplier w-full p-2 border border-slate-300 rounded-lg outline-none bg-white">
                    <option value="">-- Proveedor --</option>
                    ${suppliersOpts}
                </select>
            </div>
            <div class="col-span-2">
                <input type="text" inputmode="decimal" class="item-cost w-full p-2 border border-slate-300 rounded-lg outline-none bg-white text-right font-medium" placeholder="Costo" value="${costVal}" onblur="handleCurrencyBlur(this)">
            </div>
            <div class="col-span-2">
                <input type="text" inputmode="decimal" class="item-sale w-full p-2 border border-slate-300 rounded-lg outline-none bg-white text-right font-medium" placeholder="Venta" value="${saleVal}" onblur="handleCurrencyBlur(this)">
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

    if (!budgetSelectedClientIds.length) {
        return alert('Seleccione al menos un cliente para el presupuesto.');
    }
    if (!budgetSelectedSellerIds.length) {
        return alert('Asigne al menos un vendedor al presupuesto.');
    }

    const itemRows = document.querySelectorAll('#budget-items-container > div');
    const items = Array.from(itemRows).map(row => ({
        service_type: row.querySelector('.item-type').value,
        description: row.querySelector('.item-desc').value,
        supplier_id: row.querySelector('.item-supplier').value ? parseInt(row.querySelector('.item-supplier').value) : null,
        cost_price: parseCurrencyInput(row.querySelector('.item-cost').value),
        sale_price: parseCurrencyInput(row.querySelector('.item-sale').value),
        quantity: 1
    }));

    const payload = {
        client_ids: budgetSelectedClientIds,
        title: document.getElementById('budget-title-input').value,
        destination: document.getElementById('budget-destination').value,
        start_date: document.getElementById('budget-start-date').value,
        end_date: document.getElementById('budget-end-date').value,
        currency: document.getElementById('budget-currency').value,
        status: document.getElementById('budget-status').value,
        notes: document.getElementById('budget-notes').value,
        seller_ids: budgetSelectedSellerIds,
        items: items
    };

    if (id) {
        await apiFetch(`/api/budgets/${id}`, 'PUT', payload);
    } else {
        await apiFetch('/api/budgets', 'POST', payload);
    }

    closeModal('modal-budget');
    await refreshAfterFinancialChange();
}

async function editBudget(id) {
    const b = await apiFetch(`/api/budgets/${id}`);
    document.getElementById('modal-budget-title').innerText = `Editar Presupuesto ${b.budget_number}`;
    document.getElementById('budget-id').value = b.id;
    document.getElementById('budget-associated-booking').value = b.booking_number || 'Sin reserva asociada';

    if (!salespeopleCache.length) await loadSalespeopleCache();
    if (!clientsCache.length) await loadClientsCache();

    budgetSelectedClientIds = (b.client_ids && b.client_ids.length > 0) ? [...b.client_ids] : (b.client_id ? [b.client_id] : []);
    renderBudgetSelectedClients();

    budgetSelectedSellerIds = (b.seller_ids && b.seller_ids.length > 0) ? [...b.seller_ids] : [];
    renderBudgetSelectedSellers();

    hideBudgetDropdown('budget-client-dropdown');
    hideBudgetDropdown('budget-seller-dropdown');

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
    await refreshAfterFinancialChange();
}

async function deleteBudget(id) {
    if (!confirm('¿Está seguro de eliminar este presupuesto?')) return;
    await apiFetch(`/api/budgets/${id}`, 'DELETE');
    await refreshAfterFinancialChange();
}

// RESERVAS Y PAGOS
async function loadBookings() {
    try {
        const bookings = await apiFetch('/api/bookings');
        bookingsCache = bookings;
        const tbody = document.getElementById('bookings-table-body');
        if (bookings.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-400">No hay reservas registradas</td></tr>`;
            applySectionSearch('view-bookings');
            return;
        }

        tbody.innerHTML = bookings.map(b => {
            const progress = b.total_amount > 0 ? Math.min(100, Math.round((b.paid_amount / b.total_amount) * 100)) : 0;
            return `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td class="p-4 font-bold text-blue-600">${b.booking_number}<span class="block text-xs font-normal text-slate-500">Presupuesto: ${b.budget_number || 'Sin presupuesto'}</span><span class="block text-xs font-normal text-slate-500">${escapeProfitText((b.seller_names || []).join(', '))}</span></td>
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
                    <td class="p-4 font-semibold text-slate-700">${b.currency} $ ${Number(b.total_cost || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="p-4 font-semibold ${Number(b.cost_balance || 0) < 0 ? 'text-rose-700' : 'text-slate-700'}">${b.currency} $ ${Number(b.cost_balance || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="p-4 text-right space-x-1">
                        <button onclick="showBookingPaymentsHistory(${b.id})" class="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold px-2 py-1.5 rounded-lg transition shadow-sm" title="Ver detalle de reserva, servicios y pagos">
                            Ver detalle
                        </button>
                        <button onclick="openPaymentModal(${b.id})" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-2.5 py-1.5 rounded-lg transition shadow-sm" title="Registrar cobro o egreso">
                            + Pago
                        </button>
                        <button onclick="revertBookingToBudget(${b.id})" class="text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 font-semibold px-2 py-1.5 rounded-lg transition" title="Volver a Presupuesto; los pagos registrados se conservan">
                            A Presupuesto
                        </button>
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
        document.getElementById('hist-modal-title').innerText = `Detalle de reserva - ${b.booking_number}`;
        const datesText = (b.start_date || b.end_date)
            ? ` | Salida: ${b.start_date || '-'} | Regreso: ${b.end_date || '-'}`
            : '';
        document.getElementById('hist-modal-subtitle').innerText = `${b.title} | Cliente: ${b.client_name} | Presupuesto: ${b.budget_number || 'Sin presupuesto'}${datesText}`;
        document.getElementById('hist-modal-total').innerText = `${b.currency} $ ${b.total_amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        document.getElementById('hist-modal-paid').innerText = `${b.currency} $ ${b.paid_amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        document.getElementById('hist-modal-balance').innerText = `${b.currency} $ ${b.balance_due.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        document.getElementById('hist-modal-cost').innerText = `${b.currency} $ ${Number(b.total_cost || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        document.getElementById('hist-modal-cost-balance').innerText = `${b.currency} $ ${Number(b.cost_balance || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}`;

        const items = b.items || [];
        document.getElementById('hist-modal-items-count').innerText = `${items.length} ${items.length === 1 ? 'ítem' : 'ítems'}`;
        const itemsBody = document.getElementById('hist-modal-items-body');
        itemsBody.innerHTML = items.length ? items.map(item => {
            const cost = Number(item.cost_price || 0);
            const sale = Number(item.sale_price || 0);
            const saldo = sale - cost;
            return `
            <tr class="border-b border-slate-100">
                <td class="p-3">${escapeProfitText(item.service_type)}</td>
                <td class="p-3 font-medium text-slate-800">${escapeProfitText(item.description)}</td>
                <td class="p-3">${escapeProfitText(item.supplier_name || '-')}</td>
                <td class="p-3 text-right">${Number(item.quantity || 0)}</td>
                <td class="p-3 text-right">${formatProfitAmount(b.currency, cost)}</td>
                <td class="p-3 text-right">${formatProfitAmount(b.currency, sale)}</td>
                <td class="p-3 text-right font-semibold ${saldo < 0 ? 'text-rose-700' : 'text-slate-800'}">${formatProfitAmount(b.currency, saldo)}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="7" class="p-4 text-center text-slate-400">No hay ítems de presupuesto asociados a esta reserva.</td></tr>';

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
                const isSupplierExpense = p.record_type === 'Proveedor';
                return `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition text-xs">
                        <td class="p-3 font-bold text-slate-900">${p.payment_number}</td>
                        <td class="p-3 font-medium text-slate-800">${p.payment_date}</td>
                        <td class="p-3 text-slate-500 font-mono">${timePart}</td>
                        <td class="p-3 font-bold ${isSupplierExpense ? 'text-rose-700' : 'text-emerald-600'}">${b.currency} $ ${p.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                        <td class="p-3 text-slate-700">${p.payment_method}</td>
                        <td class="p-3"><span class="px-2 py-0.5 rounded-full font-semibold ${p.payment_type === 'Total' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${p.payment_type}</span></td>
                        <td class="p-3 text-slate-500">${isSupplierExpense ? `Proveedor: ${escapeProfitText(p.supplier_name)}` : (p.reference_code || '-')} ${p.notes ? '<span class="block italic text-[11px] text-slate-400">'+p.notes+'</span>' : ''}</td>
                        <td class="p-3 text-slate-600 font-medium">${p.registered_by_user_name || 'Agente'}</td>
                        <td class="p-3 text-right space-x-1">
                            ${isSupplierExpense ? '<span class="text-rose-700">Egreso</span>' : `<button onclick="showReceiptModal(${p.id})" class="bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold px-2 py-1 rounded-lg transition" title="Ver Recibo Oficial">Recibo</button>`}
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
            const isSupplierExpense = p.record_type === 'Proveedor';
            return `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td class="p-4 font-bold text-slate-900">${p.payment_number}</td>
                    <td class="p-4 font-medium text-slate-800">
                        ${p.booking_number || (isSupplierExpense ? 'Sin reserva asociada' : 'Reserva')}
                        <span class="block text-xs font-normal text-slate-500">${escapeProfitText(isSupplierExpense ? p.supplier_name : (p.client_name || 'Cliente'))}</span>
                    </td>
                    <td class="p-4 text-slate-700">${p.payment_date}</td>
                    <td class="p-4 text-xs font-mono text-slate-500">${timePart}</td>
                    <td class="p-4 font-bold ${isSupplierExpense ? 'text-rose-700' : 'text-emerald-600'}">$ ${p.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="p-4 text-slate-700">${p.payment_method}</td>
                    <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${isSupplierExpense ? 'bg-rose-100 text-rose-800' : p.payment_type === 'Total' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${p.payment_type}</span></td>
                    <td class="p-4 text-xs text-slate-600">${p.reference_code || '-'} ${p.notes ? '<span class="block italic text-[11px] text-slate-400">'+p.notes+'</span>' : ''}</td>
                    <td class="p-4 text-xs font-medium text-slate-700">${p.registered_by_user_name || 'Agente'}</td>
                    <td class="p-4 text-right space-x-1">
                        ${isSupplierExpense ? `<button onclick="anularPagoProveedor(${p.payable_id}, ${p.supplier_payment_id})" class="text-slate-400 hover:text-rose-600 p-1" title="Anular egreso"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : `<button onclick="showReceiptModal(${p.id})" class="text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold px-2.5 py-1 rounded-lg transition" title="Ver Recibo Oficial">Recibo</button><button onclick="anularPago(${p.id})" class="text-slate-400 hover:text-rose-600 p-1" title="Anular Pago"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`}
                    </td>
                </tr>
            `;
        }).join('');

        applySectionSearch('view-payments');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error(e); }
}

async function refreshAfterFinancialChange() {
    const promises = [loadBookings(), loadBudgets(), loadPaymentsHistory()];
    const activeDashboard = document.getElementById('view-dashboard');
    if (activeDashboard && !activeDashboard.classList.contains('hidden')) {
        promises.push(loadDashboard());
    }
    const activeProfits = document.getElementById('view-profits');
    if (activeProfits && !activeProfits.classList.contains('hidden')) {
        promises.push(loadProfits());
    }
    const activePayables = document.getElementById('view-supplier-payables');
    if (activePayables && !activePayables.classList.contains('hidden')) {
        promises.push(loadSupplierPayables());
    }
    await Promise.all(promises);
    if (!document.getElementById('sales-payments-panel').classList.contains('hidden')) {
        loadSalesPaymentsDetails();
    }
}

async function anularPago(paymentId) {
    if (!confirm('¿Está seguro de anular este pago? Se restará del monto cobrado y aumentará el saldo pendiente de la reserva.')) return;
    await apiFetch(`/api/payments/${paymentId}`, 'DELETE');
    alert('Pago anulado exitosamente.');
    await refreshAfterFinancialChange();
}

async function anularPagoProveedor(payableId, paymentId) {
    if (!confirm('¿Está seguro de anular este egreso a proveedor?')) return;
    await apiFetch(`/api/supplier-payables/${payableId}/payments/${paymentId}`, 'DELETE');
    await refreshAfterFinancialChange();
}

function togglePaymentPartyFields() {
    const isSupplier = document.getElementById('payment-party-type').value === 'Proveedor';
    document.getElementById('payment-client-field').classList.toggle('hidden', isSupplier);
    document.getElementById('payment-supplier-field').classList.toggle('hidden', !isSupplier);
    document.getElementById('payment-supplier-id').required = isSupplier;
    if (isSupplier) document.getElementById('payment-amount').value = '';
}

async function openPaymentModal(bookingId, partyType = 'Cliente') {
    const booking = bookingsCache.find(b => b.id === bookingId);
    if (!booking) return;

    if (partyType === 'Proveedor' && !canManageSupplierPayables()) return alert('Se requieren permisos para registrar pagos a proveedores.');
    if (!suppliersCache.length) suppliersCache = await apiFetch('/api/suppliers');
    const supplierSelect = document.getElementById('payment-supplier-id');
    supplierSelect.innerHTML = '<option value="">Seleccionar proveedor...</option>' + suppliersCache.map(supplier =>
        `<option value="${supplier.id}">${escapeProfitText(supplier.name)} · ${escapeProfitText(supplier.category)}</option>`
    ).join('');

    if (!clientsCache.length) await loadClientsCache();
    const clientSelect = document.getElementById('payment-client-id');
    const bClientIds = (booking.client_ids && booking.client_ids.length > 0) ? booking.client_ids : (booking.client_id ? [booking.client_id] : []);
    
    // Obtener detalles de los clientes de la reserva
    const bookingClients = bClientIds.map(id => {
        const found = clientsCache.find(c => c.id === id);
        return found || { id: id, name: `Cliente #${id}`, document_id: '' };
    });

    clientSelect.innerHTML = bookingClients.map(c => 
        `<option value="${c.id}">${escapeProfitText(c.name)}${c.document_id ? ` (${escapeProfitText(c.document_id)})` : ''}</option>`
    ).join('');

    document.getElementById('payment-booking-id').value = booking.id;
    document.getElementById('pay-modal-booking-title').innerText = `${booking.booking_number} - ${booking.title}`;
    document.getElementById('pay-modal-client-name').innerText = `Clientes: ${booking.client_name}`;
    document.getElementById('pay-modal-balance-due').innerText = `${booking.currency} $ ${booking.balance_due.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
    document.getElementById('payment-party-type').value = partyType;
    document.getElementById('payment-party-type').querySelector('option[value="Proveedor"]').hidden = !canManageSupplierPayables();
    document.getElementById('payment-supplier-id').value = '';
    togglePaymentPartyFields();

    document.getElementById('payment-amount').value = partyType === 'Cliente' ? (booking.balance_due ? booking.balance_due.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '') : '';
    document.getElementById('payment-date').value = localDateString();
    document.getElementById('payment-concept').value = '';
    document.getElementById('payment-reference').value = '';
    document.getElementById('payment-notes').value = '';

    openModal('modal-payment');
}

async function savePayment(e) {
    e.preventDefault();
    const booking = bookingsCache.find(item => item.id === parseInt(document.getElementById('payment-booking-id').value));
    const amount = parseCurrencyInput(document.getElementById('payment-amount').value);
    const paymentDate = document.getElementById('payment-date').value;
    const paymentMethod = document.getElementById('payment-method').value;
    const concept = document.getElementById('payment-concept').value.trim();
    const reference = document.getElementById('payment-reference').value.trim();
    const notes = document.getElementById('payment-notes').value.trim();
    const selectedClientId = parseInt(document.getElementById('payment-client-id').value);

    if (document.getElementById('payment-party-type').value === 'Proveedor') {
        if (!booking) return;
        await apiFetch('/api/supplier-payables/expenses', 'POST', {
            supplier_id: parseInt(document.getElementById('payment-supplier-id').value),
            concept: concept || notes || `Gasto de reserva ${booking.booking_number}`,
            invoice_number: reference,
            currency: booking.currency,
            amount,
            payment_date: paymentDate,
            payment_method: paymentMethod,
            reference,
            notes,
            booking_id: booking.id,
            budget_id: booking.budget_id || null,
        });
        closeModal('modal-payment');
        await Promise.all([loadBookings(), loadPaymentsHistory(), loadSupplierPayables()]);
        return;
    }

    const payload = {
        booking_id: booking.id,
        client_id: selectedClientId || booking.client_id,
        amount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        concept,
        reference_code: reference,
        notes
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
    document.getElementById('rec-booking-title').innerText = p.concept || p.booking_title || '-';
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
    doc.text('EVT Legajo 11036 | CUIT 30-71790874-7', margin + 29, y + 13);
    doc.text('Bernardo de Irigoyen 308 Piso 5, CABA C1072AAH', margin + 29, y + 18);
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
    doc.text(doc.splitTextToSize(p.concept || p.booking_title || 'Servicio', 78), rightX, y);
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

    try {
        if (document.fonts) await document.fonts.ready;
        const sigCanvas = document.createElement('canvas');
        sigCanvas.width = 600;
        sigCanvas.height = 140;
        const sctx = sigCanvas.getContext('2d');
        sctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
        sctx.font = 'bold 44px "Dancing Script", cursive, "Brush Script MT"';
        sctx.fillStyle = '#1e3a8a';
        sctx.textAlign = 'center';
        sctx.textBaseline = 'middle';
        sctx.fillText('Plaza Bohemia Viajes SRL', sigCanvas.width / 2, sigCanvas.height / 2);
        const sigImgData = sigCanvas.toDataURL('image/png');
        doc.addImage(sigImgData, 'PNG', pageWidth - margin - 60, y - 13, 60, 14);
    } catch (e) {
        doc.setFont('times', 'italic');
        doc.setFontSize(13);
        doc.setTextColor(30, 58, 138);
        doc.text('Plaza Bohemia Viajes SRL', pageWidth - margin - 30, y - 2, {align: 'center'});
    }

    doc.setDrawColor(148, 163, 184);
    doc.line(pageWidth - margin - 64, y, pageWidth - margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Firma y Sello Agencia', pageWidth - margin - 32, y + 5, {align: 'center'});

    const safeNumber = String(p.payment_number || 'recibo').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${safeNumber}.pdf`;
    const blob = doc.output('blob');
    return new File([blob], fileName, {type: 'application/pdf'});
}

async function downloadReceiptPdfDirectly() {
    if (!currentReceiptData) return alert('Primero abra un recibo de pago.');
    try {
        const file = await createReceiptPdfFile();
        const objectUrl = URL.createObjectURL(file);
        const downloadLink = document.createElement('a');
        downloadLink.href = objectUrl;
        downloadLink.download = file.name;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        URL.revokeObjectURL(objectUrl);
    } catch (error) {
        alert(error.message || 'Error al generar el PDF del recibo.');
    }
}

async function shareReceiptOnWhatsApp() {
    if (!currentReceiptData) return alert('Abra un recibo antes de compartirlo.');
    try {
        const file = await createReceiptPdfFile();
        const p = currentReceiptData;
        const message = `Hola ${p.client_name || ''}, te compartimos el recibo ${p.payment_number} por ${p.currency || 'USD'} ${Number(p.amount || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}.`;

        const objectUrl = URL.createObjectURL(file);
        const downloadLink = document.createElement('a');
        downloadLink.href = objectUrl;
        downloadLink.download = file.name;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        URL.revokeObjectURL(objectUrl);

        const phone = String(p.client_phone || '').replace(/\D/g, '');
        const encodedText = encodeURIComponent(`${message} (Se adjunta comprobante PDF descargado)`);
        const whatsappUrl = phone
            ? `https://web.whatsapp.com/send?phone=${phone}&text=${encodedText}`
            : `https://web.whatsapp.com/send?text=${encodedText}`;

        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
        alert('Se descargó el recibo en PDF de copia única y se abrió WhatsApp Web para enviar el mensaje y adjuntar el archivo.');
    } catch (error) {
        if (error.name !== 'AbortError') alert(error.message || 'No se pudo preparar el PDF para WhatsApp Web.');
    }
}

async function deleteBooking(id) {
    if (!confirm('¿Está seguro de eliminar esta reserva y sus pagos asociados?')) return;
    await apiFetch(`/api/bookings/${id}`, 'DELETE');
    await refreshAfterFinancialChange();
}

// CLIENTES
async function loadClients() {
    try {
        const clients = await apiFetch('/api/clients');
        clientsCache = clients;
        const tbody = document.getElementById('clients-table-body');
        if (clients.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No hay clientes registrados</td></tr>`;
            applySectionSearch('view-clients');
            return;
        }

        tbody.innerHTML = clients.map(c => `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                <td class="p-4 font-bold text-slate-900">${escapeProfitText(c.name)}</td>
                <td class="p-4 font-medium text-slate-700">
                    ${escapeProfitText(c.document_id)}
                    ${c.birth_date ? `<span class="block text-xs text-slate-500 font-normal">F. Nac: ${escapeProfitText(c.birth_date)}</span>` : ''}
                </td>
                <td class="p-4 text-xs text-slate-700">
                    ${c.passport_number ? `<span class="font-semibold text-slate-800">${escapeProfitText(c.passport_number)}</span>` : '<span class="text-slate-400">Sin pasaporte</span>'}
                    ${c.passport_expiry ? `<span class="block text-slate-500 font-medium">Vence: ${escapeProfitText(c.passport_expiry)}</span>` : ''}
                </td>
                <td class="p-4 text-slate-600">${escapeProfitText(c.email)}</td>
                <td class="p-4 text-slate-600">${escapeProfitText(c.phone)}</td>
                <td class="p-4 text-xs text-slate-500">${escapeProfitText(c.notes || '-')}</td>
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
    document.getElementById('client-birth-date').value = '';
    document.getElementById('client-passport').value = '';
    document.getElementById('client-passport-expiry').value = '';
    openModal('modal-client');
}

async function saveClient(e) {
    e.preventDefault();
    const id = document.getElementById('client-id').value;
    const payload = {
        name: document.getElementById('client-name').value.trim(),
        document_id: document.getElementById('client-doc').value.trim(),
        birth_date: document.getElementById('client-birth-date').value,
        passport_number: document.getElementById('client-passport').value.trim(),
        passport_expiry: document.getElementById('client-passport-expiry').value,
        email: document.getElementById('client-email').value.trim(),
        phone: document.getElementById('client-phone').value.trim(),
        address: document.getElementById('client-address').value.trim(),
        notes: document.getElementById('client-notes').value.trim()
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
    document.getElementById('client-birth-date').value = c.birth_date || '';
    document.getElementById('client-passport').value = c.passport_number || '';
    document.getElementById('client-passport-expiry').value = c.passport_expiry || '';
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
                <td class="p-4 font-bold text-slate-900">
                    ${escapeProfitText(s.name)}
                    ${s.cuit ? `<span class="block text-xs font-normal text-slate-500">CUIT: ${escapeProfitText(s.cuit)}</span>` : ''}
                    ${s.address ? `<span class="block text-xs font-normal text-slate-400 truncate max-w-xs">${escapeProfitText(s.address)}</span>` : ''}
                </td>
                <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">${escapeProfitText(s.category)}</span></td>
                <td class="p-4 font-medium text-slate-700">${escapeProfitText(s.contact_name || '-')}</td>
                <td class="p-4 text-xs text-slate-600">
                    ${escapeProfitText(s.phone || '-')}
                    ${s.email ? `<span class="block text-slate-500">${escapeProfitText(s.email)}</span>` : ''}
                </td>
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
    document.getElementById('supplier-cuit').value = '';
    document.getElementById('supplier-address').value = '';
    document.getElementById('supplier-notes').value = '';
    openModal('modal-supplier');
}

async function saveSupplier(e) {
    e.preventDefault();
    const id = document.getElementById('supplier-id').value;
    const payload = {
        name: document.getElementById('supplier-name').value.trim(),
        cuit: document.getElementById('supplier-cuit').value.trim(),
        category: document.getElementById('supplier-category').value,
        contact_name: document.getElementById('supplier-contact').value.trim(),
        phone: document.getElementById('supplier-phone').value.trim(),
        email: document.getElementById('supplier-email').value.trim(),
        address: document.getElementById('supplier-address').value.trim(),
        notes: document.getElementById('supplier-notes').value.trim()
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
    document.getElementById('supplier-cuit').value = s.cuit || '';
    document.getElementById('supplier-category').value = s.category;
    document.getElementById('supplier-contact').value = s.contact_name || '';
    document.getElementById('supplier-phone').value = s.phone || '';
    document.getElementById('supplier-email').value = s.email || '';
    document.getElementById('supplier-address').value = s.address || '';
    document.getElementById('supplier-notes').value = s.notes || '';
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
                <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">${u.role === 'ventas' ? 'Ventas' : u.role === 'agente' ? 'Agente de Ventas' : u.role === 'administrativa' ? 'Administrativa' : 'Administrador General'}</span></td>
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
    document.getElementById('user-is-active').value = 'true';
    openModal('modal-user');
}

async function saveUser(e) {
    e.preventDefault();
    const id = document.getElementById('user-id').value;
    const password = document.getElementById('user-password').value;
    const payload = {
        username: document.getElementById('user-username').value.trim(),
        full_name: document.getElementById('user-fullname').value.trim(),
        email: document.getElementById('user-email').value.trim(),
        role: document.getElementById('user-role').value,
        is_active: document.getElementById('user-is-active').value === 'true'
    };

    if (password && password.trim()) {
        payload.password = password;
    } else if (!id) {
        alert('Debe ingresar una contraseña para el nuevo usuario');
        return;
    }

    try {
        if (id) {
            const updated = await apiFetch(`/api/users/${id}`, 'PUT', payload);
            if (currentUser && currentUser.id === Number(id)) {
                currentUser.full_name = updated.full_name;
                currentUser.email = updated.email;
                currentUser.username = updated.username;
                currentUser.role = updated.role;
                document.getElementById('user-display-name').innerText = currentUser.full_name || currentUser.username;
                document.getElementById('user-display-role').innerText = currentUser.role || 'usuario';
                document.getElementById('user-avatar').innerText = (currentUser.full_name || currentUser.username || 'U').charAt(0).toUpperCase();
                applyRolePermissions();
            }
        } else {
            await apiFetch('/api/users', 'POST', payload);
        }

        closeModal('modal-user');
        await loadUsers();
        await loadSalespeopleCache();
    } catch (err) {
        console.error(err);
    }
}

async function editUser(id) {
    const users = await apiFetch('/api/users');
    const u = users.find(x => x.id === id);
    if (!u) return;

    document.getElementById('modal-user-title').innerText = 'Editar Usuario';
    document.getElementById('user-id').value = u.id;
    document.getElementById('user-username').value = u.username || '';
    document.getElementById('user-fullname').value = u.full_name || '';
    document.getElementById('user-email').value = u.email || '';
    document.getElementById('user-role').value = u.role;
    document.getElementById('user-is-active').value = u.is_active ? 'true' : 'false';
    document.getElementById('user-password').value = '';
    document.getElementById('user-password').required = false;
    document.getElementById('user-pw-hint').innerText = '(dejar en blanco para mantener actual)';
    openModal('modal-user');
}

async function deleteUser(id) {
    if (!confirm('¿Está seguro de eliminar este usuario?')) return;
    try {
        await apiFetch(`/api/users/${id}`, 'DELETE');
        await loadUsers();
        await loadSalespeopleCache();
    } catch (err) {
        console.error(err);
    }
}

async function revertBookingToBudget(id) {
    if (!confirm('¿Desea volver esta Reserva nuevamente a Presupuesto/Borrador?')) return;
    try {
        await apiFetch(`/api/bookings/${id}/revert-to-budget`, 'POST');
        alert('Reserva revertida a Presupuesto exitosamente.');
        await refreshAfterFinancialChange();
    } catch (e) { console.error(e); }
}

async function revertBudgetToDraft(budgetId) {
    if (!confirm('¿Desea revertir este presupuesto a estado Borrador para poder modificarlo?')) return;
    await apiFetch(`/api/budgets/${budgetId}/revert-to-draft`, 'POST');
    alert('Presupuesto revertido a Borrador exitosamente!');
    await refreshAfterFinancialChange();
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
                const isSupplierExpense = p.record_type === 'Proveedor';
                return `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td class="p-4 font-bold text-slate-900">${escapeProfitText(p.payment_number)}</td>
                        <td class="p-4 font-medium text-slate-800">${escapeProfitText(p.booking_number || (isSupplierExpense ? 'Sin reserva asociada' : 'Reserva'))}<span class="block text-xs font-normal text-slate-500">${escapeProfitText(isSupplierExpense ? p.supplier_name : (p.client_name || 'Cliente'))}</span></td>
                        <td class="p-4 text-slate-700">${escapeProfitText(p.payment_date)}<span class="block text-xs font-mono text-slate-400">${escapeProfitText(timePart)}</span></td>
                        <td class="p-4 text-right font-bold ${isSupplierExpense ? 'text-rose-700' : 'text-emerald-600'}">${Number(p.amount || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                        <td class="p-4">${escapeProfitText(p.payment_method)}<span class="block text-xs text-slate-500">${escapeProfitText(p.payment_type)}</span></td>
                        <td class="p-4 text-xs">${escapeProfitText(p.reference_code || '-')}<span class="block italic text-slate-400">${escapeProfitText(p.notes || '')}</span></td>
                        <td class="p-4">${escapeProfitText(p.registered_by_user_name || 'Agente')}</td>
                        <td class="p-4 text-right">${isSupplierExpense ? `<button onclick="anularPagoProveedor(${p.payable_id}, ${p.supplier_payment_id})" class="text-xs text-rose-700 hover:text-rose-900">Anular egreso</button>` : `<button onclick="showReceiptModal(${p.id})" class="text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold px-2.5 py-1 rounded-lg transition">Ver recibo</button>`}</td>
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
