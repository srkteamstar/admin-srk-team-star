/**
 * orders.js — the dashboard's Orders tab
 *
 * Used to be a 4-row hardcoded array with a fabricated "1,248 Total
 * Customers"-style veneer — no backend route, no DB table, an Edit button
 * with no listener. Now reads GET /api/orders (backend/server.js), which
 * joins `orders` with `user_profiles` (customer), `order_items` (line
 * items), `order_shipping_address` (the address snapshot on that order) and
 * `payments` (the most recent payment row, if any).
 *
 * `status` / `tracking` are real columns (backend/migrations/010_orders_
 * status_tracking.sql) — the only two fields on an order this tab can
 * actually change. Everything else here is a financial record: no create,
 * no delete. `status` is fulfillment (Processing/Shipped/Delivered/
 * Cancelled), deliberately separate from `payment.status` (whether money
 * moved) — an order can be Paid and still sit in Processing for days.
 *
 * CONVENTIONS
 * -----------
 * Same shape as quotations.js: a `window.orderData` array, `window.
 * loadOrders()` / `window.renderOrders()` / `window.renderOrdersView()`
 * split, smooth DOM updaters instead of a full re-render on status change,
 * sticky table head, per-row click menu for the status actions that
 * genuinely exist. Error display uses products.js's `window.orderLoadError`
 * + inline retry-row-in-table instead of quotations.js's whole-container
 * swap.
 *
 * LOAD ORDER
 * ----------
 * After price-format-module.js, for formatAmount/formatProductPrice. Admin
 * identity comes from window.adminAuth.fetch (admin-auth-module.js).
 */

// ==========================================
// 0. UTILS
// ==========================================
const escapeOrderText = (str) => {
    if (str === null || str === undefined) return '';
    return str.toString().replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
};

const formatOrderDate = (iso) => {
    if (!iso) return 'Unknown Date';
    return new Date(iso).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
};

// PALETTE, AND THE ONE ENTRY THAT WAS MISSING FOR A LONG TIME.
//
// Every lookup of this object is `ORDER_STATUS_CLASSES[status] || [...]['Processing']`,
// so an unlisted status did not fail loudly — it rendered in the YELLOW that
// means "in fulfilment". 'Pending Payment' (added to `orders` by migration 014)
// was unlisted, so an order nobody had paid for sat in the admin table wearing
// the colour of one that was being packed. The customer's own history painted
// the same order RED, because my-orders-module.js's fallback was the Cancelled
// colour — two surfaces, the same order, the two colours that mean opposite
// things.
//
// Amber for both now, and it is deliberately neither: not progressing, not
// over, waiting on the customer.
const ORDER_STATUS_CLASSES = {
    'Pending Payment': { badge: 'text-amber-700 border-amber-500 bg-amber-50/60', drawer: 'text-amber-800 border-amber-500 bg-amber-50', menu: 'text-amber-700 bg-amber-50/60' },
    'Processing': { badge: 'text-yellow-600 border-yellow-500 bg-yellow-50/30', drawer: 'text-yellow-700 border-yellow-500 bg-yellow-50', menu: 'text-yellow-600 bg-yellow-50/50' },
    'Shipped': { badge: 'text-blue-600 border-blue-500 bg-blue-50/30', drawer: 'text-blue-700 border-blue-500 bg-blue-50', menu: 'text-blue-600 bg-blue-50/50' },
    'Delivered': { badge: 'text-green-600 border-green-500 bg-green-50/30', drawer: 'text-green-700 border-green-500 bg-green-50', menu: 'text-green-600 bg-green-50/50' },
    'Cancelled': { badge: 'text-red-600 border-red-500 bg-red-50/30', drawer: 'text-red-700 border-red-500 bg-red-50', menu: 'text-red-600 bg-red-50/50' }
};

// WHICH STATUSES MAY THIS ORDER BE MOVED TO?
//
// 'Pending Payment' is in the server's ORDER_STATUSES whitelist so the state is
// expressible at all — without it an order in that status could be moved to any
// of the other four and never moved back, and one stray click destroyed the
// only record that money was still owed.
//
// But it must not be OFFERED on an order that is not already in it. Setting a
// paid, in-fulfilment order back to 'Pending Payment' does not un-take the
// money; it just makes the dashboard lie, and markOrderPaid()'s guarded update
// would then let a redelivered webhook move it forward again on its own. So it
// appears in the list only when it is where the order already is — visible,
// preserved through a round trip, and never a destination.
const FULFILMENT_STATUSES = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];

