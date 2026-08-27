window.productData = [];
window.productCategories = [];
window.productLoadError = null;

// A product carries up to four images, stored as product-images/<id>/<slot>.
// The drawer tracks them by slot: files picked in this session, their data-URL
// previews, the URLs already on the server, the slots the admin cleared, and
// which slot is the main image (the one the table row shows).
window.PRODUCT_IMAGE_SLOTS = [1, 2, 3, 4];
window.productImageFiles = {};
window.productImagePreviews = {};
window.productExistingImages = {};
window.productImageRemovedSlots = new Set();
window.productMainSlot = null;

// Everything below stringifies HTML, so admin-entered text is escaped before it is
// interpolated — a stray quote in a product name would otherwise break the
// surrounding attribute, and a tag would be executed by the dashboard. Price is
// free text too ('₹ 1,200 / box'), so it goes through the same escape.
window.escapeProductText = function(value) {
    return (value ?? '')
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

window.slugifyProduct = function(value) {
    return (value || '')
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

// window.renderToggleSwitch and window.toggleSwitchState come from categories.js.
// This file loads first, but both are only ever *called* at render time — which is
// after DOMContentLoaded, by which point every module script has executed.

// ==========================================
// DATA
// ==========================================
// Categories are fetched alongside products because the drawer's category select
// must be populated even when the admin has never opened the Categories tab.
window.fetchProducts = async function() {
    const request = (url) => window.adminAuth.fetch(url, { cache: 'no-store' });

    try {
        const [productRes, categoryRes] = await Promise.all([
            request('/api/products'),
            request('/api/categories')
        ]);

        const result = await productRes.json();
        if (!productRes.ok) throw new Error(result.error || "Failed to fetch products");

        window.productData = Array.isArray(result) ? result : [];
        window.productLoadError = null;

        // A failed category list is not fatal — products still render, the drawer
        // just falls back to "Uncategorised".
        if (categoryRes.ok) {
            const categories = await categoryRes.json();
            window.productCategories = Array.isArray(categories) ? categories : [];
        } else {
            window.productCategories = [];
        }
    } catch (error) {
        console.error("Error fetching products:", error);
        window.productData = [];
        window.productLoadError = error.message || "Could not reach the server.";
    }
};

// Entry point used by app.switchTab() — fetches, then paints.
window.renderProducts = async function() {
    await window.fetchProducts();
    window.paintProducts();
};

// ==========================================
// TABLE
// ==========================================
window.paintProducts = function() {
    const container = document.getElementById('main-content');

    // A response that lands after the user has moved on must not hijack the view.
    if (!container || (app.currentTab && app.currentTab !== 'products')) return;

    const total = window.productData.length;
    const active = window.productData.filter(p => p.is_active !== false).length;

    const placeholderIcon = `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`;

    let rows;
    if (window.productLoadError) {
        rows = `<tr><td colspan="6" class="py-10 text-center">
            <p class="text-red-600 font-bold text-sm px-6">${window.escapeProductText(window.productLoadError)}</p>
            <button onclick="window.renderProducts()" class="mt-3 text-xs font-bold text-[#d4af37] hover:underline">Retry</button>
        </td></tr>`;
    } else if (total === 0) {
        rows = `<tr><td colspan="6" class="py-10 text-center text-[#1f271b]/40 font-semibold">No products yet. Add one to get started.</td></tr>`;
    } else {
        rows = window.productData.map(p => {
            const isActive = p.is_active !== false;
            const badge = isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
            const name = window.escapeProductText(p.name);

            // category_name is sent by the API; fall back to a local lookup when an
            // older response shape only carries category_id.
            const category = p.category_name
                || (window.productCategories.find(c => c.id == p.category_id) || {}).name
                || '';

            return `
            <tr id="row-prod-${p.id}" onclick="window.handleProductAction('${p.id}')" class="cursor-pointer transition-colors ${app.activeItemId == p.id ? 'bg-[#d4af37]/5 border-l-2 border-l-[#d4af37]' : 'hover:bg-gray-50'}">
                <td class="py-3 px-5">
                    <div class="relative w-12 h-12 bg-[#f8fafc] border border-[#12170f]/10 rounded-sm overflow-hidden flex items-center justify-center text-[#d4af37] shrink-0">
                        ${placeholderIcon}
                        ${p.image_url ? `<img src="${window.escapeProductText(p.image_url)}" alt="${name}" class="absolute inset-0 w-full h-full object-cover" onerror="this.style.display='none'">` : ''}
                    </div>
                </td>
                <td class="py-3 px-5">
                    <p class="text-[#1f271b] font-bold text-base">${name}${p.is_featured ? ` <span class="ml-1 align-middle px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wider bg-[#d4af37]/15 text-[#a8862a]">Featured</span>` : ''}</p>
                    <p class="text-[#1f271b]/60 text-xs mt-0.5 max-w-xs truncate">${p.description ? window.escapeProductText(p.description) : 'No description added.'}</p>
                </td>
                <td class="py-3 px-5">${category
                    ? `<span class="text-[#1f271b]/80 font-semibold text-sm">${window.escapeProductText(category)}</span>`
                    : '<span class="text-[#1f271b]/30 font-semibold text-sm">Uncategorised</span>'}</td>
                <td class="py-3 px-5 font-bold text-base whitespace-nowrap">${p.price ? window.escapeProductText(window.formatProductPrice(p.price)) : '<span class="text-[#1f271b]/30 font-semibold text-sm">On request</span>'}</td>
                <td class="py-3 px-5">
                    <div class="flex items-center gap-3">
                        <span class="px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider ${badge}">${isActive ? 'Active' : 'Inactive'}</span>
                        ${window.renderToggleSwitch(isActive, `window.toggleProductStatus('${p.id}')`, `Show ${name} on the store`)}
                    </div>
                </td>
                <td class="py-3 px-5 text-right relative">
                    <button onclick="window.toggleProductDropdown(event, '${p.id}')" title="Actions" aria-label="Actions for ${name}" class="text-[#1f271b]/50 hover:text-[#d4af37] focus:outline-none transition-colors p-1 rounded hover:bg-gray-200">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                    </button>
                    <div id="dropdown-prod-${p.id}" class="hidden absolute right-5 top-10 bg-white border border-[#12170f]/10 shadow-lg rounded-sm w-40 z-20 text-left overflow-hidden">
                        <button onclick="event.stopPropagation(); window.handleProductAction('${p.id}')" class="block w-full text-left px-4 py-2.5 text-sm text-[#1f271b] font-semibold hover:bg-gray-50 transition-colors">Edit Product</button>
                        <button onclick="event.stopPropagation(); window.deleteProduct('${p.id}')" class="block w-full text-left px-4 py-2.5 text-sm text-red-600 font-semibold hover:bg-red-50 transition-colors border-t border-gray-100">Delete Product</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    container.innerHTML = `
        <div class="mb-10"><h2 class="text-3xl font-bold tracking-tight text-[#12170f]">Products</h2><p class="text-sm text-[#1f271b]/60 mt-2">Manage the products shown across your store.</p></div>

        <!-- Summary Cards + Primary Action -->
        <div class="flex flex-wrap items-center justify-between gap-4 mb-8">
            <div class="flex flex-wrap items-center gap-4">
                <div class="bg-white border border-[#12170f]/10 p-5 rounded-sm shadow-sm flex items-center gap-4 w-60">
                    <div class="w-12 h-12 rounded-sm bg-[#d4af37]/10 border border-[#d4af37]/20 text-[#d4af37] flex items-center justify-center shrink-0"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg></div>
                    <div class="min-w-0"><h3 class="text-2xl font-bold text-[#12170f] leading-none">${total}</h3><p class="text-[10px] font-bold uppercase tracking-wider text-[#12170f]/40 mt-1 truncate">Total Products</p></div>
                </div>
                <div class="bg-white border border-[#12170f]/10 p-5 rounded-sm shadow-sm flex items-center gap-4 w-60">
                    <div class="w-12 h-12 rounded-sm bg-green-50 border border-green-100 text-green-600 flex items-center justify-center shrink-0"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg></div>
                    <div class="min-w-0"><h3 class="text-2xl font-bold text-[#12170f] leading-none">${active}</h3><p class="text-[10px] font-bold uppercase tracking-wider text-[#12170f]/40 mt-1 truncate">Active Products</p></div>
                </div>
            </div>
            <button onclick="window.handleProductAction('new')" class="shrink-0 whitespace-nowrap bg-[#420c14] text-white px-5 py-3 rounded-sm text-sm font-bold hover:bg-[#5e1220] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#420c14]/40 flex items-center gap-2 shadow-sm">
                <svg class="w-4 h-4 shrink-0" stroke="#ffffff" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg> Add Product
            </button>
        </div>

        <div class="bg-white border border-[#12170f]/10 rounded-sm overflow-visible mb-6">
            <table class="w-full text-left border-collapse">
                <thead><tr class="bg-[#f8fafc] border-b border-[#12170f]/10 text-xs text-[#12170f]/40 uppercase tracking-wide font-bold">
                    <th class="py-4 px-5 w-24">Image</th><th class="py-4 px-5">Product Name</th>
                    <th class="py-4 px-5 w-44">Category</th><th class="py-4 px-5 w-40">Price</th>
                    <th class="py-4 px-5 w-48">Status</th><th class="py-4 px-5 w-28 text-right">Actions</th>
                </tr></thead>
                <tbody class="text-sm font-semibold divide-y divide-[#12170f]/5">${rows}</tbody>
            </table>
        </div>
    `;
};

window.toggleProductDropdown = function(event, id) {
    event.stopPropagation();
    const dropdown = document.getElementById(`dropdown-prod-${id}`);
    const isHidden = dropdown.classList.contains('hidden');
    document.querySelectorAll('[id^="dropdown-prod-"]').forEach(el => el.classList.add('hidden'));
    if (isHidden) dropdown.classList.remove('hidden');
};

document.addEventListener('click', () => {
    document.querySelectorAll('[id^="dropdown-prod-"]').forEach(el => el.classList.add('hidden'));
});

// ==========================================
// STATUS TOGGLE (optimistic, rolls back on failure)
// ==========================================
window.toggleProductStatus = async function(id) {
    const product = window.productData.find(p => p.id == id);
    if (!product) return;

    const nextState = product.is_active === false;
    product.is_active = nextState;
    window.paintProducts();

    try {
        const res = await window.adminAuth.fetch(`/api/products/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: nextState })
        });
        if (!res.ok) throw new Error('Status update failed');
    } catch (error) {
        product.is_active = !nextState;
        window.paintProducts();
        alert('Failed to update product status.');
    }
};

