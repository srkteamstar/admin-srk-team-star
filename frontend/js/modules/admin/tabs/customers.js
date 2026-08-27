/**
 * customers.js — the dashboard's Customers tab
 *
 * Used to be a 2-row hardcoded array with entirely fabricated stat tiles
 * ("1,248 Total Customers" bore no relation to the 2 rows below it) and an
 * Edit button with no listener. Now reads GET /api/customers (backend/
 * server.js), which joins `user_profiles` with `roles` (role_id ->
 * role_name), `orders` + `order_items` (order history with its line items,
 * plus an aggregated count and spend) and `shipping_addresses` (the
 * customer's saved addresses — distinct from `order_shipping_address`, the
 * one-off snapshot on a specific order).
 *
 * WHAT ADMIN MAY DO HERE, AND WHAT IT MAY NOT
 * -------------------------------------------
 * Accounts are still created by the storefront and never by admin, so there
 * is no create and no edit — this file has no form in it. The two writes it
 * does own are the two an administrator genuinely owns:
 *
 *   Block / Unblock   PATCH /api/customers/:id/status   reversible
 *   Delete            DELETE /api/customers/:id         only with no orders
 *
 * Both are refused by the server for an `admin` row and for the caller's own
 * row, and this file simply does not draw them for a row whose role is
 * `admin` — which covers the signed-in administrator too, since the only way
 * to be looking at this table is to be one. The server check is the one that
 * counts; hiding the button is so nobody is offered an action that is going
 * to be refused.
 *
 * DELETE IS THE NARROW ONE. `orders.user_id` is NOT NULL, so removing a
 * profile that has ever ordered would leave an invoice with nobody attached.
 * The server refuses that with a count and a sentence saying to block
 * instead; this file shows that sentence rather than flattening it to
 * "failed", because the difference between "cannot" and "try again" is the
 * whole message.
 *
 * THE ROW MENU IS CLICK-TOGGLED, NOT HOVER
 * ----------------------------------------
 * enquiries.js and quotations.js open their row menu on `group-hover/menu`,
 * which is right for what those menus hold — three status changes that are
 * all reversible with one more click. This menu holds *Delete user*. A menu
 * that opens because a pointer crossed a row, over a table whose rows are
 * themselves clickable, is the wrong affordance for that: it takes deliberate
 * intent to open, so it opens on a click. It is also the only way the menu
 * works on a touch screen, where there is no hover to give.
 *
 * CONVENTIONS
 * -----------
 * Same shape as orders.js/quotations.js: `window.customerData` array,
 * load/render split, `window.customerLoadError` + inline retry-row on
 * failure (products.js's convention). `confirm()` before a destructive
 * action, as every other admin tab does.
 *
 * LOAD ORDER
 * ----------
 * After price-format-module.js, for formatAmount. Admin identity comes from
 * window.adminAuth.fetch (admin-auth-module.js).
 */

// ==========================================
// 0. UTILS
// ==========================================
const escapeCustomerText = (str) => {
    if (str === null || str === undefined) return '';
    return str.toString().replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
};

