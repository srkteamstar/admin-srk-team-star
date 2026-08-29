window.projectData = [];
window.currentProjectImageFile = null;
// Set by the drawer's Remove button. Sent to the API on save so the cover is
// deleted from the bucket — clearing the preview alone left the object behind.
window.projectImageRemoved = false;
window.upcomingSectionVisible = true;

// Project copy is stored data and is rendered through innerHTML below. Escape
// it at every HTML/attribute boundary so a malformed or hand-edited database
// row cannot become script in an administrator's session.
window.escapeProjectText = function(value) {
    return (value ?? '').toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// Initialization Fetch with Strict Cache Bypassing
window.fetchUpcomingProjects = async function() {
    try {
        const response = await window.adminAuth.fetch('/api/projects?limit=250', {
            cache: 'no-store'
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Failed to fetch projects");
        }

        window.projectData = Array.isArray(result) ? result : [];

        const settingsRes = await window.adminAuth.fetch('/api/settings/upcoming-projects-visibility', {
            cache: 'no-store'
        });
        if (settingsRes.ok) {
            window.upcomingSectionVisible = (await settingsRes.json()).section_visible;
        }

        window.paintUpcomingProjects();
    } catch (error) {
        console.error("Error fetching projects:", error);
        window.paintUpcomingProjects();
    }
};

// Entry point app.switchTab() calls. Fetching here (instead of on script load)
// is what keeps this module from painting over whichever tab is actually open.
window.renderUpcomingProjects = async function() {
    await window.fetchUpcomingProjects();
};

window.paintUpcomingProjects = function() {
    const container = document.getElementById('main-content');

    // A response that lands after the user has moved on must not hijack the view.
    if (!container || (app.currentTab && app.currentTab !== 'upcoming-projects')) return;

    // The section toggle is the master switch. With it off the section is not on
    // the website at all, so the table below should not read as live or be
    // editable — it goes monochrome and stops accepting input entirely.
    const sectionHidden = window.upcomingSectionVisible === false;
    const ui = window.adminDashboardUI;
    const visibleProjects = window.projectData.filter(project => project.is_visible !== false).length;

    let rows = window.projectData.length === 0
        ? `<tr><td colspan="7" class="py-8 text-center text-[#1f271b]/40 font-semibold">No projects found. Create one to get started.</td></tr>`
        : window.projectData.map(p => {
            const id = window.escapeProjectText(p.id);
            const category = window.escapeProjectText(p.project_category_title || '-');
            const name = window.escapeProjectText(p.project_name || '-');
            const description = window.escapeProjectText(p.project_description || '-');
            const dueDate = window.escapeProjectText(p.due_date || '-');
            return `
        <tr id="row-${id}" class="transition-all duration-300 ease-out hover:bg-gray-50 group ${p.is_visible === false ? 'opacity-50' : ''}">
            <td class="py-4 px-5 text-[#1f271b]/70 font-mono text-xs">${id}</td>
            <td class="py-4 px-5 text-[#1f271b]/70">${category}</td>
            <td class="py-4 px-5 text-[#1f271b] font-bold cursor-pointer hover:text-[#d4af37]" onclick="window.handleProjectAction('${id}')">${name}</td>
            <td class="py-4 px-5 text-[#1f271b]/60 truncate max-w-[200px] cursor-pointer" onclick="window.handleProjectAction('${id}')">${description}</td>
            <td class="py-4 px-5 font-bold text-xs">${dueDate}</td>
            <td class="py-4 px-5 w-[150px] min-w-[150px]">
                ${window.renderToggle(`toggle-project-${id}`, p.is_visible !== false, `window.toggleProjectVisibility('${id}')`, p.is_visible === false ? 'Hidden' : 'Live')}
            </td>
            <td class="py-4 px-5 text-right relative">
                <button onclick="window.toggleDropdown(event, '${id}')" class="text-[#1f271b]/40 hover:text-[#d4af37] focus:outline-none transition-colors p-1 rounded hover:bg-gray-200">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                </button>
                <div id="dropdown-${id}" class="hidden absolute right-5 top-10 bg-white border border-[#12170f]/10 shadow-lg rounded-sm w-36 z-20 text-left overflow-hidden">
                    <button onclick="window.handleProjectAction('${id}')" class="block w-full text-left px-4 py-2.5 text-sm text-[#1f271b] font-semibold hover:bg-gray-50 transition-colors">Edit Project</button>
                    <button onclick="window.deleteProject('${id}')" class="block w-full text-left px-4 py-2.5 text-sm text-red-600 font-semibold hover:bg-red-50 transition-colors border-t border-gray-100">Delete Project</button>
                </div>
            </td>
        </tr>
    `; }).join('');

    container.innerHTML = `
        <div class="max-w-7xl mx-auto pb-10">
        ${ui.hero('Operations planning', 'Upcoming Projects', 'Plan visible initiatives and control exactly what appears on the storefront.', ui.primaryAction('Add project', "window.handleProjectAction('new')"))}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 max-w-3xl">
            ${ui.stat('Total projects', window.projectData.length, 'All planned initiatives', 'gold', 'calendar')}
            ${ui.stat('Visible projects', visibleProjects, sectionHidden ? 'The entire section is currently hidden' : 'Currently published to the storefront', sectionHidden ? 'wine' : 'green', sectionHidden ? 'hidden' : 'check')}
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#12170f]/10 rounded-xl px-5 py-5 mb-6 shadow-[0_8px_30px_rgba(18,23,15,0.04)]">
            <div>
                <p class="text-sm font-bold text-[#12170f]">Show section on website</p>
                <p class="text-xs text-[#1f271b]/60 mt-1">Turn off to hide the entire Upcoming Projects section from the homepage. Projects stay saved.</p>
            </div>
            ${window.renderToggle('toggle-section', window.upcomingSectionVisible, 'window.toggleSectionVisibility()', window.upcomingSectionVisible ? 'Visible' : 'Hidden')}
        </div>
        ${sectionHidden ? `
        <div class="flex items-center gap-3 bg-[#f8fafc] border border-[#12170f]/10 border-l-2 border-l-[#1f271b]/40 rounded-sm px-4 py-3 mb-4">
            <svg class="w-4 h-4 shrink-0 text-[#1f271b]/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>
            <p class="text-xs font-semibold text-[#1f271b]/70">This section is hidden from the website. The project list below is read-only until you turn visibility back on.</p>
        </div>` : ''}

        <!-- pointer-events-none stops the mouse; inert also takes the rows, toggles
             and dropdowns out of the tab order, which pointer-events alone leaves
             reachable by keyboard. -->
        <section class="bg-white border border-[#12170f]/10 rounded-xl overflow-visible mb-6 shadow-[0_10px_35px_rgba(18,23,15,0.04)] transition-all duration-300 ${sectionHidden ? 'grayscale opacity-60 pointer-events-none select-none' : ''}" ${sectionHidden ? 'inert' : ''}>
            <div class="px-5 py-5 border-b border-[#12170f]/10">
                <p class="text-[10px] uppercase tracking-[0.18em] font-bold text-[#d4af37]">Storefront roadmap</p>
                <h3 class="text-xl text-[#12170f] mt-1">Project list</h3>
            </div>
            <table class="w-full text-left border-collapse">
                <thead><tr class="bg-[#f8fafc] border-b border-[#12170f]/10 text-xs text-[#12170f]/40 uppercase tracking-wide font-bold">
                    <th class="py-4 px-5">PROJECT ID</th>
                    <th class="py-4 px-5">CATEGORY</th>
                    <th class="py-4 px-5">NAME</th>
                    <th class="py-4 px-5">DESCRIPTION</th>
                    <th class="py-4 px-5">DUE DATE</th>
                    <th class="py-4 px-5 w-[150px] min-w-[150px] whitespace-nowrap">VISIBILITY</th>
                    <th class="py-4 px-5 text-right">ACTIONS</th>
                </tr></thead>
                <tbody class="text-sm font-semibold divide-y divide-[#12170f]/5">
                    ${rows}
                </tbody>
            </table>
        </section>
        </div>
    `;
};

window.renderToggle = function(id, isOn, onClickExpr, labelText) {
    return `
        <div class="flex items-center gap-3">
            <button id="${id}" type="button" role="switch" aria-checked="${isOn}" onclick="event.stopPropagation(); ${onClickExpr}"
                class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#420c14] focus-visible:ring-offset-2 ${isOn ? 'bg-[#420c14]' : 'bg-[#12170f]/20'}">
                <span class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isOn ? 'translate-x-6' : 'translate-x-1'}"></span>
            </button>
            <span class="text-xs font-bold w-[52px] shrink-0 whitespace-nowrap ${isOn ? 'text-[#420c14]' : 'text-[#1f271b]/40'}">${labelText}</span>
        </div>
    `;
};

window.toggleProjectVisibility = async function(id) {
    const project = window.projectData.find(x => x.id == id);
    if (!project) return;

    const nextState = project.is_visible === false;
    project.is_visible = nextState;
    window.paintUpcomingProjects();

    try {
        const res = await window.adminAuth.fetch(`/api/projects/${id}/visibility`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_visible: nextState })
        });
        if (!res.ok) throw new Error('Visibility update failed');
    } catch (error) {
        project.is_visible = !nextState;
        window.paintUpcomingProjects();
        alert('Failed to update project visibility.');
    }
};