// ==========================================
// IMAGE SLOTS (up to four per product, one marked main)
// ==========================================

// Resets every slot. Called whenever the drawer opens so a previous product's
// picks never bleed into the next one.
window.resetProductImageState = function() {
    window.productImageFiles = {};
    window.productImagePreviews = {};
    window.productExistingImages = {};
    window.productImageRemovedSlots = new Set();
    window.productMainSlot = null;
};

// What a slot should show right now: a freshly picked file wins over whatever is
// on the server, and a cleared slot shows nothing even if the server still has one.
window.getProductSlotState = function(slot) {
    if (window.productImageFiles[slot]) {
        return { has: true, src: window.productImagePreviews[slot] || '' };
    }
    if (window.productImageRemovedSlots.has(slot)) return { has: false, src: '' };
    if (window.productExistingImages[slot]) {
        return { has: true, src: window.productExistingImages[slot] };
    }
    return { has: false, src: '' };
};

window.getFilledProductSlots = function() {
    return window.PRODUCT_IMAGE_SLOTS.filter(slot => window.getProductSlotState(slot).has);
};

// The main slot must always point at a slot that actually holds an image —
// otherwise the row would render a thumbnail that no longer exists.
window.resolveProductMainSlot = function() {
    const filled = window.getFilledProductSlots();
    if (!filled.length) {
        window.productMainSlot = null;
    } else if (!filled.includes(window.productMainSlot)) {
        window.productMainSlot = filled[0];
    }
};