window.orderStatusOptions = function(status) {
    return status === 'Pending Payment'
        ? ['Pending Payment'].concat(FULFILMENT_STATUSES)
        : FULFILMENT_STATUSES;
};

// ==========================================
// 1. STATE
// ==========================================
window.orderData = [];
window.orderLoadError = null;
window.openOrderActionsId = null;

window.shippedOrderRevenue = function(orders) {
    return (Array.isArray(orders) ? orders : [])
        .filter(order => order && order.status === 'Shipped')
        .reduce((sum, order) => sum + (Number(order.netAmount) || 0), 0);
};

window.closeOrderActionsMenu = function() {
    document.querySelectorAll('[data-order-actions-menu]').forEach(menu => menu.classList.add('hidden'));
    document.querySelectorAll('[data-order-actions-button]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    window.openOrderActionsId = null;
};

window.toggleOrderActionsMenu = function(event, id) {
    event.stopPropagation();

    const menu = document.getElementById(`order-actions-menu-${id}`);
    const button = document.getElementById(`order-actions-button-${id}`);
    if (!menu || !button) return;

    const wasOpen = window.openOrderActionsId == id && !menu.classList.contains('hidden');
    window.closeOrderActionsMenu();
    if (wasOpen) return;

    menu.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
    window.openOrderActionsId = id;

    const firstAction = menu.querySelector('button');
    if (firstAction) firstAction.focus({ preventScroll: true });
};

document.addEventListener('click', () => window.closeOrderActionsMenu());
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || window.openOrderActionsId === null) return;
    const button = document.getElementById(`order-actions-button-${window.openOrderActionsId}`);
    window.closeOrderActionsMenu();
    if (button) button.focus({ preventScroll: true });
});

// ==========================================
// 2. FETCH & DATA MAPPING
// ==========================================
window.loadOrders = async function() {
    window.orderLoadError = null;
    try {
        const response = await window.adminAuth.fetch('/api/orders');
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const data = await response.json();

        window.orderData = (data || []).map(row => ({
            id: row.id,
            orderNumber: row.order_number,
            status: row.status || 'Processing',
            tracking: row.tracking ? escapeOrderText(row.tracking) : '',
            amount: row.amount,
            taxAmount: row.tax_amount,
            netAmount: row.net_amount,
            createdAt: formatOrderDate(row.created_at),
            customer: row.customer ? {
                id: row.customer.id,
                name: escapeOrderText(row.customer.full_name || 'Unknown'),
                email: escapeOrderText(row.customer.email || ''),
                phone: row.customer.phone_number ? escapeOrderText(String(row.customer.phone_number)) : ''
            } : null,
            items: (row.items || []).map(item => ({
                id: item.id,
                productName: escapeOrderText(item.product_name || 'Unknown product'),
                price: item.price,
                quantity: item.quantity,
                totalAmount: item.total_amount
            })),
            shipping: row.shipping ? {
                fullAddress: escapeOrderText(row.shipping.full_address || ''),
                city: escapeOrderText(row.shipping.city || ''),
                state: escapeOrderText(row.shipping.state || ''),
                country: escapeOrderText(row.shipping.country || ''),
                zipCode: escapeOrderText(row.shipping.zip_code || '')
            } : null,
            payment: row.payment ? {
                transactionId: escapeOrderText(row.payment.transaction_id || ''),
                method: escapeOrderText(row.payment.payment_method || ''),
                amount: row.payment.amount,
                status: escapeOrderText(row.payment.status || ''),
                createdAt: formatOrderDate(row.payment.created_at)
            } : null
        }));

        return true;
    } catch (error) {
        console.error('Error fetching orders:', error);
        window.orderLoadError = error.message || 'Failed to load orders.';
        return false;
    }
};

window.findOrder = function(id) {
    const searchId = typeof id === 'string' && !isNaN(id) ? parseInt(id, 10) : id;
    return window.orderData.find(o => o.id == searchId) || null;
};

// ==========================================
// 2.5 SMOOTH DOM UPDATERS (NO FULL RE-RENDER)
// ==========================================
window.refreshOrderStatsDOM = function() {
    const total = window.orderData.length;
    const revenue = window.shippedOrderRevenue(window.orderData);

    const setText = (elementId, value) => {
        const node = document.getElementById(elementId);
        if (node) node.innerText = value;
    };

    setText('stat-order-total', total);
    setText('stat-order-revenue', window.formatAmount ? window.formatAmount(revenue) : `₹ ${revenue}`);
};

