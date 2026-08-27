window.categoryData = [];
// category id -> number of products assigned to it. Never read off the category
// row: it is recounted from the products list on every fetch, so the Products
// column cannot drift from what the Products tab actually holds.
window.categoryProductCounts = {};
window.currentCategoryImageFile = null;
// Set by the drawer's Remove button. Sent to the API on save so the cover is
// deleted from the bucket — clearing the preview alone left the object behind.
window.categoryImageRemoved = false;
window.categoryLoadError = null;

// Everything below stringifies HTML, so admin-entered text is escaped before it is
// interpolated — a stray quote in a category name would otherwise break the
// surrounding attribute, and a tag would be executed by the dashboard.
window.escapeCategoryText = function(value) {
    return (value ?? '')
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

window.slugifyCategory = function(value) {
    return (value || '')
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

// Shared switch markup so the table rows and the drawer stay identical, and so the
// dashboard reads the same as the Upcoming Projects toggles.
window.renderToggleSwitch = function(isOn, onClickExpr, label, id = '') {
    return `
        <button type="button" role="switch" aria-checked="${isOn}" aria-label="${label}" ${id ? `id="${id}"` : ''}
            onclick="event.stopPropagation(); ${onClickExpr}"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#420c14] focus-visible:ring-offset-2 ${isOn ? 'bg-[#420c14]' : 'bg-[#12170f]/20'}">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isOn ? 'translate-x-6' : 'translate-x-1'}"></span>
        </button>`;
};

// Flips a switch that has no row behind it yet (the drawer fields).
window.toggleSwitchState = function(btn) {
    const isOn = btn.getAttribute('aria-checked') === 'true';
    const knob = btn.firstElementChild;

    btn.setAttribute('aria-checked', String(!isOn));
    btn.classList.toggle('bg-[#420c14]', !isOn);
    btn.classList.toggle('bg-[#12170f]/20', isOn);
    knob.classList.toggle('translate-x-6', !isOn);
    knob.classList.toggle('translate-x-1', isOn);
};

// ==========================================
// PRODUCT COUNT (derived, never stored)
// ==========================================
// Products carry a category_id; categories carry no count of their own. This is
// the one place the two are joined — one pass over the product list, not one
// lookup per row.
window.countProductsPerCategory = function(products) {
    const counts = {};

    (Array.isArray(products) ? products : []).forEach(product => {
        const id = product && product.category_id;
        if (id === null || id === undefined || id === '') return;

        const key = String(id);
        counts[key] = (counts[key] || 0) + 1;
    });

    return counts;
};

// Single reader for the table row and the drawer, so both always agree.
window.getCategoryProductCount = function(categoryId) {
    return window.categoryProductCounts[String(categoryId)] || 0;
};

// ==========================================
// DATA
// ==========================================
window.fetchCategories = async function() {
    const request = (url) => window.adminAuth.fetch(url, { cache: 'no-store' });

    try {
        // Products come down alongside the categories because the Products column
        // is counted here rather than read from the category row.
        const [categoryRes, productRes] = await Promise.all([
            request('/api/categories'),
            request('/api/products')
        ]);

        const result = await categoryRes.json();
        if (!categoryRes.ok) throw new Error(result.error || "Failed to fetch categories");

        window.categoryData = Array.isArray(result) ? result : [];
        window.categoryLoadError = null;

        // A failed product list is not fatal — the categories still render, every
        // count just reads zero.
        const products = productRes.ok ? await productRes.json() : [];
        window.categoryProductCounts = window.countProductsPerCategory(products);
    } catch (error) {
        console.error("Error fetching categories:", error);
        window.categoryData = [];
        window.categoryProductCounts = {};
        window.categoryLoadError = error.message || "Could not reach the server.";
    }
};

// Entry point used by app.switchTab() — fetches, then paints.
window.renderCategories = async function() {
    await window.fetchCategories();
    window.paintCategories();
};

// ==========================================
// TABLE
// ==========================================
window.paintCategories = function() {
    const container = document.getElementById('main-content');

    // A response that lands after the user has moved on must not hijack the view.
    if (!container || (app.currentTab && app.currentTab !== 'categories')) return;

    const total = window.categoryData.length;
    const active = window.categoryData.filter(c => c.is_active !== false).length;

    const placeholderIcon = `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>`;

    let rows;
    if (window.categoryLoadError) {
        rows = `<tr><td colspan="5" class="py-10 text-center">
            <p class="text-red-600 font-bold text-sm">${window.categoryLoadError}</p>
            <button onclick="window.renderCategories()" class="mt-3 text-xs font-bold text-[#d4af37] hover:underline">Retry</button>
        </td></tr>`;
    } else if (total === 0) {
        rows = `<tr><td colspan="5" class="py-10 text-center text-[#1f271b]/40 font-semibold">No categories yet. Add one to get started.</td></tr>`;
    } else {
        rows = window.categoryData.map(c => {
            const isActive = c.is_active !== false;
            const badge = isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
            const parent = window.categoryData.find(p => p.id === c.parent_id);
            const name = window.escapeCategoryText(c.name);

            return `
            <tr id="row-cat-${c.id}" onclick="window.handleCategoryAction('${c.id}')" class="cursor-pointer transition-colors ${app.activeItemId == c.id ? 'bg-[#d4af37]/5 border-l-2 border-l-[#d4af37]' : 'hover:bg-gray-50'}">
                <td class="py-3 px-5">
                    <div class="relative w-12 h-12 bg-[#f8fafc] border border-[#12170f]/10 rounded-sm overflow-hidden flex items-center justify-center text-[#d4af37] shrink-0">
                        ${placeholderIcon}
                        ${c.image_url ? `<img src="${c.image_url}" alt="${name}" class="absolute inset-0 w-full h-full object-cover" onerror="this.style.display='none'">` : ''}
                    </div>
                </td>
                <td class="py-3 px-5">
                    <p class="text-[#1f271b] font-bold text-base">${name}${c.is_featured ? ` <span class="ml-1 align-middle px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wider bg-[#d4af37]/15 text-[#a8862a]">Featured</span>` : ''}</p>
                    <p class="text-[#1f271b]/60 text-xs mt-0.5 max-w-xs truncate">${c.description ? window.escapeCategoryText(c.description) : 'No description added.'}</p>
                    ${parent ? `<p class="text-[#1f271b]/40 text-[10px] mt-1 font-bold uppercase tracking-wider">In ${window.escapeCategoryText(parent.name)}</p>` : ''}
                </td>
                <td class="py-3 px-5 font-bold text-lg">${window.getCategoryProductCount(c.id)}</td>
                <td class="py-3 px-5">
                    <div class="flex items-center gap-3">
                        <span class="px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider ${badge}">${isActive ? 'Active' : 'Inactive'}</span>
                        ${window.renderToggleSwitch(isActive, `window.toggleCategoryStatus('${c.id}')`, `Show ${name} on the store`)}
                    </div>
                </td>
                <td class="py-3 px-5 text-right relative">
                    <button onclick="window.toggleCategoryDropdown(event, '${c.id}')" title="Actions" aria-label="Actions for ${name}" class="text-[#1f271b]/50 hover:text-[#d4af37] focus:outline-none transition-colors p-1 rounded hover:bg-gray-200">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                    </button>
                    <div id="dropdown-cat-${c.id}" class="hidden absolute right-5 top-10 bg-white border border-[#12170f]/10 shadow-lg rounded-sm w-40 z-20 text-left overflow-hidden">
                        <button onclick="event.stopPropagation(); window.handleCategoryAction('${c.id}')" class="block w-full text-left px-4 py-2.5 text-sm text-[#1f271b] font-semibold hover:bg-gray-50 transition-colors">Edit Category</button>
                        <button onclick="event.stopPropagation(); window.deleteCategory('${c.id}')" class="block w-full text-left px-4 py-2.5 text-sm text-red-600 font-semibold hover:bg-red-50 transition-colors border-t border-gray-100">Delete Category</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    const ui = window.adminDashboardUI;
    container.innerHTML = `
        <div class="max-w-7xl mx-auto pb-10">
        ${ui.hero('Catalogue structure', 'Categories', 'Organise the catalogue into clear, useful collections for shoppers.', ui.primaryAction('Add category', "window.handleCategoryAction('new')"))}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 max-w-3xl">
            ${ui.stat('Total categories', total, 'All catalogue groups', 'gold', 'categories')}
            ${ui.stat('Active categories', active, `${total - active} currently hidden`, 'green', 'check')}
        </div>

        <section class="bg-white border border-[#12170f]/10 rounded-xl overflow-visible mb-6 shadow-[0_10px_35px_rgba(18,23,15,0.04)]">
            <div class="px-5 py-5 border-b border-[#12170f]/10">
                <p class="text-[10px] uppercase tracking-[0.18em] font-bold text-[#d4af37]">Catalogue navigation</p>
                <h3 class="text-xl text-[#12170f] mt-1">Category list</h3>
            </div>
            <table class="w-full text-left border-collapse">
                <thead><tr class="bg-[#f8fafc] border-b border-[#12170f]/10 text-xs text-[#12170f]/40 uppercase tracking-wide font-bold">
                    <th class="py-4 px-5 w-24">Image</th><th class="py-4 px-5">Category Name</th>
                    <th class="py-4 px-5 w-32">Products</th><th class="py-4 px-5 w-48">Status</th><th class="py-4 px-5 w-28 text-right">Actions</th>
                </tr></thead>
                <tbody class="text-sm font-semibold divide-y divide-[#12170f]/5">${rows}</tbody>
            </table>
        </section>
        </div>
    `;
};

window.toggleCategoryDropdown = function(event, id) {
    event.stopPropagation();
    const dropdown = document.getElementById(`dropdown-cat-${id}`);
    const isHidden = dropdown.classList.contains('hidden');
    document.querySelectorAll('[id^="dropdown-cat-"]').forEach(el => el.classList.add('hidden'));
    if (isHidden) dropdown.classList.remove('hidden');
};

document.addEventListener('click', () => {
    document.querySelectorAll('[id^="dropdown-cat-"]').forEach(el => el.classList.add('hidden'));
});

// ==========================================
// STATUS TOGGLE (optimistic, rolls back on failure)
// ==========================================
window.toggleCategoryStatus = async function(id) {
    const category = window.categoryData.find(c => c.id == id);
    if (!category) return;

    const nextState = category.is_active === false;
    category.is_active = nextState;
    window.paintCategories();

    try {
        const res = await window.adminAuth.fetch(`/api/categories/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: nextState })
        });
        if (!res.ok) throw new Error('Status update failed');
    } catch (error) {
        category.is_active = !nextState;
        window.paintCategories();
        alert('Failed to update category status.');
    }
};