window.setProductMainSlot = function(slot) {
    if (!window.getProductSlotState(slot).has) return;
    window.productMainSlot = slot;
    window.paintProductImageSlots();
};

window.previewProductImage = function(event, slot) {
    const file = event.target.files[0];
    if (!file) return;

    const allowedMimeTypes = ['image/avif', 'image/webp'];
    const fileExt = file.name.split('.').pop().toLowerCase();

    if (!allowedMimeTypes.includes(file.type) && !['avif', 'webp'].includes(fileExt)) {
        alert("Invalid file format! Only .avif and .webp image formats are allowed.");
        event.target.value = '';
        return;
    }

    // Picking a file overrides a pending removal for that slot.
    window.productImageFiles[slot] = file;
    window.productImageRemovedSlots.delete(slot);

    const reader = new FileReader();
    reader.onload = (e) => {
        window.productImagePreviews[slot] = e.target.result;
        // First image in becomes the main one by default.
        if (window.productMainSlot === null) window.productMainSlot = slot;
        window.paintProductImageSlots();
    };
    reader.readAsDataURL(file);
};

// Marks a slot for deletion. The object is removed from the bucket only when the
// product is saved, so Cancel still leaves the existing images untouched.
window.removeProductImageSlot = function(slot) {
    delete window.productImageFiles[slot];
    delete window.productImagePreviews[slot];

    // Only worth telling the server to delete something it actually has.
    if (window.productExistingImages[slot]) window.productImageRemovedSlots.add(slot);

    window.paintProductImageSlots();
};

