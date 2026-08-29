/**
 * quotations.js — the dashboard's Quotations tab
 *
 * A quote request is not an enquiry. The store's Request a Quote overlay asks
 * for a business name, a contact person, a delivery address and a repeating list
 * of category → product pairs; the technical support form asks for a name and a
 * problem. They used to share the `enquiries` table, which meant the address and
 * every requested product were flattened into one free-text column and this tab
 * could only print the blob back out under a heading that said "Issue".
 *
 * They now have their own tables (backend/migrations/009_quote_requests.sql) and
 * their own routes, so this tab renders the fields that actually exist:
 *
 *     Quote ID | Business | Contact | Products Requested | Status | Received
 *
 * "Products Requested" is the column that replaces "Issue", and it is the whole
 * point of the split — the row can say what was asked for because the answer is
 * data now, not prose.
 *
 * DELIBERATELY NOT REALTIME
 * -------------------------
 * enquiries.js subscribes to its table directly from the browser with the anon
 * key. Supabase filters realtime delivery through RLS, so doing the same here
 * would mean granting anon SELECT on `quote_requests` — publishing every
 * customer's name, email, phone and business address to anyone who opens
 * devtools. `quote_requests` is closed instead (RLS on, no policies; only the
 * service role reaches it), and this tab refetches every time it is opened. The
 * opt-in, if that trade is ever worth making, is commented at the bottom of
 * section 6 of the migration.
 *
 * CONVENTIONS
 * -----------
 * Root-level admin tab file, same shape as products.js / categories.js: a
 * `window.<noun>Data` array plus a `window.render<Noun>()` that stringifies HTML
 * into #main-content. Every visual token — the stat cards, the sticky table
 * head, the status badge colours, the hover row menu, the drawer grid — is
 * lifted from enquiries.js so the two Enquiries tabs read as one product.
 *
 * LOAD ORDER
 * ----------
 * After enquiries.js, because enquiries.js used to define window.renderQuotations
 * itself; loading later makes this file the unambiguous owner. After
 * price-format-module.js, for formatProductPrice. Admin identity comes from
 * window.adminAuth.fetch (admin-auth-module.js), not from enquiries.js.
 */

// ==========================================
// 0. UTILS
// ==========================================
const escapeQuoteHTML = (str) => {
    if (str === null || str === undefined) return '';
    return str.toString().replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
};

// The server sends `reference` on every row; this is the fallback for a response
// that somehow arrives without it, and keeps the format in one readable place.
// Same shape the customer saw on the confirmation screen — PI-<year>-<id>
// (proforma invoice, not "QT-") — so the number they quote back is the row
// found here. server.js's quoteReference() carries the same prefix.
const quoteReference = (row) => {
    if (row.reference) return row.reference;
    const year = row.created_at ? new Date(row.created_at).getFullYear() : new Date().getFullYear();
    return `PI-${year}-${String(row.id).padStart(4, '0')}`;
};

// ==========================================
// 1. STATE
// ==========================================
window.quotationData = [];