const formatCustomerDate = (iso, options) => {
    if (!iso) return 'Unknown Date';
    return new Date(iso).toLocaleString('en-IN', options || {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
};

const DAY_MONTH_YEAR = { day: '2-digit', month: 'short', year: 'numeric' };

const customerInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
};

// Money, always through the one module that decides how a rupee figure reads,
// so the customer's "₹ 39,825" and the storefront's are the same object.
const customerMoney = (value) => {
    if (window.formatAmount) {
        const formatted = window.formatAmount(value);
        if (formatted) return formatted;
    }
    return '₹ 0';
};

const ORDER_STATUS_BADGE_CLASSES = {
    'Processing': 'bg-yellow-100 text-yellow-700',
    'Shipped': 'bg-blue-100 text-blue-700',
    'Delivered': 'bg-green-100 text-green-700',
    'Cancelled': 'bg-red-100 text-red-700'
};

// ==========================================
// 1. STATE
// ==========================================
window.customerData = [];
window.customerLoadError = null;

// The last block/delete failure, shown as a banner above the table until the
// next action or reload clears it. A banner rather than alert() because the
// server's refusals here are whole sentences with a count in them — "this
// customer has 3 orders against their name…" — and an alert throws that away
// the moment it is dismissed.
window.customerActionError = null;

// The id whose row menu is open, or null. Held here rather than in the DOM
// because renderCustomersView() replaces the whole table.
let openCustomerMenuId = null;

// ==========================================
// 2. FETCH & DATA MAPPING
// ==========================================
window.loadCustomers = async function() {
    window.customerLoadError = null;
    try {
        const response = await window.adminAuth.fetch('/api/customers');
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const data = await response.json();

        window.customerData = (data || []).map(row => ({
            id: row.id,
            name: escapeCustomerText(row.full_name || 'Unknown'),
            email: escapeCustomerText(row.email || ''),
            phone: row.phone_number ? escapeCustomerText(String(row.phone_number)) : '',
            company: escapeCustomerText(row.company || ''),
            role: row.role ? escapeCustomerText(row.role) : '',
            isAdmin: String(row.role || '').toLowerCase() === 'admin',
            isBlocked: row.is_blocked === true,
            blockedAt: row.blocked_at,
            createdAt: row.created_at,
            orderCount: row.order_count || 0,
            totalSpent: row.total_spent || 0,
            lastPurchaseAt: row.last_purchase_at,
            orders: (row.orders || []).map(o => ({
                id: o.id,
                orderNumber: o.order_number,
                amount: o.amount,
                shippingAmount: o.shipping_amount,
                taxAmount: o.tax_amount,
                netAmount: o.net_amount,
                status: o.status || 'Processing',
                tracking: o.tracking ? escapeCustomerText(o.tracking) : '',
                createdAt: o.created_at,
                items: (o.items || []).map(i => ({
                    id: i.id,
                    productId: i.product_id,
                    name: escapeCustomerText(i.product_name || 'Product'),
                    price: i.price,
                    quantity: i.quantity || 1,
                    totalAmount: i.total_amount
                }))
            })),
            addresses: (row.addresses || []).map(a => ({
                id: a.id,
                fullAddress: escapeCustomerText(a.full_address || ''),
                city: escapeCustomerText(a.city || ''),
                state: escapeCustomerText(a.state || ''),
                country: escapeCustomerText(a.country || ''),
                zipCode: escapeCustomerText(a.zip_code || '')
            }))
        }));

        return true;
    } catch (error) {
        console.error('Error fetching customers:', error);
        window.customerLoadError = error.message || 'Failed to load customers.';
        return false;
    }
};

window.findCustomer = function(id) {
    const searchId = typeof id === 'string' && !isNaN(id) ? parseInt(id, 10) : id;
    return window.customerData.find(c => c.id == searchId) || null;
};

// ==========================================
// 3. UI RENDERING (Table View)
// ==========================================
window.renderCustomers = async function() {
    // Both are per-visit state, and both would otherwise survive a tab
    // switch: a menu left open would repaint over whatever tab you had gone
    // to, and a failure from ten minutes ago would greet you on the way back
    // in as though it had just happened.
    openCustomerMenuId = null;
    window.customerActionError = null;

    const success = await window.loadCustomers();
    window.renderCustomersView();
    return success;
};

const ICON_EYE = 'M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z';
const ICON_BLOCK = 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636';
const ICON_UNBLOCK = 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
const ICON_TRASH = 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';

function menuItemHTML(options) {
    const tone = options.danger
        ? 'text-red-600 hover:bg-red-50'
        : 'text-[#12170f] hover:bg-gray-50';

    return `
        <button type="button" onclick="event.stopPropagation(); window.closeCustomerMenus(); ${options.action}"
            class="w-full px-4 py-2.5 text-left text-xs font-bold ${tone} transition-colors flex items-center gap-2.5 ${options.divider ? 'border-b border-[#12170f]/5' : ''}">
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${options.icon}"></path></svg>
            ${options.label}
        </button>`;
}

// `openUp` for the last rows: the menu is absolutely positioned inside a
// scrolling container, so one hanging off the bottom row would be clipped by
// the container rather than overflowing it.
function customerMenuHTML(c, openUp) {
    const isOpen = openCustomerMenuId != null && String(openCustomerMenuId) === String(c.id);

    const items = [
        menuItemHTML({
            label: 'View details',
            icon: ICON_EYE,
            action: `window.handleCustomerAction('${c.id}')`,
            divider: !c.isAdmin
        })
    ];

    // An admin row is refused by the server for both writes, so it is not
    // offered either. See the header comment.
    if (!c.isAdmin) {
        items.push(menuItemHTML({
            label: c.isBlocked ? 'Unblock user' : 'Block user',
            icon: c.isBlocked ? ICON_UNBLOCK : ICON_BLOCK,
            action: `window.setCustomerBlocked('${c.id}', ${c.isBlocked ? 'false' : 'true'})`,
            divider: true
        }));
        items.push(menuItemHTML({
            label: 'Delete user',
            icon: ICON_TRASH,
            action: `window.deleteCustomer('${c.id}')`,
            danger: true
        }));
    }

    return `
        <div class="inline-block text-left">
            <button type="button" id="customer-menu-btn-${c.id}" aria-haspopup="true" aria-expanded="${isOpen}"
                onclick="event.stopPropagation(); window.toggleCustomerMenu('${c.id}')"
                class="p-1 rounded-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] ${isOpen ? 'text-[#d4af37] bg-[#d4af37]/10' : 'text-[#1f271b]/40 hover:text-[#d4af37]'}">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
            </button>
            <div id="customer-menu-${c.id}" role="menu"
                class="customer-row-menu absolute right-10 ${openUp ? 'bottom-2' : 'top-10'} w-44 bg-white border border-[#12170f]/10 rounded-sm shadow-lg z-30 overflow-hidden flex-col text-left ${isOpen ? 'flex' : 'hidden'}">
                ${items.join('')}
            </div>
        </div>`;
}

window.toggleCustomerMenu = function(id) {
    openCustomerMenuId = (openCustomerMenuId != null && String(openCustomerMenuId) === String(id)) ? null : id;
    window.renderCustomersView();
};

window.closeCustomerMenus = function() {
    if (openCustomerMenuId === null) return;

    openCustomerMenuId = null;

    // GUARDED ON THE TAB, NOT JUST ON THE FLAG. These two listeners are on
    // "document" and so fire for every click anywhere in the dashboard,
    // including on another tab entirely — and renderCustomersView() writes
    // #main-content unconditionally. Without this an open menu left behind by
    // a tab switch would paint the customer table over Products the next time
    // anything was clicked.
    if (!window.app || window.app.currentTab !== 'customers') return;

    window.renderCustomersView();
};

// Anywhere else on the page closes it. Registered once, at load, rather than
// per render — renderCustomersView() replaces the table on every action and a
// per-render listener would stack up one copy per repaint. The kebab button
// and every item in the menu call stopPropagation(), so the click that opens
// the menu is not also the click that closes it.
document.addEventListener('click', () => window.closeCustomerMenus());
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.closeCustomerMenus();
});

