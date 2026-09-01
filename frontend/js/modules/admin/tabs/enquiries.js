// ==========================================
// 0. SECURITY & UTILS
// ==========================================
// Admin identity now lives in the session cookie admin-auth-module.js manages
// (an admin signs in on the storefront and is recognised by role — see
// requireAdmin in server.js) — every admin-authenticated call below
// goes through window.adminAuth.fetch instead of carrying a key of its own.

// XSS Prevention: Neutralizes malicious HTML tags in user-submitted data
const escapeHTML = (str) => {
    if (!str) return '';
    return str.toString().replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
};

// ==========================================
// 1. STATE INITIALIZATION & REALTIME SUPABASE
// ==========================================
// Technical Support only. Quote requests used to arrive in this same table as an
// enquiry with form type 'quote' and were split out here into a `quotations`
// array; they now have their own tables, their own routes and their own module
// (quotations.js), so this file has one list again.
window.enquiryData = {
    technical: []
};

// LIVE UPDATES, WITHOUT PUBLISHING THE TABLE
//
// This used to hold the Supabase project URL and the anon key, and subscribe
// to `public:enquiries` over Realtime straight from the browser. That worked,
// and it cost more than it looked: Supabase delivers Realtime *through* RLS,
// so the subscription only received anything because `enquiries` carried a
// policy granting the anon role SELECT — and the anon key is published, right
// here, in a file the static middleware serves at /enquiries.js.
//
// The consequence was checked against the live database during the audit:
// anyone could read every row of the contact form — name, business, email,
// phone and the full message — with one curl and no login. Writes were
// already blocked, so it was disclosure only.
//
// 009_quote_requests.sql had already refused this exact trade for
// quote_requests, in as many words. 013_close_enquiries_to_anon.sql applies
// the same conclusion here and shuts the table; this is the client half of
// that change, and the two must ship together or this tab stops updating.
//
// What replaces it: polling GET /api/enquiries through
// fetch, which is session-authenticated and reaches the
// table with the service role. Slower than a socket by up to POLL_MS, which
// is the right trade for a support inbox — and it costs nothing while nobody
// is looking, because the tick does no work unless this tab is the one on
// screen and the window is actually visible.
const ENQUIRY_POLL_MS = 20000;

// A cheap fingerprint of the list, so an unchanged poll does not repaint the
// table under an admin who is reading it (and does not blow away the row
// their pointer is on). Covers the three things the old subscription
// listened for: a row appearing, a status changing, a row going away.
function enquirySignature() {
    const list = (window.enquiryData && window.enquiryData.technical) || [];
    return list.length + ':' + list.map(t => t.id + '/' + t.status).join(',');
}

let lastEnquirySignature = null;

async function pollEnquiries() {
    // Nothing to do unless this tab is showing and the window is in front.
    // A backgrounded dashboard polling every 20s all afternoon is just noise
    // in the log and load on the database.
    if (!window.app || window.app.currentTab !== 'technical') return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!window.adminAuth || !window.adminAuth.isAuthenticated) return;

    try {
        const before = lastEnquirySignature === null ? enquirySignature() : lastEnquirySignature;
        await window.loadEnquiries(true);
        const after = enquirySignature();

        lastEnquirySignature = after;
        if (after !== before) window.renderEnquiryView('technical');
    } catch (error) {
        // A failed poll is not worth a visible error: the tab already shows
        // whatever last loaded, and the next tick will try again. A destroyed
        // session is handled by adminAuth.fetch, which paints the dashboard's
        // own sign-in form on a 401. That form survives this timer: showSignIn()
        // is a no-op once it is already on screen, so a poll firing every 20s
        // against a dead session cannot wipe what is being typed into it.
        console.warn('Enquiry poll failed; will retry.', error);
    }
}

if (typeof window !== 'undefined') {
    window.setInterval(pollEnquiries, ENQUIRY_POLL_MS);

    // Coming back to the tab should feel immediate rather than up to 20s
    // stale, so check once on return instead of waiting for the next tick.
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') pollEnquiries();
        });
    }
}