window.paintProductImageSlots = function() {
    const grid = document.getElementById('product-image-grid');
    if (!grid) return;

    window.resolveProductMainSlot();

    grid.innerHTML = window.PRODUCT_IMAGE_SLOTS.map(slot => {
        const state = window.getProductSlotState(slot);
        const isMain = state.has && window.productMainSlot === slot;
        const input = `<input autocomplete="srk-no-autofill" type="file" id="product-image-input-${slot}" accept=".avif, .webp, image/avif, image/webp" class="hidden" onchange="window.previewProductImage(event, ${slot})" />`;

        if (!state.has) {
            return `
            <div onclick="document.getElementById('product-image-input-${slot}').click()"
                 class="relative aspect-[4/3] bg-[#f8fafc] border-2 border-dashed border-[#12170f]/20 rounded-sm flex flex-col items-center justify-center cursor-pointer transition-colors hover:border-[#d4af37]/60">
                <svg class="w-8 h-8 text-[#12170f]/25" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                <span class="text-[11px] font-bold uppercase tracking-wider text-[#12170f]/35 mt-2">Image ${slot}</span>
                ${input}
            </div>`;
        }

        return `
        <div class="relative aspect-[4/3] bg-[#f8fafc] border-2 ${isMain ? 'border-[#d4af37]' : 'border-[#12170f]/10'} rounded-sm overflow-hidden group transition-colors">
            <img src="${window.escapeProductText(state.src)}" alt="Image ${slot}" class="absolute inset-0 w-full h-full object-cover" />

            ${isMain ? `<span class="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider bg-[#d4af37] text-white shadow-sm">Main</span>` : ''}

            <div class="absolute inset-0 bg-[#12170f]/65 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2.5 p-3">
                ${!isMain ? `<button type="button" onclick="window.setProductMainSlot(${slot})" class="bg-white text-[#12170f] px-3.5 py-1.5 rounded-sm text-[11px] font-bold whitespace-nowrap hover:bg-[#d4af37] hover:text-white transition-colors">Set as main</button>` : ''}
                <div class="flex gap-2">
                    <button type="button" onclick="document.getElementById('product-image-input-${slot}').click()" class="bg-white text-[#12170f] px-3 py-1.5 rounded-sm text-[11px] font-bold whitespace-nowrap hover:bg-gray-100 transition-colors">Change</button>
                    <button type="button" onclick="window.removeProductImageSlot(${slot})" class="bg-white text-red-500 px-3 py-1.5 rounded-sm text-[11px] font-bold whitespace-nowrap hover:bg-red-50 transition-colors">Remove</button>
                </div>
            </div>
            ${input}
        </div>`;
    }).join('');

    const hint = document.getElementById('product-image-hint');
    if (hint) {
        const filled = window.getFilledProductSlots().length;
        const pending = window.productImageRemovedSlots.size;
        hint.textContent = pending
            ? `${filled} of 4 · ${pending} will be deleted on save`
            : `${filled} of 4 · only .avif, .webp`;
        hint.className = pending
            ? 'text-[11px] font-semibold text-red-500'
            : 'text-[11px] font-semibold text-[#d4af37]';
    }
};