function customerActionBannerHTML() {
    if (!window.customerActionError) return '';

    return `
        <div class="mb-6 max-w-3xl flex items-start gap-3 bg-red-50 border border-red-200 rounded-sm p-4">
            <svg class="w-4 h-4 text-red-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.5 0l-7.1 12.25A2 2 0 004.99 19z"></path></svg>
            <p class="text-xs text-red-700 font-semibold leading-relaxed flex-1">${escapeCustomerText(window.customerActionError)}</p>
            <button type="button" onclick="event.stopPropagation(); window.dismissCustomerActionError()" class="text-red-400 hover:text-red-600 transition-colors shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>`;
}

window.dismissCustomerActionError = function() {
    window.customerActionError = null;
    window.renderCustomersView();
};

window.renderCustomersView = function() {
    const data = window.customerData;
    const container = document.getElementById('main-content');
    if (!container) return;

    const total = data.length;
    const now = new Date();
    const newThisMonth = data.filter(c => {
        if (!c.createdAt) return false;
        const d = new Date(c.createdAt);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    const blocked = data.filter(c => c.isBlocked).length;

    const statsHtml = `
        <div class="grid grid-cols-3 gap-4 mb-8 max-w-3xl">
            <div class="bg-white border-b-2 border-b-[#d4af37] p-5 shadow-sm">
                <h3 class="text-2xl font-bold">${total}</h3><p class="text-[10px] text-[#1f271b]/60 uppercase font-bold tracking-wider mt-1">Total Customers</p>
            </div>
            <div class="bg-white border-b-2 border-b-blue-500 p-5 shadow-sm">
                <h3 class="text-2xl font-bold">${newThisMonth}</h3><p class="text-[10px] text-[#1f271b]/60 uppercase font-bold tracking-wider mt-1">New This Month</p>
            </div>
            <div class="bg-white border-b-2 ${blocked ? 'border-b-red-500' : 'border-b-[#12170f]/15'} p-5 shadow-sm">
                <h3 class="text-2xl font-bold ${blocked ? 'text-red-600' : ''}">${blocked}</h3><p class="text-[10px] text-[#1f271b]/60 uppercase font-bold tracking-wider mt-1">Blocked</p>
            </div>
        </div>`;

    const tableHeaders = `
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[28%]">Customer</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[16%]">Phone</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[10%]">Orders</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[16%]">Total Spent</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[18%]">Last Purchase</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[12%] text-right">Actions</th>`;

    let rows;
    if (window.customerLoadError) {
        rows = `<tr><td colspan="6" class="py-10 text-center">
            <p class="text-red-600 font-bold text-sm px-6">${escapeCustomerText(window.customerLoadError)}</p>
            <button onclick="window.renderCustomers()" class="mt-3 text-xs font-bold text-[#d4af37] hover:underline">Retry</button>
        </td></tr>`;
    } else if (total === 0) {
        rows = `<tr><td colspan="6" class="text-center py-8 text-[#1f271b]/60 font-medium">No customers yet.</td></tr>`;
    } else {
        rows = data.map((c, index) => {
            const isActiveRow = window.app && window.app.activeItemId == c.id;
            const openUp = total > 3 && index >= total - 2;

            return `
            <tr id="customer-row-${c.id}" class="transition-colors cursor-pointer ${isActiveRow ? 'bg-[#d4af37]/5 border-l-2 border-l-[#d4af37]' : 'hover:bg-gray-50'} group" onclick="window.handleCustomerAction('${c.id}')">
                <td class="py-3 px-5">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full ${c.isBlocked ? 'bg-red-100 text-red-500' : 'bg-[#12170f] text-[#d4af37]'} flex items-center justify-center font-bold text-sm shrink-0">${customerInitials(c.name)}</div>
                        <div class="overflow-hidden">
                            <p class="font-bold text-base group-hover:text-[#d4af37] truncate flex items-center gap-2">
                                <span class="truncate ${c.isBlocked ? 'text-[#1f271b]/50' : ''}">${c.name}</span>
                                ${c.isBlocked ? '<span class="shrink-0 px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wider bg-red-100 text-red-700">Blocked</span>' : ''}
                                ${c.isAdmin ? '<span class="shrink-0 px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wider bg-[#12170f] text-[#d4af37]">Admin</span>' : ''}
                            </p>
                            <p class="text-[#1f271b]/60 text-xs truncate">${c.email}</p>
                        </div>
                    </div>
                </td>
                <td class="py-3 px-5 text-[#1f271b]/70 font-medium truncate">${c.phone || '<span class="text-[#1f271b]/30">N/A</span>'}</td>
                <td class="py-3 px-5 font-bold text-lg">${c.orderCount}</td>
                <td class="py-3 px-5 font-bold text-[#12170f] truncate">${customerMoney(c.totalSpent)}</td>
                <td class="py-3 px-5 text-[#1f271b]/70 text-xs truncate">${c.lastPurchaseAt ? formatCustomerDate(c.lastPurchaseAt, DAY_MONTH_YEAR) : 'No orders yet'}</td>
                <td class="py-3 px-5 text-right relative overflow-visible">${customerMenuHTML(c, openUp)}</td>
            </tr>`;
        }).join('');
    }

    container.innerHTML = `
        <div class="mb-10"><h2 class="text-3xl font-bold tracking-tight text-[#12170f]">Customers</h2><p class="text-sm text-[#1f271b]/60 mt-2">Accounts created through the store, with their order history.</p></div>
        ${statsHtml}
        ${customerActionBannerHTML()}
        <div class="bg-white border border-[#12170f]/10 rounded-sm mb-6 shadow-sm overflow-hidden flex flex-col relative">
            <div class="overflow-x-auto overflow-y-auto flex-1 min-h-[420px] max-h-[calc(100vh-330px)] pb-16">
                <table class="w-[900px] xl:w-full text-left border-collapse table-fixed">
                    <thead><tr class="text-[10px] text-[#12170f]/40 uppercase tracking-widest font-bold">${tableHeaders}</tr></thead>
                    <tbody id="customers-tbody" class="text-sm font-semibold divide-y divide-[#12170f]/5">${rows}</tbody>
                </table>
            </div>
        </div>
    `;
};

// ==========================================
// 4. ACTIONS (Block / Unblock / Delete)
// ==========================================
// Both writes refetch the whole list afterwards rather than patching the row
// in place. The list is small, the server is the only thing that knows what
// actually happened (a delete can be refused after the confirm), and a
// half-updated row that disagrees with the database is worse than a moment's
// wait.
async function refreshCustomersKeepingDrawer(id) {
    await window.loadCustomers();
    window.renderCustomersView();

    // The drawer is showing a snapshot taken before the write. If it is this
    // customer's, repaint it from the row that just came back.
    if (window.app && window.app.activeItemId != null && String(window.app.activeItemId) === String(id)) {
        if (window.findCustomer(id)) window.handleCustomerAction(id);
        else window.app.closeDrawer();
    }
}

window.setCustomerBlocked = async function(id, blocked) {
    const c = window.findCustomer(id);
    const who = c ? c.name : 'this customer';

    const question = blocked
        ? `Block ${who}?\n\nThey will not be able to sign in, and any session they already have stops working on their next request. Their orders and details are kept, and you can undo this at any time.`
        : `Unblock ${who}?\n\nThey will be able to sign in again.`;

    if (!confirm(question)) return;

    window.customerActionError = null;

    try {
        const response = await window.adminAuth.fetch(`/api/customers/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocked: blocked })
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
            window.customerActionError = (payload && payload.error) ||
                `Could not ${blocked ? 'block' : 'unblock'} that account.`;
            window.renderCustomersView();
            return;
        }

        await refreshCustomersKeepingDrawer(id);
    } catch (error) {
        console.error('Failed to change customer status:', error);
        window.customerActionError = 'Could not reach the server. Check your connection and try again.';
        window.renderCustomersView();
    }
};

window.deleteCustomer = async function(id) {
    const c = window.findCustomer(id);
    const who = c ? c.name : 'this customer';

    // Said before the request rather than discovered after it. The server
    // refuses this anyway and says so in a full sentence, but there is no
    // reason to let someone press through a confirm for an action that
    // cannot succeed.
    if (c && c.orderCount > 0) {
        window.customerActionError = `${who} has ${c.orderCount} order${c.orderCount === 1 ? '' : 's'} against their name, so the profile cannot be deleted — an order with nobody attached is not a thing this database can hold. Block the account instead; it stops them signing in and can be undone.`;
        window.renderCustomersView();
        return;
    }

    if (!confirm(`Delete ${who}?\n\nThis removes the profile and its saved address for good. It cannot be undone.`)) return;

    window.customerActionError = null;

    const row = document.getElementById(`customer-row-${id}`);
    if (row) {
        row.style.opacity = '0.4';
        row.style.backgroundColor = '#fee2e2';
    }

    try {
        const response = await window.adminAuth.fetch(`/api/customers/${id}`, { method: 'DELETE' });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
            window.customerActionError = (payload && payload.error) || 'Could not delete that customer.';
            window.renderCustomersView();
            return;
        }

        if (window.app && window.app.activeItemId != null && String(window.app.activeItemId) === String(id)) {
            window.app.closeDrawer();
        }

        await window.loadCustomers();
        window.renderCustomersView();
    } catch (error) {
        console.error('Failed to delete customer:', error);
        window.customerActionError = 'Could not reach the server. Check your connection and try again.';
        window.renderCustomersView();
    }
};

// ==========================================
// 5. UI RENDERING (Drawer View)
// ==========================================
function customerSectionHeading(iconPath, label) {
    return `
        <div class="flex items-center gap-2 text-[#12170f]/40 font-bold text-xs tracking-wider uppercase mb-4">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}"></path></svg>
            ${label}
        </div>`;
}

function customerStatTileHTML(value, label, tone) {
    return `
        <div class="bg-[#f8fafc] border border-[#12170f]/5 rounded-sm px-3 py-3 text-center">
            <p class="text-base font-bold ${tone || 'text-[#12170f]'} truncate">${value}</p>
            <p class="text-[9px] text-[#1f271b]/50 uppercase font-bold tracking-wider mt-1">${label}</p>
        </div>`;
}

function customerAddressesHTML(customer) {
    if (!customer.addresses.length) {
        return `<p class="text-sm text-[#1f271b]/40 italic">No saved addresses.</p>`;
    }
    return `<div class="grid grid-cols-1 gap-3 text-sm">${customer.addresses.map(a => `
        <div class="p-4 bg-[#f8fafc] border border-[#12170f]/5 rounded-sm">
            <p class="text-[#12170f] font-bold leading-relaxed">${a.fullAddress}<br>${a.city}, ${a.state} - ${a.zipCode}<br>${a.country}</p>
        </div>`).join('')}</div>`;
}

// The line items are the first question anyone opening this drawer has: the
// row above says a customer spent ₹ 39,825, and this says what on.
function orderItemsHTML(order) {
    if (!order.items.length) {
        return `<p class="text-[11px] text-[#1f271b]/40 italic mt-2">No line items recorded.</p>`;
    }

    return `
        <ul class="mt-3 space-y-1.5 border-t border-[#12170f]/5 pt-3">
            ${order.items.map(i => `
            <li class="flex items-start justify-between gap-3 text-[11px]">
                <span class="text-[#1f271b]/70 font-semibold flex-1 leading-snug">${i.name}<span class="text-[#1f271b]/40"> × ${i.quantity}</span></span>
                <span class="text-[#12170f] font-bold shrink-0">${customerMoney(i.totalAmount)}</span>
            </li>`).join('')}
        </ul>`;
}

function orderMoneyRowHTML(label, value, strong) {
    return `
        <div class="flex items-center justify-between text-[11px] ${strong ? 'font-bold text-[#12170f] pt-1.5 border-t border-[#12170f]/5' : 'text-[#1f271b]/55 font-semibold'}">
            <span>${label}</span><span>${value}</span>
        </div>`;
}

function customerOrdersHTML(customer) {
    if (!customer.orders.length) {
        return `<p class="text-sm text-[#1f271b]/40 italic">No orders yet.</p>`;
    }

    return `<div class="space-y-4">${customer.orders.map(o => `
        <div class="bg-white border border-[#12170f]/10 rounded-sm p-4 shadow-sm">
            <div class="flex items-start justify-between gap-3">
                <div class="overflow-hidden">
                    <p class="font-bold text-[#12170f] text-sm truncate">#${o.orderNumber}</p>
                    <p class="text-[10px] text-[#1f271b]/50 font-semibold mt-0.5">${formatCustomerDate(o.createdAt, DAY_MONTH_YEAR)}</p>
                </div>
                <span class="shrink-0 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider ${ORDER_STATUS_BADGE_CLASSES[o.status] || ORDER_STATUS_BADGE_CLASSES['Processing']}">${o.status}</span>
            </div>

            ${o.tracking ? `<p class="text-[10px] text-[#1f271b]/50 font-semibold mt-2">Tracking <span class="text-[#12170f] font-bold">${o.tracking}</span></p>` : ''}

            ${orderItemsHTML(o)}

            <div class="mt-3 space-y-1">
                ${orderMoneyRowHTML('Goods', customerMoney(o.amount))}
                ${orderMoneyRowHTML('Delivery', Number(o.shippingAmount) > 0 ? customerMoney(o.shippingAmount) : 'Free')}
                ${orderMoneyRowHTML('GST', customerMoney(o.taxAmount))}
                ${orderMoneyRowHTML('Total', customerMoney(o.netAmount), true)}
            </div>
        </div>`).join('')}</div>`;
}

// The drawer's own copy of the two writes, so an administrator who opened a
// customer to decide does not have to close it again to act. Same functions
// the row menu calls — there is one implementation of each.
function customerDrawerActionsHTML(customer) {
    if (customer.isAdmin) {
        return `
            <div class="border-t border-[#12170f]/10 pt-6 mt-8">
                <p class="text-xs text-[#1f271b]/45 leading-relaxed">This is an administrator account. Blocking and deletion are deliberately not available here — change the role in Supabase first.</p>
            </div>`;
    }

    const blockLabel = customer.isBlocked ? 'Unblock user' : 'Block user';
    const blockIcon = customer.isBlocked ? ICON_UNBLOCK : ICON_BLOCK;

    return `
        <div class="border-t border-[#12170f]/10 pt-6 mt-8 flex items-center gap-3">
            <button type="button" onclick="window.setCustomerBlocked('${customer.id}', ${customer.isBlocked ? 'false' : 'true'})"
                class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-xs font-bold border transition-colors ${customer.isBlocked ? 'border-green-600/30 text-green-700 hover:bg-green-50' : 'border-[#12170f]/15 text-[#12170f] hover:bg-[#12170f] hover:text-white'}">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${blockIcon}"></path></svg>
                ${blockLabel}
            </button>
            <button type="button" onclick="window.deleteCustomer('${customer.id}')"
                class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-xs font-bold border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${ICON_TRASH}"></path></svg>
                Delete
            </button>
        </div>`;
}

window.handleCustomerAction = function(id) {
    const searchId = typeof id === 'string' && !isNaN(id) ? parseInt(id, 10) : id;

    if (window.app) window.app.activeItemId = searchId;
    window.renderCustomersView();

    const c = window.findCustomer(searchId);
    if (!c) return;

    const ICON_USER = 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z';
    const ICON_PIN = 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z';
    const ICON_BOX = 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z';

    const contactRow = (label, value) =>
        `<div class="text-[#1f271b]/60 font-medium">${label}</div><div class="text-[#12170f] font-bold break-words">${value}</div>`;

    const html = `
        <div class="flex items-center gap-4 border-b border-[#12170f]/10 pb-6 mb-6">
            <div class="w-16 h-16 ${c.isBlocked ? 'bg-red-100 text-red-500' : 'bg-[#12170f] text-[#d4af37]'} rounded-full flex items-center justify-center text-2xl font-bold tracking-wider shrink-0">${customerInitials(c.name)}</div>
            <div class="overflow-hidden">
                <h4 class="text-2xl font-bold text-[#12170f] truncate">${c.name}</h4>
                ${c.role ? `<p class="text-sm font-bold text-[#1f271b]/60 mt-0.5 capitalize">${c.role}</p>` : ''}
                <p class="text-xs text-[#1f271b]/40 mt-1">Customer since ${formatCustomerDate(c.createdAt, DAY_MONTH_YEAR)}</p>
            </div>
        </div>

        ${c.isBlocked ? `
        <div class="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 rounded-sm p-4">
            <svg class="w-4 h-4 text-red-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${ICON_BLOCK}"></path></svg>
            <p class="text-xs text-red-700 font-semibold leading-relaxed">This account is blocked${c.blockedAt ? ` since ${formatCustomerDate(c.blockedAt, DAY_MONTH_YEAR)}` : ''}. They cannot sign in, check out, or use a session they already had.</p>
        </div>` : ''}

        <div class="grid grid-cols-3 gap-3 mb-8">
            ${customerStatTileHTML(customerMoney(c.totalSpent), 'Total Purchase Value', 'text-[#d4af37]')}
            ${customerStatTileHTML(c.orderCount, 'Orders')}
            ${customerStatTileHTML(c.lastPurchaseAt ? formatCustomerDate(c.lastPurchaseAt, { day: '2-digit', month: 'short' }) : '—', 'Last Purchase')}
        </div>

        <div class="mb-8">
            ${customerSectionHeading(ICON_USER, 'Contact Details')}
            <div class="grid grid-cols-[100px_1fr] gap-y-3 text-sm">
                ${contactRow('Email', `<a href="mailto:${c.email}" class="hover:text-[#d4af37] transition-colors">${c.email}</a>`)}
                ${contactRow('Phone', c.phone ? `<a href="tel:${c.phone}" class="hover:text-[#d4af37] transition-colors">${c.phone}</a>` : '<span class="text-[#1f271b]/40">N/A</span>')}
                ${contactRow('Business', c.company || '<span class="text-[#1f271b]/40">Not given</span>')}
            </div>
        </div>

        <div class="mb-8 border-t border-[#12170f]/10 pt-6">
            ${customerSectionHeading(ICON_PIN, `Shipping Addresses (${c.addresses.length})`)}
            ${customerAddressesHTML(c)}
        </div>

        <div class="border-t border-[#12170f]/10 pt-6">
            ${customerSectionHeading(ICON_BOX, `Order History (${c.orderCount})`)}
            ${customerOrdersHTML(c)}
        </div>

        ${customerDrawerActionsHTML(c)}
    `;

    const headerBadge = c.isBlocked
        ? '<span class="px-2.5 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider border text-red-600 border-red-500 bg-red-50/30">Blocked</span>'
        : '<span class="px-2.5 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider border text-green-600 border-green-500 bg-green-50/30">Active</span>';

    if (window.app && window.app.openDrawer) {
        window.app.openDrawer(html, 'Customer Profile', headerBadge);
    }
};