window.updateOrderRowBadgeDOM = function(id, status) {
    const classes = ORDER_STATUS_CLASSES[status] || ORDER_STATUS_CLASSES['Processing'];

    const badge = document.getElementById(`order-badge-${id}`);
    if (badge) {
        badge.innerText = status;
        badge.className = `px-2.5 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider border transition-colors duration-500 ${classes.badge}`;
    }

    const drawerSelect = document.getElementById(`order-drawer-status-${id}`);
    if (drawerSelect) {
        drawerSelect.value = status;
        drawerSelect.className = `appearance-none border text-xs font-bold py-1.5 pl-3 pr-8 rounded-sm focus:outline-none cursor-pointer uppercase tracking-wider shadow-sm transition-colors duration-500 hover:brightness-95 ${classes.drawer}`;
    }

    window.orderStatusOptions(status).forEach(s => {
        const btn = document.getElementById(`order-menu-${s.toLowerCase().replace(/ /g, '-')}-${id}`);
        if (!btn) return;
        const baseClass = 'px-4 py-2.5 text-left text-xs font-bold hover:bg-gray-50 border-b border-[#12170f]/5 transition-colors duration-300';
        btn.className = baseClass + (s === status ? ` ${ORDER_STATUS_CLASSES[s].menu}` : ' text-[#12170f]');
    });
};