// ==========================================
// IMAGE UPLOAD (same contract as the project cover: <id>-cover, .avif/.webp)
// ==========================================
window.updateCategoryImageUIState = function(hasImage, srcUrl = '') {
    const preview = document.getElementById('category-image-preview');
    const placeholder = document.getElementById('category-image-placeholder');
    const actionBtns = document.getElementById('category-image-actions');
    const container = document.getElementById('category-image-container');

    if (!preview || !placeholder || !actionBtns) return;

    if (hasImage) {
        if (srcUrl) preview.src = srcUrl;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');

        actionBtns.className = "flex gap-2 absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-sm p-1.5 rounded-sm shadow-md";

        if (container) {
            container.classList.remove('p-6', 'border-dashed');
            container.classList.add('p-2', 'border-solid');
        }
    } else {
        preview.src = '';
        preview.classList.add('hidden');
        placeholder.classList.remove('hidden');

        actionBtns.className = "flex gap-2 relative z-10 mt-2 opacity-100 transition-opacity";

        if (container) {
            container.classList.add('p-6', 'border-dashed');
            container.classList.remove('p-2', 'border-solid');
        }
    }
};

window.previewCategoryImage = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const allowedMimeTypes = ['image/avif', 'image/webp'];
    const fileExt = file.name.split('.').pop().toLowerCase();

    if (!allowedMimeTypes.includes(file.type) && !['avif', 'webp'].includes(fileExt)) {
        alert("Invalid file format! Only .avif and .webp image formats are allowed.");
        event.target.value = '';
        return;
    }

    // Picking a new file overrides a pending removal.
    window.currentCategoryImageFile = file;
    window.categoryImageRemoved = false;
    window.setCategoryImageHint('Only .avif, .webp allowed', false);

    const reader = new FileReader();
    reader.onload = (e) => window.updateCategoryImageUIState(true, e.target.result);
    reader.readAsDataURL(file);
};