// ==========================================
// 2. FETCH & DATA MAPPING
// ==========================================
window.loadEnquiries = async function(forceRefresh = false) {
    if (!forceRefresh && window.enquiryData.technical.length > 0) {
        return true;
    }

    try {
        const response = await window.adminAuth.fetch('/api/enquiries?limit=250');
        
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const data = await response.json();
        
        window.enquiryData.technical = [];

        data.forEach(item => {
            const mappedItem = {
                id: item.id,
                shortId: item.id ? String(item.id).substring(0, 8).toUpperCase() : 'UNKNOWN',
                customer: escapeHTML(item.enquirer_name || 'Unknown'),
                company: escapeHTML(item.enquirer_business_name || 'N/A'),
                phone: escapeHTML(item.enquirer_phone_number || 'N/A'),
                email: escapeHTML(item.enquirer_email || 'N/A'),
                issue: escapeHTML(item.enquirer_text_message || ''),
                status: item.status || 'Open',
                rawCreatedAt: item.created_at,
                updated: item.created_at ? new Date(item.created_at).toLocaleString('en-IN', { 
                    day: '2-digit', month: 'short', year: 'numeric', 
                    hour: '2-digit', minute: '2-digit' 
                }) : 'Unknown Date'
            };

            window.enquiryData.technical.push(mappedItem);
        });
        
        return true; 

    } catch (error) {
        console.error('Error fetching enquiries:', error);
        const container = document.getElementById('main-content');
        if(container) {
            container.innerHTML = `
                <div class="p-6 bg-red-50 text-red-700 rounded-sm border border-red-200 shadow-sm mt-4">
                    <h3 class="font-bold text-lg mb-1">Frontend Rendering Error</h3>
                    <p class="text-sm">Could not load data into the table. Error: ${error.message}</p>
                </div>`;
        }
        return false; 
    }
};

// ==========================================
// 2.5 SMOOTH DOM UPDATERS (NO FULL RE-RENDER)
// ==========================================
window.refreshStatsDOM = function(type) {
    const data = window.enquiryData[type];
    if (!data) return;

    const open = data.filter(t => t.status === 'Open').length;
    const progress = data.filter(t => t.status === 'In Progress').length;
    const resolved = data.filter(t => t.status === 'Resolved').length;
    if(document.getElementById('stat-tech-open')) document.getElementById('stat-tech-open').innerText = open;
    if(document.getElementById('stat-tech-progress')) document.getElementById('stat-tech-progress').innerText = progress;
    if(document.getElementById('stat-tech-resolved')) document.getElementById('stat-tech-resolved').innerText = resolved;
};

window.updateRowBadgeDOM = function(id, status) {
    // 1. Smoothly transition the table row badge
    const badge = document.getElementById(`badge-${id}`);
    if (badge) {
        badge.innerText = status;
        badge.className = `px-2.5 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider border transition-colors duration-500 ` + 
            (status === 'Open' ? 'text-yellow-600 border-yellow-500 bg-yellow-50/30' : 
             status === 'In Progress' ? 'text-blue-600 border-blue-500 bg-blue-50/30' : 
             'text-green-600 border-green-500 bg-green-50/30');
    }
    
    // 2. Smoothly transition the Drawer Dropdown menu
    const drawerSelect = document.getElementById(`drawer-status-${id}`);
    if (drawerSelect) {
        drawerSelect.value = status;
        drawerSelect.className = `appearance-none border text-xs font-bold py-1.5 pl-3 pr-8 rounded-sm focus:outline-none cursor-pointer uppercase tracking-wider shadow-sm transition-colors duration-500 hover:brightness-95 ` +
            (status === 'Open' ? 'text-yellow-700 border-yellow-500 bg-yellow-50' : 
             status === 'In Progress' ? 'text-blue-700 border-blue-500 bg-blue-50' : 
             'text-green-700 border-green-500 bg-green-50');
    }

    // 3. Smoothly update active states in the 3-dot row dropdown (REAL-TIME FIX)
    const btnOpen = document.getElementById(`menu-btn-open-${id}`);
    const btnProgress = document.getElementById(`menu-btn-progress-${id}`);
    const btnResolved = document.getElementById(`menu-btn-resolved-${id}`);
    const baseClass = 'px-4 py-2.5 text-left text-xs font-bold hover:bg-gray-50 border-b border-[#12170f]/5 transition-colors duration-300';

    if (btnOpen) btnOpen.className = baseClass + (status === 'Open' ? ' text-yellow-600 bg-yellow-50/50' : ' text-[#12170f]');
    if (btnProgress) btnProgress.className = baseClass + (status === 'In Progress' ? ' text-blue-600 bg-blue-50/50' : ' text-[#12170f]');
    if (btnResolved) btnResolved.className = baseClass + (status === 'Resolved' ? ' text-green-600 bg-green-50/50' : ' text-[#12170f]');
};