// ==========================================
// 3. STATE UPDATES (API CALLS)
// ==========================================
// tracking is optional — omitted entirely (not sent as '') when the caller
// doesn't have a value to set, so a row-menu "Mark as Delivered" click never
// clobbers a tracking number entered on an earlier Shipped update. Sending
// '' (from the drawer's clear-tracking case) is a deliberate write.
window.updateOrderStatus = async function(id, newStatus, tracking) {
    try {
        const body = { status: newStatus };
        if (tracking !== undefined) body.tracking = tracking;

        const response = await window.adminAuth.fetch(`/api/orders/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error('Update failed');

        const order = window.findOrder(id);
        if (order) {
            order.status = newStatus;
            if (tracking !== undefined) order.tracking = escapeOrderText(tracking);
        }

        window.updateOrderRowBadgeDOM(id, newStatus);
        window.refreshOrderStatsDOM();
    } catch (error) {
        console.error('Failed to update order:', error);
        alert('Failed to update order. Please try again.');
    }
};

window.saveOrderTracking = function(id) {
    const input = document.getElementById(`order-drawer-tracking-${id}`);
    const select = document.getElementById(`order-drawer-status-${id}`);
    if (!input || !select) return;
    window.updateOrderStatus(id, select.value, input.value.trim());
};

// ==========================================
// 4. UI RENDERING (Table View)
// ==========================================
window.renderOrders = async function() {
    const success = await window.loadOrders();
    window.renderOrdersView();
    return success;
};

window.renderOrdersView = function() {
    const data = window.orderData;
    const container = document.getElementById('main-content');
    if (!container) return;

    window.closeOrderActionsMenu();

    const total = data.length;
    const revenue = window.shippedOrderRevenue(data);

    const ui = window.adminDashboardUI;
    const statsHtml = `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 max-w-3xl">
            ${ui.stat('Total orders', total, 'Every order in the fulfilment pipeline', 'gold', 'orders', 'stat-order-total')}
            ${ui.stat('Shipped revenue', window.formatAmount ? window.formatAmount(revenue) : `₹ ${revenue}`, 'Revenue recognised once an order ships', 'green', 'revenue', 'stat-order-revenue')}
        </div>`;

    const tableHeaders = `
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[10%]">Order #</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[24%]">Customer</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[16%]">Date</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[10%]">Items</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[14%]">Amount</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[13%]">Status</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[13%] text-right">Actions</th>`;

    let rows;
    if (window.orderLoadError) {
        rows = `<tr><td colspan="7" class="py-10 text-center">
            <p class="text-red-600 font-bold text-sm px-6">${escapeOrderText(window.orderLoadError)}</p>
            <button onclick="window.renderOrders()" class="mt-3 text-xs font-bold text-[#d4af37] hover:underline">Retry</button>
        </td></tr>`;
    } else if (total === 0) {
        rows = `<tr><td colspan="7" class="text-center py-8 text-[#1f271b]/60 font-medium">No orders yet.</td></tr>`;
    } else {
        rows = data.map(o => {
            const classes = ORDER_STATUS_CLASSES[o.status] || ORDER_STATUS_CLASSES['Processing'];
            const statusBadge = `<span id="order-badge-${o.id}" class="px-2.5 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider border ${classes.badge} transition-colors duration-500">${o.status}</span>`;
            const isActiveRow = window.app && window.app.activeItemId == o.id;

            const menuItems = window.orderStatusOptions(o.status).map(s => `
                <button role="menuitem" id="order-menu-${s.toLowerCase().replace(/ /g, '-')}-${o.id}" onclick="event.stopPropagation(); window.closeOrderActionsMenu(); updateOrderStatus('${o.id}', '${s}')" class="block w-full px-4 py-2.5 text-left text-xs font-bold hover:bg-gray-50 border-b border-[#12170f]/5 transition-colors duration-300 ${s === o.status ? ORDER_STATUS_CLASSES[s].menu : 'text-[#12170f]'}">Mark as ${s}</button>`).join('');

            return `
            <tr id="order-row-${o.id}" class="transition-all duration-500 cursor-pointer ${isActiveRow ? 'bg-[#d4af37]/5 border-l-2 border-l-[#d4af37]' : 'hover:bg-gray-50/50 border-l-2 border-l-transparent'} group" onclick="window.handleOrderAction('${o.id}')">
                <td class="py-4 px-5 text-[#1f271b] group-hover:text-[#d4af37] font-bold transition-colors truncate">#${o.orderNumber}</td>
                <td class="py-4 px-5 overflow-hidden">
                    ${o.customer
                        ? `<p class="text-[#12170f] font-bold truncate">${o.customer.name}</p><p class="text-[10px] text-[#1f271b]/60 truncate">${o.customer.email}</p>`
                        : `<p class="text-[#1f271b]/40 italic text-xs">Guest</p>`}
                </td>
                <td class="py-4 px-5 text-[#1f271b]/70 text-xs truncate">${o.createdAt}</td>
                <td class="py-4 px-5 text-[#1f271b]/70 font-medium truncate">${o.items.length} item${o.items.length === 1 ? '' : 's'}</td>
                <td class="py-4 px-5 font-bold text-[#12170f] truncate">${window.formatAmount ? window.formatAmount(o.netAmount) : o.netAmount}</td>
                <td class="py-4 px-5 truncate">${statusBadge}</td>
                <td class="py-4 px-5 text-right relative overflow-visible">
                    <div class="inline-block text-left">
                        <button id="order-actions-button-${o.id}" data-order-actions-button type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="order-actions-menu-${o.id}" aria-label="Actions for order ${escapeOrderText(o.orderNumber)}" onclick="window.toggleOrderActionsMenu(event, '${o.id}')" class="text-[#1f271b]/40 hover:text-[#d4af37] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] p-1 rounded-sm transition-colors">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                        </button>
                        <div id="order-actions-menu-${o.id}" data-order-actions-menu role="menu" onclick="event.stopPropagation()" class="hidden absolute right-8 top-10 mt-1 w-44 bg-white border border-[#12170f]/10 rounded-sm shadow-md z-20 overflow-hidden flex-col text-left">
                            ${menuItems}
                        </div>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    container.innerHTML = `
        <div class="max-w-7xl mx-auto pb-10">
        ${ui.hero('Store operations', 'Orders', 'Track every purchase from payment through fulfilment and delivery.')}
        ${statsHtml}
        <section class="bg-white border border-[#12170f]/10 rounded-xl mb-6 shadow-[0_10px_35px_rgba(18,23,15,0.04)] overflow-hidden flex flex-col relative">
            <div class="px-5 py-5 border-b border-[#12170f]/10">
                <p class="text-[10px] uppercase tracking-[0.18em] font-bold text-[#d4af37]">Fulfilment queue</p>
                <h3 class="text-xl text-[#12170f] mt-1">All orders</h3>
            </div>
            <div class="overflow-x-auto overflow-y-auto flex-1 min-h-[420px] max-h-[calc(100vh-330px)] pb-16">
                <table class="w-[1000px] xl:w-full text-left border-collapse table-fixed">
                    <thead><tr class="text-[10px] text-[#12170f]/40 uppercase tracking-widest font-bold">${tableHeaders}</tr></thead>
                    <tbody id="orders-tbody" class="text-sm font-semibold divide-y divide-[#12170f]/5">${rows}</tbody>
                </table>
            </div>
        </section>
        </div>
    `;
};

// ==========================================
// 5. UI RENDERING (Drawer View)
// ==========================================
function orderSectionHeading(iconPath, label) {
    return `
        <div class="flex items-center gap-2 text-[#12170f]/40 font-bold text-xs tracking-wider uppercase mb-4">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}"></path></svg>
            ${label}
        </div>`;
}

function orderItemsHTML(order) {
    if (!order.items.length) {
        return `<p class="text-sm text-[#1f271b]/40 italic">This order has no line items on record.</p>`;
    }

    const rows = order.items.map(item => `
        <tr class="border-t border-[#12170f]/5">
            <td class="py-3 px-4 align-top">
                <p class="text-[#12170f] font-bold text-sm">${item.productName}</p>
                <p class="text-[10px] text-[#1f271b]/60 mt-0.5">${window.formatProductPrice ? window.formatProductPrice(item.price) : item.price} &times; ${item.quantity}</p>
            </td>
            <td class="py-3 px-4 align-top text-right text-xs font-bold text-[#1f271b]/70 whitespace-nowrap">${window.formatAmount ? window.formatAmount(item.totalAmount) : item.totalAmount}</td>
        </tr>`).join('');

    return `
        <div class="bg-white rounded-sm border border-[#12170f]/10 shadow-sm overflow-hidden">
            <table class="w-full border-collapse"><tbody>${rows}</tbody></table>
        </div>`;
}

window.handleOrderAction = function(id) {
    const searchId = typeof id === 'string' && !isNaN(id) ? parseInt(id, 10) : id;

    if (window.app) window.app.activeItemId = searchId;
    window.renderOrdersView();

    const o = window.findOrder(searchId);
    if (!o) return;

    const classes = ORDER_STATUS_CLASSES[o.status] || ORDER_STATUS_CLASSES['Processing'];

    const badgeHtml = `
        <div class="relative">
            <select autocomplete="srk-no-autofill" id="order-drawer-status-${o.id}" onchange="updateOrderStatus('${o.id}', this.value)" class="appearance-none border ${classes.drawer} text-xs font-bold py-1.5 pl-3 pr-8 rounded-sm focus:outline-none cursor-pointer uppercase tracking-wider shadow-sm transition-colors duration-500 hover:brightness-95">
                ${window.orderStatusOptions(o.status).map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
            <svg class="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </div>`;

    const ICON_USER = 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z';
    const ICON_PIN = 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z';
    const ICON_BOX = 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4';
    const ICON_CARD = 'M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z';
    const ICON_TRUCK = 'M3 3h13v13H3V3zm13 5h4l3 3v5h-7V8z';

    const html = `
        <div class="border-b border-[#12170f]/10 pb-6 mb-6">
            ${orderSectionHeading(ICON_USER, 'Customer')}
            <div class="grid grid-cols-[100px_1fr] gap-y-4 text-sm">
                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Name</div>
                <div class="text-[#12170f] font-bold text-base">${o.customer ? o.customer.name : '<span class="italic text-[#1f271b]/40">Guest</span>'}</div>

                ${o.customer && o.customer.email ? `
                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Email</div>
                <div class="text-[#12170f] font-bold"><a href="mailto:${o.customer.email}" class="hover:text-[#d4af37] transition-colors">${o.customer.email}</a></div>` : ''}

                ${o.customer && o.customer.phone ? `
                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Phone</div>
                <div class="text-[#12170f] font-bold"><a href="tel:${o.customer.phone}" class="hover:text-[#d4af37] transition-colors">${o.customer.phone}</a></div>` : ''}

                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Placed</div>
                <div class="text-[#1f271b]/80 font-bold text-xs">${o.createdAt}</div>
            </div>
        </div>

        <div class="border-b border-[#12170f]/10 pb-6 mb-6">
            ${orderSectionHeading(ICON_PIN, 'Shipping Address')}
            ${o.shipping
                ? `<div class="text-sm text-[#1f271b]/80 leading-relaxed font-semibold bg-white p-5 rounded-sm border border-[#12170f]/10 shadow-sm">${o.shipping.fullAddress}<br>${o.shipping.city}, ${o.shipping.state} - ${o.shipping.zipCode}<br>${o.shipping.country}</div>`
                : `<p class="text-sm text-[#1f271b]/40 italic">No shipping address on file for this order.</p>`}
        </div>

        <div class="border-b border-[#12170f]/10 pb-6 mb-6">
            ${orderSectionHeading(ICON_BOX, `Items (${o.items.length})`)}
            ${orderItemsHTML(o)}
        </div>

        <div class="border-b border-[#12170f]/10 pb-6 mb-6">
            ${orderSectionHeading(ICON_CARD, 'Payment')}
            ${o.status === 'Pending Payment' ? `
                <div class="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-sm p-4">
                    <svg class="w-5 h-5 shrink-0 mt-0.5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path></svg>
                    <div>
                        <p class="text-xs font-bold text-amber-900 uppercase tracking-wider">Nobody has paid for this order</p>
                        <p class="text-xs text-amber-900/80 font-semibold mt-1 leading-relaxed">
                            It is being held for the customer to pay and must not be fulfilled yet. It moves to Processing on its own the moment payment clears &mdash; you do not need to do it by hand.
                        </p>
                    </div>
                </div>` : ''}
            ${o.payment && o.payment.status === 'Paid' && o.status === 'Cancelled' ? `
                <div class="mb-4 flex items-start gap-3 bg-red-50 border border-red-300 rounded-sm p-4">
                    <svg class="w-5 h-5 shrink-0 mt-0.5 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path></svg>
                    <div>
                        <p class="text-xs font-bold text-red-900 uppercase tracking-wider">Cancelled, but paid for</p>
                        <p class="text-xs text-red-900/80 font-semibold mt-1 leading-relaxed">
                            Money was received against this order and it is marked Cancelled. Nothing in this dashboard refunds anything &mdash; a refund is an action in the Razorpay dashboard, and this site only records it when Razorpay reports it back. Check whether the customer is owed money.
                        </p>
                    </div>
                </div>` : ''}
            ${o.payment
                ? `<div class="bg-white p-5 rounded-sm border border-[#12170f]/10 shadow-sm space-y-2 text-sm">
                    <div class="flex justify-between"><span class="text-[#1f271b]/60 font-medium">Method</span><span class="font-bold text-[#12170f]">${o.payment.method || 'Unknown'}</span></div>
                    <div class="flex justify-between"><span class="text-[#1f271b]/60 font-medium">Transaction ID</span><span class="font-bold text-[#12170f] font-mono text-xs">${o.payment.transactionId || 'N/A'}</span></div>
                    <div class="flex justify-between"><span class="text-[#1f271b]/60 font-medium">Payment Status</span><span class="font-bold text-[#12170f]">${o.payment.status || 'Unknown'}</span></div>
                </div>`
                : `<p class="text-sm text-[#1f271b]/40 italic">No payment recorded for this order.</p>`}
        </div>

        <div class="border-b border-[#12170f]/10 pb-6 mb-6">
            ${orderSectionHeading(ICON_TRUCK, 'Tracking')}
            <div class="flex gap-2">
                <input autocomplete="srk-no-autofill" spellcheck="false" type="text" id="order-drawer-tracking-${o.id}" value="${o.tracking}" placeholder="Carrier tracking / AWB number" class="flex-1 bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37]">
                <button onclick="window.saveOrderTracking('${o.id}')" class="bg-[#12170f] text-white font-bold text-sm px-4 rounded-sm hover:bg-[#1f271b] transition-colors">Save</button>
            </div>
        </div>

        <div class="bg-[#f8fafc] border border-[#12170f]/10 p-5 rounded-sm">
            <div class="flex justify-between items-center mb-2 text-sm">
                <span class="text-[#1f271b]/60 font-medium">Subtotal</span><span class="font-bold text-[#12170f]">${window.formatAmount ? window.formatAmount(o.amount) : o.amount}</span>
            </div>
            <div class="flex justify-between items-center mb-4 text-sm">
                <span class="text-[#1f271b]/60 font-medium">Tax</span><span class="font-bold text-[#12170f]">${window.formatAmount ? window.formatAmount(o.taxAmount) : o.taxAmount}</span>
            </div>
            <div class="flex justify-between items-center pt-3 border-t border-[#12170f]/10">
                <span class="text-[#12170f] font-bold text-base">Total</span><span class="font-bold text-[#d4af37] text-lg">${window.formatAmount ? window.formatAmount(o.netAmount) : o.netAmount}</span>
            </div>
        </div>
    `;

    if (window.app && window.app.openDrawer) {
        window.app.openDrawer(html, `Order #${o.orderNumber}`, badgeHtml);
    }
};