window.toggleSectionVisibility = async function() {
    const nextState = !window.upcomingSectionVisible;
    window.upcomingSectionVisible = nextState;
    window.paintUpcomingProjects();

    try {
        const res = await window.adminAuth.fetch('/api/settings/upcoming-projects-visibility', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section_visible: nextState })
        });
        if (!res.ok) throw new Error('Section visibility update failed');
    } catch (error) {
        window.upcomingSectionVisible = !nextState;
        window.paintUpcomingProjects();
        alert('Failed to update section visibility.');
    }
};

window.toggleDropdown = function(event, id) {
    event.stopPropagation();
    const dropdown = document.getElementById(`dropdown-${id}`);
    const isHidden = dropdown.classList.contains('hidden');
    document.querySelectorAll('[id^="dropdown-"]').forEach(el => el.classList.add('hidden'));
    if (isHidden) dropdown.classList.remove('hidden');
};

document.addEventListener('click', () => {
    document.querySelectorAll('[id^="dropdown-"]').forEach(el => el.classList.add('hidden'));
});

window.updateImageUIState = function(hasImage, srcUrl = '') {
    const preview = document.getElementById('demo-image-preview');
    const placeholder = document.getElementById('demo-image-placeholder');
    const actionBtns = document.getElementById('image-action-buttons');
    const container = document.getElementById('image-container');

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

window.previewProjectImage = function(event) {
    const file = event.target.files[0];
    if (file) {
        const allowedMimeTypes = ['image/avif', 'image/webp'];
        const fileExt = file.name.split('.').pop().toLowerCase();
        
        if (!allowedMimeTypes.includes(file.type) && !['avif', 'webp'].includes(fileExt)) {
            alert("Invalid file format! Only .avif and .webp image formats are allowed.");
            event.target.value = ''; 
            return;
        }

        // Picking a new file overrides a pending removal.
        window.currentProjectImageFile = file;
        window.projectImageRemoved = false;

        const reader = new FileReader();
        reader.onload = function(e) {
            window.updateImageUIState(true, e.target.result);
        }
        reader.readAsDataURL(file);
    }
};

// Marks the cover for deletion. The object is removed from the bucket when the
// project is saved, so Cancel still leaves the existing image untouched.
window.removeProjectImage = function() {
    window.currentProjectImageFile = null;
    window.projectImageRemoved = true;

    const input = document.getElementById('project-image-input');
    if (input) input.value = "";
    window.updateImageUIState(false);
};

window.deleteProject = async function(id) {
    if (app && typeof app.closeDrawer === 'function') app.closeDrawer();
    if(!confirm("Are you sure you want to delete this project?")) return;

    const row = document.getElementById(`row-${id}`);
    if (row) {
        row.style.opacity = '0';
        row.style.transform = 'translateX(-20px)';
        row.style.backgroundColor = '#fee2e2';
    }

    try {
        const res = await window.adminAuth.fetch(`/api/projects/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error("Delete failed");
        
        setTimeout(() => {
            window.fetchUpcomingProjects();
        }, 300);
    } catch (error) {
        alert("Failed to delete project.");
        if (row) {
            row.style.opacity = '1';
            row.style.transform = 'translateX(0)';
            row.style.backgroundColor = 'transparent';
        }
    }
};

window.saveProjectData = async function(id) {
    const btn = document.getElementById('save-project-btn');
    btn.innerText = 'Saving...';
    btn.disabled = true;

    const formData = new FormData();
    formData.append('id', id);
    formData.append('project_category_title', document.getElementById('input-category').value);
    formData.append('project_name', document.getElementById('input-name').value);
    formData.append('project_description', document.getElementById('input-desc').value);
    formData.append('due_date', document.getElementById('input-date').value);

    if (window.currentProjectImageFile) {
        formData.append('image', window.currentProjectImageFile);
    } else if (window.projectImageRemoved) {
        formData.append('remove_image', 'true');
    }

    try {
        const response = await window.adminAuth.fetch('/api/projects?limit=250', {
            method: 'POST',
            body: formData
        });
        
        const responseData = await response.json();

        if(!response.ok) {
            throw new Error(responseData.error || "Save failed");
        }
        
        await window.fetchUpcomingProjects();
        if (app && typeof app.closeDrawer === 'function') app.closeDrawer();

    } catch (error) {
        console.error(error);
        alert(error.message || 'Failed to save project data.');
    } finally {
        btn.innerText = 'Save Project';
        btn.disabled = false;
    }
};

window.handleProjectAction = function(id) {
    app.activeItemId = id;
    window.paintUpcomingProjects();
    window.currentProjectImageFile = null;
    window.projectImageRemoved = false;
    
    const p = id === 'new' 
        ? { id: 'new', project_name: '', project_category_title: '', project_description: '', due_date: '', image_url: '' } 
        : window.projectData.find(x => x.id == id);
    
    const imageUrlToLoad = (p.image_url && id !== 'new') ? `${p.image_url}?t=${new Date().getTime()}` : '';
    const safeProjectId = window.escapeProjectText(p.id);
    const safeCategory = window.escapeProjectText(p.project_category_title || '');
    const safeName = window.escapeProjectText(p.project_name || '');
    const safeDescription = window.escapeProjectText(p.project_description || '');
    const safeDueDate = window.escapeProjectText(p.due_date || '');
    
    app.openDrawer(`
        <div class="flex flex-col h-full relative bg-white">
            
            <div class="space-y-6">
                <input autocomplete="srk-no-autofill" type="file" id="project-image-input" accept=".avif, .webp, image/avif, image/webp" class="hidden" onchange="window.previewProjectImage(event)" />

                <div>
                    <div class="flex justify-between items-center mb-2">
                        <label class="block text-xs font-bold text-[#1f271b]/80 uppercase tracking-wide">PROJECT IMAGE <span class="text-red-500">*</span></label>
                        <span class="text-[11px] font-semibold text-[#d4af37]">Only .avif, .webp allowed</span>
                    </div>

                    <div id="image-container" class="w-full h-auto min-h-[160px] bg-[#f8fafc] border-2 border-dashed border-[#12170f]/20 rounded-sm p-6 flex flex-col items-center justify-center relative group overflow-hidden transition-all hover:border-[#d4af37]/50">
                        
                        <!-- Removed inline onload/onerror to fix SPA silent failing injection bugs -->
                        <img id="demo-image-preview" src="" class="hidden max-w-full h-auto max-h-[250px] rounded object-contain" />
                        
                        <div id="demo-image-placeholder" class="text-[#12170f]/40 flex flex-col items-center">
                            <svg class="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            <span class="text-sm font-semibold">Image Preview</span>
                            <span class="text-xs text-[#1f271b]/50 mt-1 font-medium">Allowed formats: <strong class="text-[#1f271b]/80">.avif</strong>, <strong class="text-[#1f271b]/80">.webp</strong></span>
                        </div>
                        
                        <div id="image-action-buttons" class="flex gap-2 relative z-10 mt-2">
                            <button type="button" onclick="document.getElementById('project-image-input').click()" class="bg-white border border-[#12170f]/10 text-[#12170f] px-3 py-1.5 rounded-sm text-xs font-bold shadow-sm hover:bg-gray-50 transition-colors">Change</button>
                            <button type="button" onclick="window.removeProjectImage()" class="bg-white border border-red-200 text-red-500 px-3 py-1.5 rounded-sm text-xs font-bold shadow-sm hover:bg-red-50 transition-colors">Remove</button>
                        </div>
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">CATEGORY <span class="text-red-500">*</span></label>
                    <input autocomplete="srk-no-autofill" spellcheck="false" id="input-category" type="text" required value="${safeCategory}" placeholder="Enter category title" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37]">
                </div>
                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">NAME <span class="text-red-500">*</span></label>
                    <input autocomplete="srk-no-autofill" spellcheck="false" id="input-name" type="text" required value="${safeName}" placeholder="Enter project name" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37]">
                </div>
                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">DESCRIPTION <span class="text-red-500">*</span></label>
                    <textarea autocomplete="srk-no-autofill" spellcheck="false" id="input-desc" rows="4" required placeholder="Detailed project overview..." class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37] resize-y max-h-[200px]">${safeDescription}</textarea>
                </div>
                <div>
                    <label class="block text-xs font-bold text-[#1f271b]/80 mb-2 uppercase tracking-wide">DUE DATE <span class="text-red-500">*</span></label>
                    <input autocomplete="srk-no-autofill" spellcheck="false" id="input-date" type="text" required value="${safeDueDate}" placeholder="DD MMM YYYY" class="w-full bg-[#f8fafc] border border-[#12170f]/10 rounded-sm px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4af37]">
                </div>
            </div>

            <!-- FIXED: Added sticky solid background block to fully mask fields scrolling behind it -->
            <div class="sticky bottom-0 w-full bg-white border-t border-gray-200 py-4 mt-8 z-50">
                <div class="flex gap-3">
                    <button id="save-project-btn" onclick="window.saveProjectData('${safeProjectId}')" class="flex-1 bg-[#420c14] text-white py-3 rounded-sm font-bold text-sm hover:bg-[#5e1220] transition-colors">Save Project</button>
                    <button onclick="app.closeDrawer()" class="flex-1 bg-white border border-[#12170f]/10 text-[#12170f] py-3 rounded-sm font-bold text-sm hover:bg-gray-50 transition-colors">Cancel</button>
                    
                    ${id !== 'new' ? `
                    <button onclick="window.deleteProject('${safeProjectId}')" title="Delete Project" class="flex items-center justify-center bg-white border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600 px-4 py-3 rounded-sm transition-colors group">
                        <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                    ` : ''}
                </div>
            </div>

        </div>
    `, id === 'new' ? 'NEW PROJECT' : 'EDIT PROJECT', id === 'new' ? '' : `<div class="bg-white border border-[#12170f]/10 text-[#d4af37] px-3 py-1.5 rounded-sm text-sm font-bold tracking-wide">${safeProjectId}</div>`);
    
    // FIXED: Bulletproof Javascript Image Verification. 
    // This bypasses innerHTML event injection failures by directly probing the URL.
    if (imageUrlToLoad) {
        const img = new Image();
        img.onload = function() {
            // Once confirmed to exist, pass the URL safely to the UI state function
            window.updateImageUIState(true, this.src);
        };
        img.onerror = function() {
            // If Supabase 404s the image, default to the empty state
            window.updateImageUIState(false);
        };
        img.src = imageUrlToLoad;
    } else {
        window.updateImageUIState(false);
    }
};

// No fetch-on-load: app.switchTab() awaits renderUpcomingProjects() when this tab
// is opened. Fetching here used to fire on every dashboard load and paint its
// table into #main-content whichever tab the session had restored.
