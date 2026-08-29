(function () {
    'use strict';

    const escapeDashboardText = value => String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function rows(payload, key) {
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload && payload[key]) ? payload[key] : [];
    }

    async function get(path) {
        const response = await window.adminAuth.fetch(path, { cache: 'no-store' });
        if (!response.ok) throw new Error('Dashboard request failed');
        return response.json();
    }

    function amount(value) {
        return window.formatAmount ? window.formatAmount(value) : `₹ ${Number(value || 0).toLocaleString('en-IN')}`;
    }

    function shortDate(value) {
        const date = new Date(value);
        if (!value || Number.isNaN(date.getTime())) return 'Date unavailable';
        return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    const sectionTones = {
        gold: { icon: 'bg-[#d4af37]/10 border-[#d4af37]/20', text: 'text-[#a8862a]', stroke: '#a8862a' },
        green: { icon: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700', stroke: '#047857' },
        blue: { icon: 'bg-blue-50 border-blue-100', text: 'text-blue-700', stroke: '#1d4ed8' },
        wine: { icon: 'bg-[#420c14]/5 border-[#420c14]/10', text: 'text-[#420c14]', stroke: '#420c14' },
        red: { icon: 'bg-red-50 border-red-100', text: 'text-red-700', stroke: '#b91c1c' }
    };

    // Named, complete icon geometry. Keeping the symbols here avoids passing
    // partial path fragments through every card, which is how the previous
    // revenue and product marks ended up looking clipped or unfinished.
    const adminIcons = Object.freeze({
        orders: '<path d="M6 8h12l1 13H5L6 8Z"></path><path d="M9 10V7a3 3 0 0 1 6 0v3"></path>',
        revenue: '<path d="M6 5h12M6 9h12"></path><path d="M7 5h3.5a4 4 0 0 1 0 8H7l8 7"></path>',
        products: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"></path><path d="m4.3 7.7 7.7 4.4 7.7-4.4M12 12.1V21"></path>',
        customers: '<circle cx="9" cy="8" r="3"></circle><path d="M3 20v-1a6 6 0 0 1 12 0v1"></path><circle cx="17" cy="9" r="2.5"></circle><path d="M15.5 15.6A5 5 0 0 1 21 20"></path>',
        categories: '<path d="M3 7.5h7l2-2h9v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11Z"></path><path d="M3 10h18"></path>',
        check: '<path d="m5 12 4 4L19 6"></path>',
        clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
        support: '<path d="M4 5h16v11H9l-5 4V5Z"></path><path d="M8 10h.01M12 10h.01M16 10h.01"></path>',
        quote: '<path d="M7 3h7l4 4v14H7V3Z"></path><path d="M14 3v5h5M10 12h5M10 16h5"></path>',
        warning: '<path d="m12 3 9 17H3L12 3Z"></path><path d="M12 9v4M12 17h.01"></path>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 10h18"></path>',
        hidden: '<path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 4.3A10 10 0 0 1 12 4c5.2 0 9 4.5 9 8a8.5 8.5 0 0 1-2 4M6.6 6.6C4.2 8.1 3 10.3 3 12c0 3.5 3.8 8 9 8a10 10 0 0 0 4.1-.9"></path>',
        plus: '<path d="M12 5v14M5 12h14"></path>'
    });

    function iconMarkup(name, className, stroke) {
        const geometry = adminIcons[name] || adminIcons.check;
        return `<svg class="${className}" aria-hidden="true" focusable="false" fill="none" stroke="${stroke}" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${geometry}</svg>`;
    }

    function sectionHero(eyebrow, title, description, actionHTML = '') {
        return `
            <section class="relative overflow-hidden rounded-2xl bg-[#12170f] p-6 md:p-8 shadow-[0_22px_55px_rgba(18,23,15,0.16)] mb-6">
                <div class="absolute -right-16 -top-20 w-64 h-64 rounded-full bg-[#d4af37]/10"></div>
                <div class="absolute right-24 -bottom-28 w-52 h-52 rounded-full border border-[#d4af37]/20"></div>
                <div class="relative flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                    <div class="min-w-0">
                        <div class="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 py-1.5 mb-4">
                            <span class="w-2 h-2 rounded-full bg-[#d4af37]"></span>
                            <span class="text-[10px] uppercase tracking-[0.2em] font-bold" style="color:#e4c55c">${escapeDashboardText(eyebrow)}</span>
                        </div>
                        <h2 class="text-3xl md:text-4xl font-bold tracking-tight leading-tight" style="color:#ffffff">${escapeDashboardText(title)}</h2>
                        <p class="text-sm md:text-base mt-3 max-w-2xl leading-relaxed" style="color:rgba(255,255,255,.62)">${escapeDashboardText(description)}</p>
                    </div>
                    ${actionHTML ? `<div class="shrink-0">${actionHTML}</div>` : ''}
                </div>
            </section>`;
    }

    function primaryAction(label, onClickExpression) {
        return `
            <button type="button" onclick="${onClickExpression}" class="w-full md:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-5 py-3 text-sm font-bold text-[#12170f] shadow-[0_10px_25px_rgba(212,175,55,0.2)] hover:bg-[#e4c55c] hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#12170f]">
                ${iconMarkup('plus', 'w-4 h-4', 'currentColor')}
                ${escapeDashboardText(label)}
            </button>`;
    }

    function sectionStat(label, value, detail, tone = 'gold', iconName = 'check', valueId = '') {
        const palette = sectionTones[tone] || sectionTones.gold;
        return `
            <div class="bg-white border border-[#12170f]/10 rounded-xl p-5 shadow-[0_8px_30px_rgba(18,23,15,0.04)]">
                <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                        <strong ${valueId ? `id="${escapeDashboardText(valueId)}"` : ''} class="block text-2xl md:text-3xl text-[#12170f] leading-none transition-all duration-300">${escapeDashboardText(value)}</strong>
                        <span class="block text-[10px] uppercase tracking-[0.16em] font-bold mt-3 ${palette.text}">${escapeDashboardText(label)}</span>
                    </div>
                    <div class="w-10 h-10 rounded-lg border ${palette.icon} flex items-center justify-center shrink-0">
                        ${iconMarkup(iconName, 'w-5 h-5', palette.stroke)}
                    </div>
                </div>
                ${detail ? `<span class="block text-xs text-[#1f271b]/50 mt-3 leading-relaxed">${escapeDashboardText(detail)}</span>` : ''}
            </div>`;
    }

    window.adminDashboardUI = Object.freeze({
        hero: sectionHero,
        primaryAction,
        stat: sectionStat
    });

    function metricCard(label, value, detail, tab, parent, current, tone, iconName) {
        const tones = {
            gold: { icon: 'bg-[#d4af37]/10 border-[#d4af37]/20', eyebrow: 'text-[#a8862a]' },
            green: { icon: 'bg-emerald-50 border-emerald-100', eyebrow: 'text-emerald-700' },
            wine: { icon: 'bg-[#420c14]/5 border-[#420c14]/10', eyebrow: 'text-[#420c14]' },
            blue: { icon: 'bg-blue-50 border-blue-100', eyebrow: 'text-blue-700' }
        };
        const palette = tones[tone] || tones.gold;
        const stroke = tone === 'green' ? '#047857' : tone === 'wine' ? '#420c14' : tone === 'blue' ? '#1d4ed8' : '#a8862a';

        return `
            <button type="button" onclick="window.app.switchTab('${tab}','${parent}','${current}')"
                class="group text-left bg-white border border-[#12170f]/10 rounded-xl p-5 shadow-[0_8px_30px_rgba(18,23,15,0.04)] hover:border-[#d4af37]/60 hover:shadow-[0_14px_36px_rgba(18,23,15,0.09)] hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]">
                <div class="flex items-start justify-between gap-4">
                    <div class="w-11 h-11 rounded-lg border ${palette.icon} flex items-center justify-center shrink-0">
                        ${iconMarkup(iconName, 'w-5 h-5', stroke)}
                    </div>
                    <span class="text-lg text-[#12170f]/25 group-hover:text-[#d4af37] transition-colors">↗</span>
                </div>
                <strong class="block text-3xl mt-5 text-[#12170f] leading-none">${escapeDashboardText(value)}</strong>
                <span class="block text-[10px] uppercase tracking-[0.18em] font-bold mt-3 ${palette.eyebrow}">${escapeDashboardText(label)}</span>
                <span class="block text-xs text-[#1f271b]/50 mt-2 leading-relaxed">${escapeDashboardText(detail)}</span>
            </button>`;
    }

    function attentionRow(label, value, hint, tab, parent, current, colour) {
        const dots = { amber: 'bg-amber-500', blue: 'bg-blue-500', wine: 'bg-[#420c14]' };
        return `
            <button type="button" onclick="window.app.switchTab('${tab}','${parent}','${current}')" class="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-[#f8fafc] transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]">
                <span class="w-2.5 h-2.5 rounded-full ${dots[colour] || dots.amber} shrink-0"></span>
                <span class="min-w-0 flex-1"><strong class="block text-sm text-[#12170f]">${escapeDashboardText(label)}</strong><span class="block text-[11px] text-[#1f271b]/50 mt-0.5 truncate">${escapeDashboardText(hint)}</span></span>
                <strong class="text-xl text-[#12170f]">${escapeDashboardText(value)}</strong>
            </button>`;
    }

    function orderStatusBadge(status) {
        const styles = {
            'Pending Payment': 'bg-amber-50 text-amber-700 border-amber-200',
            'Payment Review': 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
            'Processing': 'bg-yellow-50 text-yellow-700 border-yellow-200',
            'Shipped': 'bg-blue-50 text-blue-700 border-blue-200',
            'Delivered': 'bg-emerald-50 text-emerald-700 border-emerald-200',
            'Cancelled': 'bg-red-50 text-red-700 border-red-200'
        };
        return `<span class="px-2.5 py-1 rounded-full border text-[9px] uppercase tracking-wider font-bold ${styles[status] || styles.Processing}">${escapeDashboardText(status || 'Processing')}</span>`;
    }

    function recentOrdersHTML(orders) {
        if (!orders.length) return '<div class="py-12 text-center text-sm text-[#1f271b]/45">No orders have been placed yet.</div>';

        return orders.slice(0, 5).map(order => {
            const customer = order.customer && (order.customer.full_name || order.customer.email)
                ? (order.customer.full_name || order.customer.email) : 'Guest customer';
            return `
                <button type="button" onclick="window.app.switchTab('orders','Store','Orders')" class="w-full grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto] gap-3 items-center px-5 py-4 border-t border-[#12170f]/5 text-left hover:bg-[#f8fafc] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d4af37]">
                    <span class="min-w-0"><strong class="block text-sm text-[#12170f] truncate">Order #${escapeDashboardText(order.order_number || order.id)}</strong><span class="block text-[11px] text-[#1f271b]/50 mt-1 truncate">${escapeDashboardText(customer)} · ${escapeDashboardText(shortDate(order.created_at))}</span></span>
                    <span class="hidden sm:block text-sm font-bold text-[#12170f] whitespace-nowrap">${escapeDashboardText(amount(order.net_amount))}</span>
                    ${orderStatusBadge(order.status)}
                </button>`;
        }).join('');
    }

    function statusBar(label, count, total, colour) {
        const width = total ? Math.max(3, Math.round((count / total) * 100)) : 0;
        const colours = { amber: 'bg-amber-400', blue: 'bg-blue-500', green: 'bg-emerald-500' };
        return `
            <div><div class="flex items-center justify-between text-[11px] font-bold mb-2"><span class="text-[#1f271b]/60">${escapeDashboardText(label)}</span><span class="text-[#12170f]">${count}</span></div>
            <div class="h-2 rounded-full bg-[#12170f]/5 overflow-hidden"><div class="h-full rounded-full ${colours[colour]}" style="width:${width}%"></div></div></div>`;
    }

    window.renderDashboard = async function () {
        const root = document.getElementById('main-content');
        let summary = null;
        try {
            summary = await get('/api/dashboard/summary');
        } catch (_) {
            summary = null;
        }
        if (!root || (window.app.currentTab && window.app.currentTab !== 'dashboard')) return;

        const unavailable = summary ? 0 : 1;
        const orderSummary = summary && summary.orders ? summary.orders : {};
        const orders = rows(orderSummary, 'recent');
        const orderTotal = Number(orderSummary.total) || 0;
        const shippedCount = Number(orderSummary.shipped) || 0;
        const processing = Number(orderSummary.processing) || 0;
        const pendingPayment = Number(orderSummary.pending_payment) || 0;
        const delivered = Number(orderSummary.delivered) || 0;
        const activeProducts = Number(summary && summary.active_products) || 0;
        const categoryCount = Number(summary && summary.categories) || 0;
        const customerCount = Number(summary && summary.customers) || 0;
        const openEnquiries = Number(summary && summary.open_enquiries) || 0;
        const openQuotes = Number(summary && summary.open_quotes) || 0;
        const shippedRevenue = Number(orderSummary.shipped_revenue) || 0;
        const attentionTotal = processing + pendingPayment + openEnquiries + openQuotes;

        root.innerHTML = `
            <div class="max-w-7xl mx-auto pb-10">
                <section class="relative overflow-hidden rounded-2xl bg-[#12170f] p-6 md:p-8 lg:p-10 shadow-[0_22px_55px_rgba(18,23,15,0.18)] mb-6">
                    <div class="absolute -right-16 -top-20 w-64 h-64 rounded-full bg-[#d4af37]/10"></div><div class="absolute right-24 -bottom-28 w-52 h-52 rounded-full border border-[#d4af37]/20"></div>
                    <div class="relative grid lg:grid-cols-[1.35fr_0.65fr] gap-8 items-end">
                        <div><div class="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 py-1.5 mb-5"><span class="w-2 h-2 rounded-full bg-[#d4af37]"></span><span class="text-[10px] uppercase tracking-[0.2em] font-bold" style="color:#e4c55c">Live operations</span></div>
                        <h2 class="text-3xl md:text-5xl font-bold tracking-tight leading-tight" style="color:#ffffff">Your store, at a glance.</h2><p class="text-sm md:text-base mt-4 max-w-2xl leading-relaxed" style="color:rgba(255,255,255,.62)">Revenue, fulfilment and customer requests brought into one useful operating view.</p></div>
                        <div class="grid grid-cols-2 gap-3"><div class="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm"><span class="block text-[9px] uppercase tracking-[0.18em] font-bold" style="color:rgba(255,255,255,.5)">Shipped revenue</span><strong class="block text-xl md:text-2xl mt-2" style="color:#ffffff">${escapeDashboardText(amount(shippedRevenue))}</strong></div>
                        <div class="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm"><span class="block text-[9px] uppercase tracking-[0.18em] font-bold" style="color:rgba(255,255,255,.5)">Needs attention</span><strong class="block text-xl md:text-2xl mt-2" style="color:#ffffff">${attentionTotal}</strong></div></div>
                    </div>
                </section>
                ${unavailable ? `<div class="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">The live summary is temporarily unavailable. Refresh this page to retry.</div>` : ''}
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                    ${metricCard('Total orders', orderTotal, `${processing + pendingPayment} currently in the fulfilment queue`, 'orders', 'Store', 'Orders', 'gold', 'orders')}
                    ${metricCard('Shipped revenue', amount(shippedRevenue), `${shippedCount} ${shippedCount === 1 ? 'order' : 'orders'} marked as shipped`, 'orders', 'Store', 'Orders', 'green', 'revenue')}
                    ${metricCard('Active products', activeProducts, `${categoryCount} catalogue categories`, 'products', 'Store', 'Products', 'wine', 'products')}
                    ${metricCard('Customers', customerCount, 'Profiles available to your operations team', 'customers', 'CRM', 'Customers', 'blue', 'customers')}
                </div>
                <div class="grid xl:grid-cols-[1.45fr_0.85fr] gap-6 mb-6">
                    <section class="bg-white rounded-xl border border-[#12170f]/10 shadow-[0_10px_35px_rgba(18,23,15,0.04)] overflow-hidden"><div class="px-5 py-5 flex items-center justify-between gap-4"><div><p class="text-[10px] uppercase tracking-[0.18em] font-bold text-[#d4af37]">Latest activity</p><h3 class="text-xl text-[#12170f] mt-1">Recent orders</h3></div><button type="button" onclick="window.app.switchTab('orders','Store','Orders')" class="text-xs font-bold text-[#420c14] hover:text-[#d4af37] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] rounded-sm px-2 py-1">View all →</button></div>${recentOrdersHTML(orders)}</section>
                    <section class="bg-white rounded-xl border border-[#12170f]/10 shadow-[0_10px_35px_rgba(18,23,15,0.04)] p-5"><p class="text-[10px] uppercase tracking-[0.18em] font-bold text-[#d4af37]">Action centre</p><h3 class="text-xl text-[#12170f] mt-1 mb-3">What needs attention</h3><div class="space-y-1">
                        ${attentionRow('Awaiting payment', pendingPayment, 'Do not fulfil until payment clears', 'orders', 'Store', 'Orders', 'amber')}${attentionRow('Being processed', processing, 'Orders waiting to ship', 'orders', 'Store', 'Orders', 'blue')}${attentionRow('Support enquiries', openEnquiries, 'Open or in progress', 'technical', 'Enquiries', 'Technical Support', 'wine')}${attentionRow('Quote requests', openQuotes, 'Open or in progress', 'quotations', 'Enquiries', 'Quotations', 'wine')}
                    </div></section>
                </div>
                <section class="grid md:grid-cols-[1fr_auto] gap-6 items-center bg-white rounded-xl border border-[#12170f]/10 shadow-[0_10px_35px_rgba(18,23,15,0.04)] p-5 md:p-6"><div><p class="text-[10px] uppercase tracking-[0.18em] font-bold text-[#d4af37]">Fulfilment pulse</p><h3 class="text-xl text-[#12170f] mt-1 mb-5">Order distribution</h3><div class="grid sm:grid-cols-3 gap-5">${statusBar('Processing', processing, orderTotal, 'amber')}${statusBar('Shipped', shippedCount, orderTotal, 'blue')}${statusBar('Delivered', delivered, orderTotal, 'green')}</div></div>
                    <button type="button" onclick="window.app.switchTab('categories','Store','Categories')" class="w-full md:w-auto rounded-lg bg-[#420c14] px-5 py-3 text-sm font-bold hover:bg-[#5e1220] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#420c14]/40" style="color:#ffffff">Manage catalogue</button>
                </section>
            </div>`;
    };
})();