// Marks the cover for deletion. The object is removed from the bucket when the
// category is saved, so Cancel still leaves the existing image untouched.
window.removeCategoryImage = function() {
    window.currentCategoryImageFile = null;
    window.categoryImageRemoved = true;

    const input = document.getElementById('category-image-input');
    if (input) input.value = "";

    window.updateCategoryImageUIState(false);
    window.setCategoryImageHint('Image will be deleted from storage on save', true);
};

window.setCategoryImageHint = function(text, isWarning) {
    const hint = document.getElementById('category-image-hint');
    if (!hint) return;
    hint.textContent = text;
    hint.className = isWarning
        ? 'text-[11px] font-semibold text-red-500'
        : 'text-[11px] font-semibold text-[#d4af37]';
};

// Slug follows the name only until the admin edits it by hand. Existing
// categories start "touched" so renaming never silently breaks a live store URL.
window.syncCategorySlug = function() {
    const slugInput = document.getElementById('input-cat-slug');
    const nameInput = document.getElementById('input-cat-name');
    if (!slugInput || !nameInput || slugInput.dataset.touched === 'true') return;
    slugInput.value = window.slugifyCategory(nameInput.value);
};

// ==========================================
// SAVE / DELETE
// ==========================================
window.saveCategoryData = async function(id) {
    const btn = document.getElementById('save-category-btn');
    const name = document.getElementById('input-cat-name').value.trim();

    if (!name) {
        alert('Category name is required.');
        return;
    }

    btn.innerText = 'Saving...';
    btn.disabled = true;

    const formData = new FormData();
    formData.append('id', id);
    formData.append('name', name);
    formData.append('url_slug', document.getElementById('input-cat-slug').value.trim());
    formData.append('description', document.getElementById('input-cat-desc').value.trim());
    formData.append('parent_id', document.getElementById('input-cat-parent').value);
    formData.append('is_featured', document.getElementById('toggle-cat-featured').getAttribute('aria-checked'));
    formData.append('is_active', document.getElementById('toggle-cat-active').getAttribute('aria-checked'));

    if (window.currentCategoryImageFile) {
        formData.append('image', window.currentCategoryImageFile);
    } else if (window.categoryImageRemoved) {
        formData.append('remove_image', 'true');
    }

    try {
        const response = await window.adminAuth.fetch('/api/categories', {
            method: 'POST',
            body: formData
        });

        const responseData = await response.json();
        if (!response.ok) throw new Error(responseData.error || "Save failed");

        if (app && typeof app.closeDrawer === 'function') app.closeDrawer();
        await window.renderCategories();
    } catch (error) {
        console.error(error);
        alert(error.message || 'Failed to save category.');
        btn.innerText = 'Save Category';
        btn.disabled = false;
    }
};