// ==========================================
// 2. FETCH & DATA MAPPING
// ==========================================
// Everything user-submitted is escaped once, here, so no render path has to
// remember to — the same discipline enquiries.js applies to its own mapping.
window.loadQuotations = async function() {
    try {
        const response = await window.adminAuth.fetch('/api/quote-requests?limit=250');

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const data = await response.json();

        window.quotationData = (data || []).map(row => ({
            id: row.id,
            reference: escapeQuoteHTML(quoteReference(row)),
            business: escapeQuoteHTML(row.business_name || 'Unknown'),
            contact: escapeQuoteHTML(row.contact_name || 'N/A'),
            email: escapeQuoteHTML(row.email || 'N/A'),
            phone: escapeQuoteHTML(row.phone || 'N/A'),
            address: escapeQuoteHTML(row.business_address || ''),
            notes: escapeQuoteHTML(row.notes || ''),
            status: row.status || 'Open',
            items: (row.quote_request_items || []).map(item => ({
                position: item.position,
                category: escapeQuoteHTML(item.category_name || 'Uncategorised'),
                product: escapeQuoteHTML(item.product_name || 'Unknown product'),
                quantity: Number.isInteger(Number(item.quantity)) ? Number(item.quantity) : 1,
                // Formatted through the same module the storefront and the
                // Products tab use, so a price never reads two ways in one app.
                // A quote item with no price is normal — most rows in this
                // catalogue are "on request".
                price: item.product_price === null || item.product_price === undefined
                    ? ''
                    : escapeQuoteHTML(window.formatProductPrice ? window.formatProductPrice(item.product_price) : item.product_price)
            })),
            updated: row.created_at ? new Date(row.created_at).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            }) : 'Unknown Date'
        }));

        return true;
    } catch (error) {
        console.error('Error fetching quote requests:', error);
        const container = document.getElementById('main-content');
        if (container) {
            container.innerHTML = `
                <div class="p-6 bg-red-50 text-red-700 rounded-sm border border-red-200 shadow-sm mt-4">
                    <h3 class="font-bold text-lg mb-1">Could not load quotations</h3>
                    <p class="text-sm">${escapeQuoteHTML(error.message)}</p>
                </div>`;
        }
        return false;
    }
};

window.findQuotation = function(id) {
    return window.quotationData.find(q => q.id == id) || null;
};

// ==========================================
// 2.5 SMOOTH DOM UPDATERS (NO FULL RE-RENDER)
// ==========================================
window.refreshQuoteStatsDOM = function() {
    const data = window.quotationData;
    const set = (elementId, value) => {
        const node = document.getElementById(elementId);
        if (node) node.innerText = value;
    };

    set('stat-quote-open', data.filter(q => q.status === 'Open').length);
    set('stat-quote-progress', data.filter(q => q.status === 'In Progress').length);
    set('stat-quote-resolved', data.filter(q => q.status === 'Resolved').length);
};

window.updateQuoteRowBadgeDOM = function(id, status) {
    const badge = document.getElementById(`quote-badge-${id}`);
    if (badge) {
        badge.innerText = status;
        badge.className = `px-2.5 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider border transition-colors duration-500 ` +
            (status === 'Open' ? 'text-yellow-600 border-yellow-500 bg-yellow-50/30' :
             status === 'In Progress' ? 'text-blue-600 border-blue-500 bg-blue-50/30' :
             'text-green-600 border-green-500 bg-green-50/30');
    }

    const drawerSelect = document.getElementById(`quote-drawer-status-${id}`);
    if (drawerSelect) {
        drawerSelect.value = status;
        drawerSelect.className = `appearance-none border text-xs font-bold py-1.5 pl-3 pr-8 rounded-sm focus:outline-none cursor-pointer uppercase tracking-wider shadow-sm transition-colors duration-500 hover:brightness-95 ` +
            (status === 'Open' ? 'text-yellow-700 border-yellow-500 bg-yellow-50' :
             status === 'In Progress' ? 'text-blue-700 border-blue-500 bg-blue-50' :
             'text-green-700 border-green-500 bg-green-50');
    }

    const btnOpen = document.getElementById(`quote-menu-open-${id}`);
    const btnProgress = document.getElementById(`quote-menu-progress-${id}`);
    const btnResolved = document.getElementById(`quote-menu-resolved-${id}`);
    const baseClass = 'px-4 py-2.5 text-left text-xs font-bold hover:bg-gray-50 border-b border-[#12170f]/5 transition-colors duration-300';

    if (btnOpen) btnOpen.className = baseClass + (status === 'Open' ? ' text-yellow-600 bg-yellow-50/50' : ' text-[#12170f]');
    if (btnProgress) btnProgress.className = baseClass + (status === 'In Progress' ? ' text-blue-600 bg-blue-50/50' : ' text-[#12170f]');
    if (btnResolved) btnResolved.className = baseClass + (status === 'Resolved' ? ' text-green-600 bg-green-50/50' : ' text-[#12170f]');
};

