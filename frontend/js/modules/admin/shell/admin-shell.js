window.app = {
    activeItemId: null,
    currentTab: null, // Robust state tracker to fix brittle CSS querying
    
    init: function() {
        this.switchTab('dashboard', 'Overview', 'Dashboard'); 
        if (this.listenersReady) return;
        this.listenersReady = true;
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('profile-dropdown');
            const btn = document.getElementById('profile-menu-container');
            if (btn && dropdown && !btn.contains(e.target) && dropdown.classList.contains('opacity-100')) {
                this.closeProfileMenu();
            }
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.closeProfileMenu();
        });
    },
    toggleAccordion: function(accordionId, chevronId) {
        const accordion = document.getElementById(accordionId);
        const chevron = document.getElementById(chevronId);
        if (accordion.classList.contains('grid-rows-[1fr]')) {
            accordion.classList.remove('grid-rows-[1fr]');
            accordion.classList.add('grid-rows-[0fr]');
            chevron.classList.remove('rotate-180');
        } else {
            accordion.classList.remove('grid-rows-[0fr]');
            accordion.classList.add('grid-rows-[1fr]');
            chevron.classList.add('rotate-180');
        }
    },
    toggleProfileMenu: function(e) {
        const dropdown = document.getElementById('profile-dropdown');
        if (dropdown.classList.contains('opacity-0')) {
            dropdown.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
            dropdown.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
            dropdown.removeAttribute('inert');
            document.querySelector('[aria-controls="profile-dropdown"]').setAttribute('aria-expanded', 'true');
        } else { 
            this.closeProfileMenu(); 
        }
    },
    closeProfileMenu: function() {
        const dropdown = document.getElementById('profile-dropdown');
        if(dropdown) {
            dropdown.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
            dropdown.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
            dropdown.setAttribute('inert', '');
            document.querySelector('[aria-controls="profile-dropdown"]').setAttribute('aria-expanded', 'false');
        }
    },
    // Ends this console's session and reloads its own sign-in page.
    handleLogout: function() {
        this.closeProfileMenu();
        if (window.adminAuth && window.adminAuth.logout) window.adminAuth.logout();
    },
    switchTab: async function(tabName, parentName, currentName) {
        if (!window.adminAssets.hasTab(tabName) || !window.adminAuth.isAuthenticated) return;
        const navigation = this.navigationVersion = (this.navigationVersion || 0) + 1;
        this.currentTab = tabName; // Update internal state
        
        document.querySelectorAll('.nav-btn, .nav-sub-btn').forEach(btn => {
            btn.removeAttribute('aria-current');
            btn.classList.remove('text-[#d4af37]', 'bg-[#d4af37]/5');
            btn.classList.add('hover:text-[#d4af37]', 'hover:bg-[#d4af37]/5');
            if(btn.classList.contains('nav-sub-btn')) btn.classList.add('text-[#1f271b]/70');
        });
        
        const activeBtn = document.getElementById(`nav-${tabName}`);
        if (activeBtn) {
            activeBtn.setAttribute('aria-current', 'page');
            activeBtn.classList.add('text-[#d4af37]', 'bg-[#d4af37]/5');
            activeBtn.classList.remove('text-[#1f271b]/70', 'hover:text-[#d4af37]', 'hover:bg-[#d4af37]/5');
        }
        
        document.getElementById('breadcrumb-parent').innerText = parentName;
        document.getElementById('breadcrumb-current').innerText = currentName;
        this.closeDrawer(false);

        document.getElementById('main-content').innerHTML = `
            <div class="flex flex-col items-center justify-center h-full w-full gap-4">
                <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-[#d4af37]"></div>
                <p class="text-[#12170f]/70 font-bold text-sm" role="status">Loading section…</p>
            </div>`;

        const functionName = `render${tabName.charAt(0).toUpperCase() + tabName.slice(1).replace(/-([a-z])/g, (g) => g[1].toUpperCase())}`;
        
        try {
            await window.adminAssets.loadTab(tabName);
            // A late script download must not render over a newer selection.
            if (navigation !== this.navigationVersion || !window.adminAuth.isAuthenticated) return;
            if (typeof window[functionName] !== 'function') throw new Error('Section renderer is unavailable');
            await window[functionName]();
        } catch (error) {
            if (navigation !== this.navigationVersion || !window.adminAuth.isAuthenticated) return;
            const message = document.createElement('p');
            message.className = 'admin-auth-error';
            message.setAttribute('role', 'alert');
            message.textContent = 'Could not load this section. Check your connection and select the section again to retry.';
            document.getElementById('main-content').replaceChildren(message);
        }
    },
    openDrawer: function(htmlContent, titleText, headerBadgeHtml = '') {
        const drawer = document.getElementById('details-drawer');
        drawer.innerHTML = `
            <div class="p-6 md:p-8 pb-5 border-b border-[#12170f]/10 shrink-0 bg-[#f8fafc]">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-xl font-bold tracking-tight text-[#12170f]">${titleText}</h3>
                    <button aria-label="Close details" onclick="window.app.closeDrawer()" class="text-[#1f271b]/40 hover:text-red-500 transition-colors focus:outline-none hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                ${headerBadgeHtml ? `<div class="flex items-center justify-between">${headerBadgeHtml}</div>` : ''}
            </div>
            <!-- srk-scroll: the drawer is an overlaid panel, and on a phone
                 responsive-navigation-module.js stretches it over the whole
                 list behind it. Without this, a drag past the end of a long
                 record was handed to that list. See scroll-lock-module.js. -->
            <div id="drawer-scroll-content" class="srk-scroll flex-1 overflow-y-auto p-6 md:p-8 space-y-6 no-scrollbar relative flex flex-col">
                ${htmlContent}
            </div>
        `;
        drawer.classList.remove('hidden');
    },
    closeDrawer: function(repaint = true) {
        this.activeItemId = null;
        document.getElementById('details-drawer').classList.add('hidden');
        if (!repaint) return;
        
        // Repaint the list behind the drawer so the highlighted row lets
        // go. The two Enquiries tabs read different tables now, so each
        // gets its own repaint — enquiries.js only answers to 'technical'.
        //
        // Customers is here for the same reason and one more: its rows
        // carry a kebab menu whose open/closed state lives in that
        // module, so the repaint is also what puts a menu left open
        // behind the drawer away.
        if (this.currentTab === 'technical' && window.renderEnquiryView) {
            window.renderEnquiryView('technical');
        } else if (this.currentTab === 'quotations' && window.renderQuotationsView) {
            window.renderQuotationsView();
        } else if (this.currentTab === 'customers' && window.renderCustomersView) {
            window.renderCustomersView();
        }
    }
};