window.deleteCategory = async function(id) {
    const category = window.categoryData.find(c => c.id == id);
    if (app && typeof app.closeDrawer === 'function') app.closeDrawer();

    const childCount = window.categoryData.filter(c => c.parent_id == id).length;
    const warning = childCount > 0
        ? `\n\n${childCount} sub-categor${childCount === 1 ? 'y' : 'ies'} will be moved to the top level.`
        : '';

    if (!confirm(`Delete "${category ? category.name : id}"? Its cover image is removed too.${warning}`)) return;

    const row = document.getElementById(`row-cat-${id}`);
    if (row) {
        row.style.opacity = '0';
        row.style.transform = 'translateX(-20px)';
        row.style.backgroundColor = '#fee2e2';
    }

    try {
        const res = await window.adminAuth.fetch(`/api/categories/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error("Delete failed");

        setTimeout(() => window.renderCategories(), 300);
    } catch (error) {
        alert("Failed to delete category.");
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
window.handleCategoryAction = function(id) {
    app.activeItemId = id;
    window.paintCategories();
    window.currentCategoryImageFile = null;
    window.categoryImageRemoved = false;

    const isNew = id === 'new';
    const c = isNew
        ? { id: 'new', name: '', url_slug: '', description: '', parent_id: null, is_active: true, is_featured: false, image_url: '' }
        : window.categoryData.find(x => x.id == id);

    if (!c) return;

    // Read-only in the drawer: the number comes from the products list, so there
    // is nothing here for the admin to type.
    const productCount = isNew ? 0 : window.getCategoryProductCount(c.id);

    const parentOptions = window.categoryData
        .filter(option => option.id != c.id)
        .map(option => `<option value="${option.id}" ${option.id == c.parent_id ? 'selected' : ''}>${window.escapeCategoryText(option.name)}</option>`)
        .join('');

    app.openDrawer(`
        <div class="flex flex-col h-full relative bg-white">

            <div class="space-y-6">
                <input autocomplete="srk-no-autofill" type="file" id="category-image-input" accept=".avif, .webp, image/avif, image/webp" class="hidden" onchange="window.previewCategoryImage(event)" />

                <div>
                    <div class="flex justify-between items-center mb-2">
                        <label class="block text-xs font-bold text-[#1f271b]/80 uppercase tracking-wide">CATEGORY IMAGE</label>
                        <span id="category-image-hint" class="text-[11px] font-semibold text-[#d4af37]">Only .avif, .webp allowed</span>
                    </div>

                    <div id="category-image-container" class="w-full h-auto min-h-[180px] bg-[#f8fafc] border-2 border-dashed border-[#12170f]/20 rounded-sm p-6 flex flex-col items-center justify-center relative group overflow-hidden transition-all hover:border-[#d4af37]/50">
                        <img id="category-image-preview" src="" class="hidden max-w-full h-auto max-h-[220px] rounded object-contain" />

                        <div id="category-image-placeholder" class="text-[#12170f]/40 flex flex-col items-center">
                            <svg class="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            <span class="text-sm font-semibold">Image Preview</span>
                            <span class="text-xs text-[#1f271b]/50 mt-1 font-medium">Shown as a square thumbnail in the table</span>
                        </div>

                        <div id="category-image-actions" class="flex gap-2 relative z-10 mt-2">
                            <button type="button" onclick="document.getElementById('category-image-input').click()" class="bg-white border border-[#12170f]/10 text-[#12170f] px-3 py-1.5 rounded-sm text-xs font-bold shadow-sm hover:bg-gray-50 transition-colors">Change</button>
                            <button type="button" onclick="window.removeCategoryImage()" class="bg-white border border-red-200 text-red-500 px-3 py-1.5 rounded-sm text-xs font-bold shadow-sm hover:bg-red-50 transition-colors">Remove</button>
                        </div>
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">NAME <span class="text-red-500">*</span></label>
                    <input autocomplete="srk-no-autofill" spellcheck="false" id="input-cat-name" type="text" required value="${window.escapeCategoryText(c.name)}" oninput="window.syncCategorySlug()" placeholder="Enter category name" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37]">
                </div>
                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">URL SLUG</label>
                    <input autocomplete="srk-no-autofill" spellcheck="false" id="input-cat-slug" type="text" value="${window.escapeCategoryText(c.url_slug)}" data-touched="${isNew ? 'false' : 'true'}" oninput="this.dataset.touched='true'" placeholder="auto-generated-from-name" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-[#d4af37]">
                    <p class="text-[11px] text-[#1f271b]/50 mt-1.5">Used in the storefront URL. Must be unique.</p>
                </div>
                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">DESCRIPTION</label>
                    <textarea autocomplete="srk-no-autofill" spellcheck="false" id="input-cat-desc" rows="4" placeholder="Enter category description..." class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37] resize-y max-h-[200px]">${window.escapeCategoryText(c.description)}</textarea>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">PRODUCTS</label>
                        <div id="cat-product-count" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm font-bold text-[#1f271b]/70">${productCount}</div>
                        <p class="text-[11px] text-[#1f271b]/50 mt-1.5">Counted from the Products tab. Assign a product to this category to change it.</p>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">PARENT CATEGORY</label>
                        <select autocomplete="srk-no-autofill" id="input-cat-parent" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37]">
                            <option value="">None (top level)</option>
                            ${parentOptions}
                        </select>
                    </div>
                </div>

                <div class="pt-4 border-t border-[#12170f]/10 space-y-5">
                    <div class="flex items-center justify-between gap-4">
                        <div>
                            <label class="block text-sm font-bold text-[#1f271b]">Active on store</label>
                            <p class="text-xs text-[#1f271b]/60">Customers can browse this category</p>
                        </div>
                        ${window.renderToggleSwitch(c.is_active !== false, 'window.toggleSwitchState(this)', 'Active on store', 'toggle-cat-active')}
                    </div>
                    <div class="flex items-center justify-between gap-4">
                        <div>
                            <label class="block text-sm font-bold text-[#1f271b]">Featured Category</label>
                            <p class="text-xs text-[#1f271b]/60">Show this category on the storefront homepage</p>
                        </div>
                        ${window.renderToggleSwitch(c.is_featured === true, 'window.toggleSwitchState(this)', 'Featured category', 'toggle-cat-featured')}
                    </div>
                </div>
            </div>

            <div class="sticky bottom-0 w-full bg-white border-t border-gray-200 py-4 mt-8 z-50">
                <div class="flex gap-3">
                    <button id="save-category-btn" onclick="window.saveCategoryData('${c.id}')" class="flex-1 bg-[#420c14] text-white py-3 rounded-sm font-bold text-sm hover:bg-[#5e1220] transition-colors">Save Category</button>
                    <button onclick="app.closeDrawer()" class="flex-1 bg-white border border-[#12170f]/10 text-[#12170f] py-3 rounded-sm font-bold text-sm hover:bg-gray-50 transition-colors">Cancel</button>

                    ${!isNew ? `
                    <button onclick="window.deleteCategory('${c.id}')" title="Delete Category" class="flex items-center justify-center bg-white border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600 px-4 py-3 rounded-sm transition-colors group">
                        <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                    ` : ''}
                </div>
            </div>

        </div>
    `, isNew ? 'NEW CATEGORY' : 'EDIT CATEGORY', isNew ? '' : `<div class="bg-white border border-[#12170f]/10 text-[#d4af37] px-3 py-1.5 rounded-sm text-sm font-bold tracking-wide">CAT-${c.id}</div>`);

    // Probe the URL directly instead of relying on inline onload/onerror, which the
    // drawer's innerHTML injection swallows (same fix as the projects drawer).
    if (c.image_url && !isNew) {
        const img = new Image();
        img.onload = function() { window.updateCategoryImageUIState(true, this.src); };
        img.onerror = function() { window.updateCategoryImageUIState(false); };
        img.src = c.image_url;
    } else {
        window.updateCategoryImageUIState(false);
    }
};