window.removeQuoteRowDOM = function(id) {
    const row = document.getElementById(`quote-row-${id}`);
    if (!row) return;

    row.classList.add('opacity-0', 'bg-red-50/50');
    setTimeout(() => {
        row.remove();
        const tbody = document.getElementById('quotations-tbody');
        if (tbody && tbody.children.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-[#1f271b]/60 font-medium transition-opacity duration-500">No quote requests yet.</td></tr>`;
        }
    }, 400);
};

// ==========================================
// 3. STATE UPDATES (API CALLS)
// ==========================================
window.updateQuotationStatus = async function(id, newStatus) {
    try {
        const response = await window.adminAuth.fetch(`/api/quote-requests/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });

        if (!response.ok) return;

        const quote = window.findQuotation(id);
        if (quote) quote.status = newStatus;

        window.updateQuoteRowBadgeDOM(id, newStatus);
        window.refreshQuoteStatsDOM();
    } catch (error) {
        console.error('Failed to update quote status:', error);
    }
};

window.deleteQuotation = async function(id) {
    if (!confirm('Delete this quote request entirely? The products it asked for go with it.')) return;

    try {
        const response = await window.adminAuth.fetch(`/api/quote-requests/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) return;

        const index = window.quotationData.findIndex(q => q.id == id);
        if (index > -1) window.quotationData.splice(index, 1);

        window.removeQuoteRowDOM(id);
        window.refreshQuoteStatsDOM();
        if (window.app && window.app.activeItemId == id) window.app.closeDrawer();
    } catch (error) {
        console.error('Failed to delete quote request:', error);
    }
};

// ==========================================
// 4. UI RENDERING (Table View)
// ==========================================
// Refetches every time, because this table has no realtime subscription to keep
// it honest — see the header.
window.renderQuotations = async function() {
    const success = await window.loadQuotations();
    if (success) window.renderQuotationsView();
};

// The cell under "Products Requested". One product is the common case — the
// overlay files one product per request — so the first one is named in full and
// anything beyond it is counted rather than truncated into unreadability.
function quoteProductsCell(quote) {
    if (!quote.items.length) {
        return `<p class="text-[#1f271b]/40 italic text-xs">No products listed</p>`;
    }

    const first = quote.items[0];
    const extra = quote.items.length - 1;

    return `
        <p class="text-[#12170f] font-bold truncate">${first.product}</p>
        <p class="text-[10px] text-[#1f271b]/60 uppercase truncate">${first.category}${extra > 0 ? ` · +${extra} more` : ''}</p>`;
}

window.renderQuotationsView = function() {
    const data = window.quotationData;
    const container = document.getElementById('main-content');
    if (!container) return;

    const open = data.filter(q => q.status === 'Open').length;
    const progress = data.filter(q => q.status === 'In Progress').length;
    const resolved = data.filter(q => q.status === 'Resolved').length;

    const ui = window.adminDashboardUI;
    const statsHtml = `
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            ${ui.stat('Open quotes', open, 'Awaiting review', 'gold', 'quote', 'stat-quote-open')}
            ${ui.stat('In progress', progress, 'Actively being prepared', 'blue', 'clock', 'stat-quote-progress')}
            ${ui.stat('Resolved', resolved, 'Completed quote requests', 'green', 'check', 'stat-quote-resolved')}
        </div>`;

    // Widths sum to 100 and the table is table-fixed, same as Technical Support.
    // The columns differ because the data does: no "Issue", because a quote does
    // not carry one; "Products Requested" instead, because it carries that.
    const tableHeaders = `
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[13%]">Quote ID</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[19%]">Business</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[18%]">Contact</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[23%]">Products Requested</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[11%]">Status</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[11%]">Received</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[5%] text-right">Actions</th>`;

    const rows = data.length === 0
        ? `<tr><td colspan="7" class="text-center py-8 text-[#1f271b]/60 font-medium">No quote requests yet.</td></tr>`
        : data.map(q => {
            const sColor = q.status === 'Open' ? 'text-yellow-600 border-yellow-500 bg-yellow-50/30' :
                           q.status === 'In Progress' ? 'text-blue-600 border-blue-500 bg-blue-50/30' :
                           'text-green-600 border-green-500 bg-green-50/30';

            const statusBadge = `<span id="quote-badge-${q.id}" class="px-2.5 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider border ${sColor} transition-colors duration-500">${q.status}</span>`;

            const actionContent = `
                <td class="py-4 px-5 text-right relative overflow-visible">
                    <div class="inline-block text-left group/menu cursor-pointer">
                        <button onclick="event.stopPropagation();" class="text-[#1f271b]/40 hover:text-[#d4af37] focus:outline-none p-1 rounded-sm transition-colors">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                        </button>
                        <div class="absolute right-8 top-10 mt-1 w-44 bg-white border border-[#12170f]/10 rounded-sm shadow-md opacity-0 invisible group-hover/menu:opacity-100 group-hover/menu:visible transition-all z-20 overflow-hidden flex flex-col text-left">
                            <button id="quote-menu-open-${q.id}" onclick="event.stopPropagation(); updateQuotationStatus('${q.id}', 'Open')" class="px-4 py-2.5 text-left text-xs font-bold hover:bg-gray-50 border-b border-[#12170f]/5 transition-colors duration-300 ${q.status === 'Open' ? 'text-yellow-600 bg-yellow-50/50' : 'text-[#12170f]'}">Mark as Open</button>
                            <button id="quote-menu-progress-${q.id}" onclick="event.stopPropagation(); updateQuotationStatus('${q.id}', 'In Progress')" class="px-4 py-2.5 text-left text-xs font-bold hover:bg-gray-50 border-b border-[#12170f]/5 transition-colors duration-300 ${q.status === 'In Progress' ? 'text-blue-600 bg-blue-50/50' : 'text-[#12170f]'}">Mark as In Progress</button>
                            <button id="quote-menu-resolved-${q.id}" onclick="event.stopPropagation(); updateQuotationStatus('${q.id}', 'Resolved')" class="px-4 py-2.5 text-left text-xs font-bold hover:bg-gray-50 border-b border-[#12170f]/5 transition-colors duration-300 ${q.status === 'Resolved' ? 'text-green-600 bg-green-50/50' : 'text-[#12170f]'}">Mark as Resolved</button>
                            <button onclick="event.stopPropagation(); deleteQuotation('${q.id}')" class="px-4 py-2.5 text-left text-xs font-bold text-red-600 hover:bg-red-50 transition-colors">Delete Request</button>
                        </div>
                    </div>
                </td>`;

            const isActiveRow = window.app && window.app.activeItemId === q.id;

            return `
            <tr id="quote-row-${q.id}" class="transition-all duration-500 cursor-pointer ${isActiveRow ? 'bg-[#d4af37]/5 border-l-2 border-l-[#d4af37]' : 'hover:bg-gray-50/50 border-l-2 border-l-transparent'} group" onclick="window.handleQuotationAction('${q.id}')">
                <td class="py-4 px-5 text-[#1f271b] group-hover:text-[#d4af37] font-bold transition-colors truncate">${q.reference}</td>
                <td class="py-4 px-5 overflow-hidden">
                    <p class="text-[#12170f] font-bold truncate">${q.business}</p>
                    <p class="text-[10px] text-[#1f271b]/60 uppercase truncate">${q.contact}</p>
                </td>
                <td class="py-4 px-5 overflow-hidden">
                    <p class="text-[#12170f] text-xs truncate">${q.email}</p>
                    <p class="text-[10px] text-[#1f271b]/60 font-medium truncate">${q.phone}</p>
                </td>
                <td class="py-4 px-5 overflow-hidden">${quoteProductsCell(q)}</td>
                <td class="py-4 px-5 truncate">${statusBadge}</td>
                <td class="py-4 px-5 text-[#1f271b]/70 text-xs truncate">${q.updated}</td>
                ${actionContent}
            </tr>`;
        }).join('');

    container.innerHTML = `
        <div class="max-w-7xl mx-auto pb-10">
        ${ui.hero('Sales enquiries', 'Quotations', 'Turn product requests into clear, trackable commercial conversations.')}
        ${statsHtml}
        <section class="bg-white border border-[#12170f]/10 rounded-xl mb-6 shadow-[0_10px_35px_rgba(18,23,15,0.04)] overflow-hidden flex flex-col relative">
            <div class="px-5 py-5 border-b border-[#12170f]/10">
                <p class="text-[10px] uppercase tracking-[0.18em] font-bold text-[#d4af37]">Commercial pipeline</p>
                <h3 class="text-xl text-[#12170f] mt-1">Quote requests</h3>
            </div>
            <!-- The table gets a fixed viewport rather than sizing to its rows.
                 min-h holds a consistent height so one quote and twenty do not
                 produce two differently shaped pages, and so the box never
                 collapses to a header and a single line. max-h caps it against
                 the window, so a long list scrolls inside the table with the
                 stat cards still on screen instead of pushing them away.

                 min-h also cures a scrollbar that had nothing to scroll: the
                 horizontal bar below eats ~15px of height, which used to be
                 enough to push the header, one row and pb-16 past the box and
                 raise a vertical bar for a single result. pb-16 stays - it is
                 what keeps the last row's hover menu from being clipped.

                 Kept identical in enquiries.js; the two Enquiries tabs are
                 meant to read as one product. -->
            <div class="overflow-x-auto overflow-y-auto flex-1 min-h-[420px] max-h-[calc(100vh-330px)] pb-16">
                <table class="w-[1000px] xl:w-full text-left border-collapse table-fixed">
                    <thead><tr class="text-[10px] text-[#12170f]/40 uppercase tracking-widest font-bold">${tableHeaders}</tr></thead>
                    <tbody id="quotations-tbody" class="text-sm font-semibold divide-y divide-[#12170f]/5">${rows}</tbody>
                </table>
            </div>
        </section>
        </div>
    `;
};

// ==========================================
// 5. UI RENDERING (Drawer/Modal View)
// ==========================================
// The itemised list is a table rather than the prose block the enquiry drawer
// shows, because the items ARE a table now — numbered the way the customer
// numbered them in the overlay ("Product Request #1"), so a phone call about
// "the second one" lands on the same row for both people.
function quoteItemsHTML(quote) {
    if (!quote.items.length) {
        return `<p class="text-sm text-[#1f271b]/40 italic">This request listed no products.</p>`;
    }

    const rows = quote.items.map(item => `
        <tr class="border-t border-[#12170f]/5">
            <td class="py-3 px-4 text-[10px] font-bold text-[#1f271b]/40 align-top w-[8%]">#${item.position}</td>
            <td class="py-3 px-4 align-top">
                <p class="text-[#12170f] font-bold text-sm">${item.product}</p>
                <p class="text-[10px] text-[#1f271b]/60 uppercase tracking-wider mt-0.5">${item.category}</p>
            </td>
            <td class="py-3 px-4 align-top text-right text-xs font-bold text-[#1f271b]/70 whitespace-nowrap">Qty ${item.quantity}</td>
            <td class="py-3 px-4 align-top text-right text-xs font-bold text-[#1f271b]/70 whitespace-nowrap">${item.price || '<span class="text-[#1f271b]/40 font-medium italic">On request</span>'}</td>
        </tr>`).join('');

    return `
        <div class="bg-white rounded-sm border border-[#12170f]/10 shadow-sm overflow-hidden">
            <table class="w-full border-collapse">
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function quoteSectionHeading(iconPath, label) {
    return `
        <div class="flex items-center gap-2 text-[#12170f]/40 font-bold text-xs tracking-wider uppercase mb-4">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}"></path></svg>
            ${label}
        </div>`;
}

window.handleQuotationAction = function(id) {
    const searchId = typeof id === 'string' && !isNaN(id) ? parseInt(id, 10) : id;

    if (window.app) window.app.activeItemId = searchId;
    window.renderQuotationsView();

    const q = window.findQuotation(searchId);
    if (!q) return;

    const statusClass = q.status === 'Open' ? 'text-yellow-700 border-yellow-500 bg-yellow-50' :
                        q.status === 'In Progress' ? 'text-blue-700 border-blue-500 bg-blue-50' :
                        'text-green-700 border-green-500 bg-green-50';

    const badgeHtml = `
        <div class="relative">
            <select autocomplete="srk-no-autofill" id="quote-drawer-status-${q.id}" onchange="updateQuotationStatus('${q.id}', this.value)" class="appearance-none border ${statusClass} text-xs font-bold py-1.5 pl-3 pr-8 rounded-sm focus:outline-none cursor-pointer uppercase tracking-wider shadow-sm transition-colors duration-500 hover:brightness-95">
                <option value="Open" ${q.status === 'Open' ? 'selected' : ''}>Open</option>
                <option value="In Progress" ${q.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                <option value="Resolved" ${q.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
            </select>
            <svg class="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </div>`;

    const ICON_BUILDING = 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4';
    const ICON_PIN = 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z';
    const ICON_LIST = 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4';
    const ICON_NOTE = 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';

    const html = `
        <div class="border-b border-[#12170f]/10 pb-6 mb-6">
            ${quoteSectionHeading(ICON_BUILDING, 'Business Information')}
            <div class="grid grid-cols-[100px_1fr] gap-y-4 text-sm">
                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Business</div>
                <div class="text-[#12170f] font-bold text-base">${q.business}</div>

                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Contact</div>
                <div class="text-[#12170f] font-bold">${q.contact}</div>

                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Email</div>
                <div class="text-[#12170f] font-bold">
                    <a href="mailto:${q.email}" class="hover:text-[#d4af37] transition-colors flex items-center gap-2">
                        ${q.email}
                        <svg class="w-3.5 h-3.5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                    </a>
                </div>

                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Phone</div>
                <div class="text-[#12170f] font-bold">
                    <a href="tel:${q.phone}" class="hover:text-[#d4af37] transition-colors">${q.phone}</a>
                </div>

                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Received</div>
                <div class="text-[#1f271b]/80 font-bold text-xs">${q.updated}</div>
            </div>
        </div>

        <div class="border-b border-[#12170f]/10 pb-6 mb-6">
            ${quoteSectionHeading(ICON_PIN, 'Business Address')}
            <div class="text-sm text-[#1f271b]/80 leading-relaxed font-semibold bg-white p-5 rounded-sm border border-[#12170f]/10 shadow-sm whitespace-pre-wrap">${q.address}</div>
        </div>

        <div class="${q.notes ? 'border-b border-[#12170f]/10 pb-6 mb-6' : 'pb-6 mb-6'}">
            ${quoteSectionHeading(ICON_LIST, `Products Requested (${q.items.length})`)}
            ${quoteItemsHTML(q)}
        </div>

        ${q.notes ? `
        <div class="pb-6 mb-6">
            ${quoteSectionHeading(ICON_NOTE, 'Additional Details')}
            <div class="text-sm text-[#1f271b]/80 leading-relaxed font-semibold bg-white p-5 rounded-sm border border-[#12170f]/10 shadow-sm whitespace-pre-wrap">${q.notes}</div>
        </div>` : ''}
    `;

    if (window.app && window.app.openDrawer) {
        window.app.openDrawer(html, `Quote ${q.reference}`, badgeHtml);
    }
};