// Slug follows the name only until the admin edits it by hand. Existing products
// start "touched" so renaming never silently breaks a live store URL.
window.syncProductSlug = function() {
    const slugInput = document.getElementById('input-prod-slug');
    const nameInput = document.getElementById('input-prod-name');
    if (!slugInput || !nameInput || slugInput.dataset.touched === 'true') return;
    slugInput.value = window.slugifyProduct(nameInput.value);
};

// ==========================================
// SAVE / DELETE
// ==========================================
window.saveProductData = async function(id) {
    const btn = document.getElementById('save-product-btn');
    const nameInput = document.getElementById('input-prod-name');
    if (!btn || !nameInput || btn.disabled) return; // guards a double submit

    const name = nameInput.value.trim();
    if (!name) {
        alert('Product name is required.');
        return;
    }

    const assetFolder = document.getElementById('input-prod-folder').value.trim();
    if (assetFolder.includes('..') || assetFolder.includes('\\')) {
        alert('Asset folder must be a plain path like "Frame Master" or "Cutting Machine/Rubber Support".');
        return;
    }

    btn.innerText = 'Saving...';
    btn.disabled = true;

    const formData = new FormData();
    formData.append('id', id);
    formData.append('name', name);
    formData.append('url_slug', document.getElementById('input-prod-slug').value.trim());
    formData.append('description', document.getElementById('input-prod-desc').value.trim());
    formData.append('featured_description', document.getElementById('input-prod-featured-desc').value.trim());
    formData.append('price', document.getElementById('input-prod-price').value.trim());
    formData.append('category_id', document.getElementById('input-prod-category').value);
    formData.append('asset_folder', assetFolder);
    formData.append('is_featured', document.getElementById('toggle-prod-featured').getAttribute('aria-checked'));
    formData.append('is_best_seller', document.getElementById('toggle-prod-bestseller').getAttribute('aria-checked'));
    formData.append('is_new_arrival', document.getElementById('toggle-prod-newarrival').getAttribute('aria-checked'));
    formData.append('is_active', document.getElementById('toggle-prod-active').getAttribute('aria-checked'));

    // Only slots the admin actually touched are sent, so renaming a product does
    // not re-upload four images.
    window.resolveProductMainSlot();

    window.PRODUCT_IMAGE_SLOTS.forEach(slot => {
        if (window.productImageFiles[slot]) {
            formData.append(`image_${slot}`, window.productImageFiles[slot]);
        }
    });

    if (window.productImageRemovedSlots.size) {
        formData.append('remove_slots', Array.from(window.productImageRemovedSlots).join(','));
    }
    if (window.productMainSlot) {
        formData.append('main_slot', String(window.productMainSlot));
    }

    try {
        const response = await window.adminAuth.fetch('/api/products', {
            method: 'POST',
            body: formData
        });

        const responseData = await response.json();
        if (!response.ok) throw new Error(responseData.error || "Save failed");

        if (app && typeof app.closeDrawer === 'function') app.closeDrawer();
        await window.renderProducts();
    } catch (error) {
        console.error(error);

        // Reset before the alert, not after — alert() blocks the thread, so the
        // button would otherwise sit on "Saving..." for as long as the dialog is
        // open, making a failed save look like one still in flight.
        btn.innerText = 'Save Product';
        btn.disabled = false;
        alert(error.message || 'Failed to save product.');
    }
};

