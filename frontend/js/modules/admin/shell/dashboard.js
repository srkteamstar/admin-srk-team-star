(function () {
    'use strict';

    function rows(payload, key) {
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload && payload[key]) ? payload[key] : [];
    }

    async function get(path) {
        const response = await window.adminAuth.fetch(path);
        if (!response.ok) throw new Error('Dashboard request failed');
        return response.json();
    }

    function card(label, value, tab, parent, current) {
        return `
            <button type="button" onclick="window.app.switchTab('${tab}','${parent}','${current}')"
                class="text-left bg-white border border-[#12170f]/10 rounded-sm p-6 hover:border-[#d4af37] hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]">
                <span class="block text-[11px] uppercase tracking-[0.18em] font-bold text-[#1f271b]/45">${label}</span>
                <strong class="block text-4xl mt-3 text-[#12170f]">${value}</strong>
                <span class="block text-xs font-bold text-[#d4af37] mt-4">Open ${current} →</span>
            </button>`;
    }

    window.renderDashboard = async function () {
        const root = document.getElementById('main-content');
        const requests = await Promise.allSettled([
            get('/api/orders'), get('/api/products'), get('/api/customers'),
            get('/api/enquiries'), get('/api/quote-requests'), get('/api/categories')
        ]);
        const value = (index, key) => requests[index].status === 'fulfilled' ? rows(requests[index].value, key).length : '—';
        const unavailable = requests.filter(item => item.status === 'rejected').length;

        root.innerHTML = `
            <div class="max-w-6xl mx-auto">
                <div class="mb-8">
                    <p class="text-[11px] uppercase tracking-[0.2em] font-bold text-[#d4af37]">Live overview</p>
                    <h2 class="text-3xl md:text-4xl font-bold mt-2">Dashboard</h2>
                    <p class="text-sm text-[#1f271b]/60 mt-2">A direct route into the records that need attention.</p>
                </div>
                ${unavailable ? `<div class="mb-6 border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">${unavailable} summary ${unavailable === 1 ? 'source is' : 'sources are'} temporarily unavailable. Open the relevant section to retry.</div>` : ''}
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    ${card('Orders', value(0, 'orders'), 'orders', 'Store', 'Orders')}
                    ${card('Products', value(1, 'products'), 'products', 'Store', 'Products')}
                    ${card('Customers', value(2, 'customers'), 'customers', 'CRM', 'Customers')}
                    ${card('Support enquiries', value(3, 'enquiries'), 'technical', 'Enquiries', 'Technical Support')}
                    ${card('Quote requests', value(4, 'quotations'), 'quotations', 'Enquiries', 'Quotations')}
                    ${card('Categories', value(5, 'categories'), 'categories', 'Store', 'Categories')}
                </div>
            </div>`;
    };
})();