window.removeRowDOM = function(id) {
    const row = document.getElementById(`row-${id}`);
    if (row) {
        row.classList.add('opacity-0', 'bg-red-50/50'); 
        setTimeout(() => { 
            row.remove();
            const tbody = document.getElementById('enquiries-tbody');
            if(tbody && tbody.children.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-[#1f271b]/60 font-medium transition-opacity duration-500">No records found.</td></tr>`;
            }
        }, 400); 
    }
};

// ==========================================
// 3. SEAMLESS STATE UPDATES (API CALLS)
// ==========================================
window.updateTicketStatus = async function(id, newStatus) {
    try {
        const response = await window.adminAuth.fetch(`/api/enquiries/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        
        if (response.ok) {
            const index = window.enquiryData.technical.findIndex(t => t.id == id);
            if (index > -1) window.enquiryData.technical[index].status = newStatus;

            window.updateRowBadgeDOM(id, newStatus);
            window.refreshStatsDOM('technical');
        }
    } catch (error) {
        console.error("Failed to update status:", error);
    }
};

window.deleteTicket = async function(id) {
    if (!confirm("Are you sure you want to delete this ticket entirely?")) return;
    try {
        const response = await window.adminAuth.fetch(`/api/enquiries/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            const index = window.enquiryData.technical.findIndex(t => t.id == id);
            if (index > -1) window.enquiryData.technical.splice(index, 1);

            window.removeRowDOM(id);
            window.refreshStatsDOM('technical');
            if (window.app && window.app.activeItemId == id) window.app.closeDrawer();
        }
    } catch (error) {
        console.error("Failed to delete ticket:", error);
    }
};

// ==========================================
// 4. UI RENDERING (Table View)
// ==========================================
window.renderTechnical = async function() {
    const success = await window.loadEnquiries();
    if (success) window.renderEnquiryView('technical');
};

// `type` is always 'technical' now — the parameter stays because window.app's
// closeDrawer and the realtime handlers still pass it, and because a stray
// 'quotations' must not silently render an empty enquiry table over the
// quotations one. quotations.js owns that tab.
window.renderEnquiryView = function(type) {
    if (type !== 'technical') return;

    const data = window.enquiryData.technical;
    const container = document.getElementById('main-content');
    if (!container) return;

    const open = data.filter(t => t.status === 'Open').length;
    const progress = data.filter(t => t.status === 'In Progress').length;
    const resolved = data.filter(t => t.status === 'Resolved').length;

    const ui = window.adminDashboardUI;
    const statsHtml = `
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            ${ui.stat('Open tickets', open, 'Awaiting first action', 'gold', 'support', 'stat-tech-open')}
            ${ui.stat('In progress', progress, 'Currently being handled', 'blue', 'clock', 'stat-tech-progress')}
            ${ui.stat('Resolved', resolved, 'Completed support requests', 'green', 'check', 'stat-tech-resolved')}
        </div>`;

    // STRICT WIDTH ASSIGNMENT & STICKY HEADERS FIX
    let tableHeaders = `
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[12%]">Ticket ID</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[16%]">Customer</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[16%]">Contact</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[26%]">Issue</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[12%]">Status</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[12%]">Updated</th>
        <th class="py-4 px-5 sticky top-0 bg-[#f8fafc] z-10 shadow-[0_1px_0_rgba(18,23,15,0.1)] w-[6%] text-right">Actions</th>`;

    let rows = data.length === 0 ? `<tr><td colspan="7" class="text-center py-8 text-[#1f271b]/60 font-medium">No records found.</td></tr>` : data.map(t => {
        let sColor = t.status === 'Open' ? 'text-yellow-600 border-yellow-500 bg-yellow-50/30' : 
                     t.status === 'In Progress' ? 'text-blue-600 border-blue-500 bg-blue-50/30' : 
                     'text-green-600 border-green-500 bg-green-50/30';
                     
        let statusBadge = `<span id="badge-${t.id}" class="px-2.5 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider border ${sColor} transition-colors duration-500">${t.status}</span>`;

        let actionContent = `
            <td class="py-4 px-5 text-right relative overflow-visible">
                <div class="inline-block text-left group/menu cursor-pointer">
                    <button onclick="event.stopPropagation();" class="text-[#1f271b]/40 hover:text-[#d4af37] focus:outline-none p-1 rounded-sm transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                    </button>
                    <div class="absolute right-8 top-10 mt-1 w-44 bg-white border border-[#12170f]/10 rounded-sm shadow-md opacity-0 invisible group-hover/menu:opacity-100 group-hover/menu:visible transition-all z-20 overflow-hidden flex flex-col text-left">
                        <button id="menu-btn-open-${t.id}" onclick="event.stopPropagation(); updateTicketStatus('${t.id}', 'Open')" class="px-4 py-2.5 text-left text-xs font-bold hover:bg-gray-50 border-b border-[#12170f]/5 transition-colors duration-300 ${t.status === 'Open' ? 'text-yellow-600 bg-yellow-50/50' : 'text-[#12170f]'}">Mark as Open</button>
                        <button id="menu-btn-progress-${t.id}" onclick="event.stopPropagation(); updateTicketStatus('${t.id}', 'In Progress')" class="px-4 py-2.5 text-left text-xs font-bold hover:bg-gray-50 border-b border-[#12170f]/5 transition-colors duration-300 ${t.status === 'In Progress' ? 'text-blue-600 bg-blue-50/50' : 'text-[#12170f]'}">Mark as In Progress</button>
                        <button id="menu-btn-resolved-${t.id}" onclick="event.stopPropagation(); updateTicketStatus('${t.id}', 'Resolved')" class="px-4 py-2.5 text-left text-xs font-bold hover:bg-gray-50 border-b border-[#12170f]/5 transition-colors duration-300 ${t.status === 'Resolved' ? 'text-green-600 bg-green-50/50' : 'text-[#12170f]'}">Mark as Resolved</button>
                        <button onclick="event.stopPropagation(); deleteTicket('${t.id}')" class="px-4 py-2.5 text-left text-xs font-bold text-red-600 hover:bg-red-50 transition-colors">Delete Ticket</button>
                    </div>
                </div>
            </td>
        `;

        const isActiveRow = window.app && window.app.activeItemId === t.id;
        return `
        <tr id="row-${t.id}" class="transition-all duration-500 cursor-pointer ${isActiveRow ? 'bg-[#d4af37]/5 border-l-2 border-l-[#d4af37]' : 'hover:bg-gray-50/50 border-l-2 border-l-transparent'} group" onclick="window.handleEnquiryAction('technical', '${t.id}')">
            <td class="py-4 px-5 text-[#1f271b] group-hover:text-[#d4af37] font-bold transition-colors truncate">#${t.shortId}</td>
            <td class="py-4 px-5 overflow-hidden">
                <p class="text-[#12170f] font-bold truncate">${t.customer}</p>
                <p class="text-[10px] text-[#1f271b]/60 uppercase truncate">${t.company}</p>
            </td>
            <td class="py-4 px-5 overflow-hidden">
                <p class="text-[#12170f] text-xs truncate">${t.email}</p>
                <p class="text-[10px] text-[#1f271b]/60 font-medium truncate">${t.phone}</p>
            </td>
            <td class="py-4 px-5 text-[#1f271b]/70 text-xs truncate">${t.issue}</td>
            <td class="py-4 px-5 truncate">${statusBadge}</td>
            <td class="py-4 px-5 text-[#1f271b]/70 text-xs truncate">${t.updated}</td>
            ${actionContent}
        </tr>`;
    }).join('');

    // OVERFLOW SCROLL & TABLE-FIXED FIX
    container.innerHTML = `
        <div class="max-w-7xl mx-auto pb-10">
        ${ui.hero('Customer care', 'Technical Support', 'Triage incoming issues, keep customers informed and close the loop.')}
        ${statsHtml}
        <section class="bg-white border border-[#12170f]/10 rounded-xl mb-6 shadow-[0_10px_35px_rgba(18,23,15,0.04)] overflow-hidden flex flex-col relative">
            <div class="px-5 py-5 border-b border-[#12170f]/10">
                <p class="text-[10px] uppercase tracking-[0.18em] font-bold text-[#d4af37]">Support queue</p>
                <h3 class="text-xl text-[#12170f] mt-1">All tickets</h3>
            </div>
            <!-- Fixed viewport, not sized to the rows. See the longer note on the
                 same element in quotations.js: min-h holds a consistent height
                 and stops a one-row table raising a vertical scrollbar it has
                 nothing to scroll, max-h keeps a long list scrolling inside the
                 table rather than pushing the stat cards off screen. The two
                 Enquiries tabs must keep these identical. -->
            <div class="overflow-x-auto overflow-y-auto flex-1 min-h-[420px] max-h-[calc(100vh-330px)] pb-16">
                <table class="w-[1000px] xl:w-full text-left border-collapse table-fixed">
                    <thead><tr class="text-[10px] text-[#12170f]/40 uppercase tracking-widest font-bold">${tableHeaders}</tr></thead>
                    <tbody id="enquiries-tbody" class="text-sm font-semibold divide-y divide-[#12170f]/5">${rows}</tbody>
                </table>
            </div>
        </section>
        </div>
    `;
};

// ==========================================
// 5. UI RENDERING (Drawer/Modal View)
// ==========================================
window.handleEnquiryAction = function(type, id) {
    if (window.app) window.app.activeItemId = id;
    window.renderEnquiryView('technical');

    const searchId = typeof id === 'string' && !isNaN(id) ? parseInt(id, 10) : id;
    const t = window.enquiryData.technical.find(x => x.id === searchId);
    if (!t) return;

    let statusClass = t.status === 'Open' ? 'text-yellow-700 border-yellow-500 bg-yellow-50' : 
                      t.status === 'In Progress' ? 'text-blue-700 border-blue-500 bg-blue-50' : 
                      'text-green-700 border-green-500 bg-green-50';

    const badgeHtml = `
        <div class="relative">
            <select autocomplete="srk-no-autofill" id="drawer-status-${t.id}" onchange="updateTicketStatus('${t.id}', this.value)" class="appearance-none border ${statusClass} text-xs font-bold py-1.5 pl-3 pr-8 rounded-sm focus:outline-none cursor-pointer uppercase tracking-wider shadow-sm transition-colors duration-500 hover:brightness-95">
                <option value="Open" ${t.status === 'Open' ? 'selected' : ''}>Open</option>
                <option value="In Progress" ${t.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                <option value="Resolved" ${t.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
            </select>
            <svg class="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </div>
    `;

    const html = `
        <div class="border-b border-[#12170f]/10 pb-6 mb-6">
            <div class="flex items-center gap-2 text-[#12170f]/40 font-bold text-xs tracking-wider uppercase mb-5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                Customer Details
            </div>
            <div class="grid grid-cols-[100px_1fr] gap-y-4 text-sm">
                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Name</div>
                <div class="text-[#12170f] font-bold text-base">${t.customer}</div>
                
                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Company</div>
                <div class="text-[#12170f] font-bold">${t.company}</div>
                
                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Email</div>
                <div class="text-[#12170f] font-bold">
                    <a href="mailto:${t.email}" class="hover:text-[#d4af37] transition-colors flex items-center gap-2">
                        ${t.email}
                        <svg class="w-3.5 h-3.5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                    </a>
                </div>
                
                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Phone</div>
                <div class="text-[#12170f] font-bold">
                    <a href="tel:${t.phone}" class="hover:text-[#d4af37] transition-colors">${t.phone}</a>
                </div>

                <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Received</div>
                <div class="text-[#1f271b]/80 font-bold text-xs">${t.updated}</div>
            </div>
        </div>
        <div class="pb-6 mb-6">
            <div class="flex items-center gap-2 text-[#12170f]/40 font-bold text-xs tracking-wider uppercase mb-4">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                Issue / Request Note
            </div>
            <div class="text-sm text-[#1f271b]/80 leading-relaxed font-semibold bg-white p-5 rounded-sm border border-[#12170f]/10 shadow-sm whitespace-pre-wrap">${t.issue}</div>
        </div>
    `;

    if (window.app && window.app.openDrawer) {
        window.app.openDrawer(html, `Ticket #${t.shortId}`, badgeHtml);
    }
};