// This script loads after DOMContentLoaded. Authentication resolves ready only
// after every shell dependency has loaded; the restore override below is then
// in place before init is called.
window.adminAuth.ready.then(() => window.app.init());

(function() {
    const STORAGE_KEY = 'srk_dashboard_state';

    function readState() {
        try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || {}; }
        catch (error) { return {}; }
    }

    function writeState(state) {
        // Storage may be unavailable or full. Navigation must still work.
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
        catch (error) { /* The current page remains usable without restoration. */ }
    }

    // Ensure the core window.app object exists before extending it
    if (!window.app) return;

    const originalSwitchTab = window.app.switchTab;
    const originalInit = window.app.init;

    // 1. Override init() to intercept the hardcoded default tab loading
    window.app.init = function() {
        const savedState = readState();
        
        // Let the core init wire events without overriding the saved section.
        const tempSwitch = this.switchTab;
        this.switchTab = function() {}; 
        originalInit.apply(this);
        this.switchTab = tempSwitch; 
        
        // Restore saved tab from session, otherwise open the overview.
        if (savedState && window.adminAssets.hasTab(savedState.tabName)) {
            this.switchTab(savedState.tabName, savedState.parentName, savedState.currentName);
        } else {
            this.switchTab('dashboard', 'Overview', 'Dashboard');
        }
    };

    // 2. Override switchTab() to track section changes seamlessly
    window.app.switchTab = async function(tabName, parentName, currentName) {
        if (!window.adminAssets.hasTab(tabName) || !window.adminAuth.isAuthenticated) return;
        const prevState = readState();
        
        // If clicking a completely new tab, reset the saved scroll height to 0
        const isNewTab = prevState.tabName !== tabName;
        
        writeState({
            tabName,
            parentName,
            currentName,
            scrollPos: isNewTab ? 0 : (prevState.scrollPos || 0)
        });

        // Proceed with your original application logic
        await originalSwitchTab.apply(this, [tabName, parentName, currentName]);
    };

    // 3. Setup scroll tracking and async restoration
    (function trackScroll() {
        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;
        
        // A. Track scroll position dynamically as the user scrolls
        mainContent.addEventListener('scroll', () => {
            const savedState = readState();
            // Only update scroll position if we are on the matched tab
            if (window.app.currentTab === savedState.tabName) {
                savedState.scrollPos = mainContent.scrollTop;
                writeState(savedState);
            }
        });

        // B. Restore scroll position after async content injection (fetching data)
        const observer = new MutationObserver(() => {
            const savedState = readState();
            
            if (savedState && window.app.currentTab === savedState.tabName && savedState.scrollPos > 0) {
                // requestAnimationFrame ensures the DOM has fully painted the new table height before attempting to scroll
                requestAnimationFrame(() => {
                    mainContent.scrollTop = savedState.scrollPos;
                });
            }
        });

        // Observe the container for injected UI changes (waits for the async fetch to finish and inject HTML)
        observer.observe(mainContent, { childList: true, subtree: true });
    })();
})();