window.deleteProduct = async function(id) {
    const product = window.productData.find(p => p.id == id);
    if (app && typeof app.closeDrawer === 'function') app.closeDrawer();

    if (!confirm(`Delete "${product ? product.name : id}"? Its image is removed too.`)) return;

    const row = document.getElementById(`row-prod-${id}`);
    if (row) {
        row.style.opacity = '0';
        row.style.transform = 'translateX(-20px)';
        row.style.backgroundColor = '#fee2e2';
    }

    try {
        const res = await window.adminAuth.fetch(`/api/products/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error("Delete failed");

        setTimeout(() => window.renderProducts(), 300);
    } catch (error) {
        alert("Failed to delete product.");
        if (row) {
            row.style.opacity = '1';
            row.style.transform = 'translateX(0)';
            row.style.backgroundColor = 'transparent';
        }
    }
};

// ==========================================
// DRAWER
// ==========================================
window.handleProductAction = function(id) {
    app.activeItemId = id;
    window.paintProducts();
    window.resetProductImageState();

    const isNew = id === 'new';
    const p = isNew
        ? {
            id: 'new', name: '', url_slug: '', description: '', featured_description: '', price: '',
            category_id: null, asset_folder: '', is_active: true,
            is_featured: false, is_best_seller: false, is_new_arrival: false, images: []
        }
        : window.productData.find(x => x.id == id);

    if (!p) return;

    // Seed the slots from what the server already has, so an edit that only
    // changes the name leaves every image untouched.
    (Array.isArray(p.images) ? p.images : []).forEach(image => {
        if (!window.PRODUCT_IMAGE_SLOTS.includes(image.slot)) return;
        window.productExistingImages[image.slot] = image.url;
        if (image.is_main) window.productMainSlot = image.slot;
    });

    const categoryOptions = window.productCategories
        .map(option => `<option value="${option.id}" ${option.id == p.category_id ? 'selected' : ''}>${window.escapeProductText(option.name)}</option>`)
        .join('');

    // A product whose category was deleted keeps its id but has no matching option,
    // so the select would silently reset to "Uncategorised" on the next save.
    const orphanCategory = p.category_id && !window.productCategories.some(c => c.id == p.category_id);

    app.openDrawer(`
        <div class="flex flex-col h-full relative bg-white">

            <div class="space-y-6">
                <div>
                    <div class="flex justify-between items-center mb-2">
                        <label class="block text-xs font-bold text-[#1f271b]/80 uppercase tracking-wide">PRODUCT IMAGES</label>
                        <span id="product-image-hint" class="text-[11px] font-semibold text-[#d4af37]">0 of 4 &middot; only .avif, .webp</span>
                    </div>

                    <div id="product-image-grid" class="grid grid-cols-2 gap-4"></div>

                    <p class="text-[11px] text-[#1f271b]/50 mt-2">Up to four images. The one marked <span class="font-bold text-[#a8862a]">Main</span> is the thumbnail shown in the table and on the storefront card.</p>
                </div>

                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">NAME <span class="text-red-500">*</span></label>
                    <input autocomplete="srk-no-autofill" spellcheck="false" id="input-prod-name" type="text" required value="${window.escapeProductText(p.name)}" oninput="window.syncProductSlug()" placeholder="Enter product name" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37]">
                </div>
                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">URL SLUG</label>
                    <input autocomplete="srk-no-autofill" spellcheck="false" id="input-prod-slug" type="text" value="${window.escapeProductText(p.url_slug)}" data-touched="${isNew ? 'false' : 'true'}" oninput="this.dataset.touched='true'" placeholder="auto-generated-from-name" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-[#d4af37]">
                    <p class="text-[11px] text-[#1f271b]/50 mt-1.5">Used in the storefront URL. Must be unique.</p>
                </div>
                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">DESCRIPTION</label>
                    <textarea autocomplete="srk-no-autofill" spellcheck="false" id="input-prod-desc" rows="4" placeholder="Enter product description..." class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37] resize-y max-h-[200px]">${window.escapeProductText(p.description)}</textarea>
                </div>

                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">FEATURED DESCRIPTION</label>
                    <textarea autocomplete="srk-no-autofill" spellcheck="false" id="input-prod-featured-desc" rows="3" maxlength="300" placeholder="Short hero line for the storefront slideshow..." class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37] resize-y max-h-[160px]">${window.escapeProductText(p.featured_description)}</textarea>
                    <p class="text-[11px] text-[#1f271b]/50 mt-1.5">Used only on the storefront featured slideshow &mdash; independent of the description above. Blank falls back to a house line.</p>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">CATEGORY</label>
                        <select autocomplete="srk-no-autofill" id="input-prod-category" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37]">
                            <option value="">Uncategorised</option>
                            ${categoryOptions}
                            ${orphanCategory ? `<option value="${window.escapeProductText(p.category_id)}" selected>Category #${window.escapeProductText(p.category_id)} (deleted)</option>` : ''}
                        </select>
                        ${window.productCategories.length === 0 ? `<p class="text-[11px] text-red-500 mt-1.5">Category list unavailable — saving will keep it uncategorised.</p>` : ''}
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">PRICE</label>
                        <input autocomplete="srk-no-autofill" spellcheck="false" id="input-prod-price" type="text" maxlength="60" value="${window.escapeProductText(p.price)}" placeholder="66000" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37]">
                        <p class="text-[11px] text-[#1f271b]/50 mt-1.5">Number only &mdash; &#8377;, commas and <span class="font-mono">/ unit</span> are added automatically. Blank shows &ldquo;On request&rdquo;.</p>
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">ASSET FOLDER</label>
                    <input autocomplete="srk-no-autofill" spellcheck="false" id="input-prod-folder" type="text" value="${window.escapeProductText(p.asset_folder)}" placeholder="Frame Master" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-[#d4af37]">
                    <p class="text-[11px] text-[#1f271b]/50 mt-1.5">Folder under <span class="font-mono">assets/products/</span> holding this product's gallery.</p>
                </div>

                <div class="pt-4 border-t border-[#12170f]/10 space-y-5">
                    <div class="flex items-center justify-between gap-4">
                        <div>
                            <label class="block text-sm font-bold text-[#1f271b]">Active on store</label>
                            <p class="text-xs text-[#1f271b]/60">Customers can see this product</p>
                        </div>
                        ${window.renderToggleSwitch(p.is_active !== false, 'window.toggleSwitchState(this)', 'Active on store', 'toggle-prod-active')}
                    </div>
                    <div class="flex items-center justify-between gap-4">
                        <div>
                            <label class="block text-sm font-bold text-[#1f271b]">Featured Product</label>
                            <p class="text-xs text-[#1f271b]/60">Show this product on the storefront homepage</p>
                        </div>
                        ${window.renderToggleSwitch(p.is_featured === true, 'window.toggleSwitchState(this)', 'Featured product', 'toggle-prod-featured')}
                    </div>
                    <div class="flex items-center justify-between gap-4">
                        <div>
                            <label class="block text-sm font-bold text-[#1f271b]">Best Seller</label>
                            <p class="text-xs text-[#1f271b]/60">Include in the Best Sellers carousel</p>
                        </div>
                        ${window.renderToggleSwitch(p.is_best_seller === true, 'window.toggleSwitchState(this)', 'Best seller', 'toggle-prod-bestseller')}
                    </div>
                    <div class="flex items-center justify-between gap-4">
                        <div>
                            <label class="block text-sm font-bold text-[#1f271b]">New Arrival</label>
                            <p class="text-xs text-[#1f271b]/60">Include in the New Arrivals carousel</p>
                        </div>
                        ${window.renderToggleSwitch(p.is_new_arrival === true, 'window.toggleSwitchState(this)', 'New arrival', 'toggle-prod-newarrival')}
                    </div>
                </div>
            </div>

            <div class="sticky bottom-0 w-full bg-white border-t border-gray-200 py-4 mt-8 z-50">
                <div class="flex gap-3">
                    <button id="save-product-btn" onclick="window.saveProductData('${p.id}')" class="flex-1 bg-[#420c14] text-white py-3 rounded-sm font-bold text-sm hover:bg-[#5e1220] transition-colors">Save Product</button>
                    <button onclick="app.closeDrawer()" class="flex-1 bg-white border border-[#12170f]/10 text-[#12170f] py-3 rounded-sm font-bold text-sm hover:bg-gray-50 transition-colors">Cancel</button>

                    ${!isNew ? `
                    <button onclick="window.deleteProduct('${p.id}')" title="Delete Product" class="flex items-center justify-center bg-white border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600 px-4 py-3 rounded-sm transition-colors group">
                        <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                    ` : ''}
                </div>
            </div>

        </div>
    `, isNew ? 'NEW PRODUCT' : 'EDIT PRODUCT', isNew ? '' : `<div class="bg-white border border-[#12170f]/10 text-[#d4af37] px-3 py-1.5 rounded-sm text-sm font-bold tracking-wide">PRD-${window.escapeProductText(p.id)}</div>`);

    // The grid is painted after openDrawer() injects the markup, since its
    // container only exists from that point on.
    window.paintProductImageSlots();
};
