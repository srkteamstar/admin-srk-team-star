/**
 * admin-auth-module.js — window.adminAuth
 *
 * The dashboard's whole authentication surface: it asks who is holding the
 * session cookie, and it keeps the dashboard dark until the answer is "an
 * administrator, signed in at this door".
 *
 * THE DOOR IS HERE NOW, AND THAT IS THE POINT
 * -------------------------------------------
 * This file used to have no form in it. An administrator signed in through the
 * storefront account overlay, was recognised by their role, and was redirected
 * here — and this module's only job was to check the role and paint a "go to
 * the store and sign in" notice if it did not like the answer.
 *
 * That arrangement cost more than the round trip it saved. An admin who signed
 * in on the store came away holding a storefront session, so the store had to
 * be taught, surface by surface, not to treat them as a shopper: the account
 * overlay greeted them by name and offered an order history and a delivery
 * address for a row that is planted into user_profiles by hand and has none of
 * those things; needsOnboarding() grew an admin branch so they were not sent
 * to a "Delivery Address" step meant for a half-finished signup; the sign-in
 * handler grew a redirect to carry them back out again. Each fix was
 * reasonable and the sum of them was a role leaking through a storefront it
 * had no business being in.
 *
 * So the admin door is POST /api/admin/login, it is on this page, and a
 * successful sign-in here starts a session the STORE cannot see at all —
 * GET /api/auth/me answers `null` for it, which is what deletes the whole
 * class of special case rather than adding one more. One cookie still, so
 * signing in here also signs this browser out of the store. That is intended:
 * a browser is one thing or the other, never both.
 *
 * WHAT THE SERVER WANTS
 * ---------------------
 * An administrator email or phone number plus the password stored as a one-way
 * hash on that profile. The server checks both the role and the password before
 * it opens an administrator-scoped session.
 *
 * 401 AND 403 ARE STILL NOT THE SAME ANSWER
 * -----------------------------------------
 * 401 means nobody is signed in at this door — the form is the answer, and it
 * is painted. 403 means somebody is, and they are not an administrator (or are
 * suspended); reloading on that is an unbreakable loop, so it paints a dead
 * end and stops. This is why the two statuses are worth separating, and it is
 * also why `fetch` below no longer reloads on 401 the way it used to: there is
 * a form on this page now, so the useful response to "not signed in" is to
 * show it rather than to bounce the page.
 *
 * `ready` is the promise the dashboard's own init() awaits before calling any
 * admin route, so no request is made — and no 401 is possible — before the
 * session is confirmed. It resolves on a successful sign-in just as it does on
 * an already-valid session, so signing in starts the dashboard with no reload.
 * It is deliberately NEVER resolved for a visitor who is not an administrator.
 *
 * The gate <div> has no `hidden` class in the HTML source, so it is the first
 * thing painted: there is no frame in which dashboard chrome is visible before
 * the session is known.
 */
(function () {
    'use strict';

    // Fired now rather than on DOMContentLoaded, to overlap the round trip
    // with the rest of page parsing. /api/admin/session answers 200 with a
    // null admin when nobody is signed in, so "not signed in" is an ordinary
    // answer here rather than an error to swallow.
    let sessionCheck = fetch('/api/admin/session', { credentials: 'include', cache: 'no-store' })
        .then(res => res.json())
        .then(data => (data && data.admin) || null)
        .catch(() => null);

    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });

    // The email and the server's error sentences are the parts of this markup
    // that do not come from this file, so they are escaped rather than
    // trusted.
    const escapeHtml = (value) => String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const gate = () => document.getElementById('admin-auth-gate');

    // ------------------------------------------------------------------
    // MARKUP
    // ------------------------------------------------------------------
    const FIELD_CLASSES =
        'w-full bg-white border border-[#12170f]/15 rounded-sm px-4 py-3 text-sm font-bold text-[#12170f] ' +
        'placeholder:font-medium placeholder:text-[#1f271b]/35 focus:outline-none focus:border-[#d4af37] ' +
        'focus:ring-2 focus:ring-[#d4af37]/30 transition-colors';

    const LABEL_CLASSES = 'block text-[10px] font-bold uppercase tracking-wider text-[#1f271b]/50 mb-2';

    // A card on the gate's near-black ground, deliberately narrow: there is
    // two fields and one button.
    function cardHTML(inner) {
        return '<div class="w-full max-w-sm bg-white rounded-sm p-8 shadow-2xl">' + inner + '</div>';
    }

    function signInHTML() {
        return cardHTML([
            '<p class="text-[10px] font-bold uppercase tracking-wider text-[#d4af37] mb-2">SRK Team Star</p>',
            '<h2 id="admin-signin-title" class="text-xl font-bold text-[#12170f] mb-2">Administrator sign in</h2>',
            '<p class="text-sm text-[#1f271b]/60 mb-6 leading-relaxed">This dashboard is separate from the store. Sign in with your administrator account.</p>',

            '<form id="admin-signin-form" autocomplete="on" data-srk-password-manager="allow" novalidate>',

            // Reserved space rather than an element that appears: a banner
            // that pushes the fields down as it arrives moves the button out
            // from under a cursor already on its way to it.
            '    <p id="admin-signin-error" class="hidden text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2 mb-4 leading-snug"></p>',

            '    <div class="mb-6">',
            '        <label for="admin-identifier" class="' + LABEL_CLASSES + '">Email or phone</label>',
            '        <input id="admin-identifier" name="username" type="text" autocomplete="username" data-srk-password-manager="allow" class="' + FIELD_CLASSES + '" placeholder="you@example.com" />',
            '    </div>',

            '    <div class="mb-6">',
            '        <label for="admin-password" class="' + LABEL_CLASSES + '">Password</label>',
            '        <input id="admin-password" name="password" type="password" autocomplete="current-password" data-srk-password-manager="allow" class="' + FIELD_CLASSES + '" />',
            '    </div>',

            '    <button id="admin-signin-submit" type="submit" class="w-full bg-[#12170f] text-white font-bold text-sm py-3 rounded-sm hover:bg-[#1f271b] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed">Sign In</button>',
            '</form>',

            '<p class="text-[11px] text-[#1f271b]/40 mt-4 leading-relaxed">Administrator access is granted directly in the database.</p>'
        ].join('\n'));
    }

    // The dead end. Someone holds a session that is not an administrator's —
    // there is nothing to type that changes that, so there is no form here,
    // and deliberately no reload.
    function refusedHTML(message) {
        return cardHTML([
            '<h2 id="admin-signin-title" class="text-xl font-bold text-[#12170f] mb-2">Not an administrator</h2>',
            '<p class="text-sm text-[#1f271b]/60 mb-6 leading-relaxed">' + escapeHtml(message || 'This account does not have administrator access to this dashboard.') + '</p>',
            '<button id="admin-refused-signin" type="button" class="w-full bg-[#12170f] text-white font-bold text-sm py-3 rounded-sm hover:bg-[#1f271b] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]">Sign in as an administrator</button>',
            // /storefront, not /store/store.html: the store is a different
            // origin now, and this file cannot know its address. The redirect
            // route reads STOREFRONT_URL at boot and sends the visitor there.
            '<a href="/storefront" class="block text-center text-xs font-bold text-[#1f271b]/50 hover:text-[#12170f] transition-colors mt-4">Back to the store</a>'
        ].join('\n'));
    }

    // ------------------------------------------------------------------
    // PAINTING
    // ------------------------------------------------------------------
    // WHICH GATE STATE IS ON SCREEN, so re-entering the one already showing is
    // a no-op rather than a repaint.
    //
    // This is load-bearing, not tidiness. enquiries.js polls GET /api/enquiries
    // every 20 seconds through adminAuth.fetch, so a session that has died
    // produces a 401 on a timer — and repainting on each one would wipe the
    // identifier the administrator is part-way through typing, every
    // 20 seconds, forever. The old module could not hit this because its 401
    // branch reloaded the page, which stopped the timer with everything else.
    let gateState = null;

    function showSignIn() {
        const el = gate();
        if (!el) return;
        if (gateState === 'signin') return;
        gateState = 'signin';

        el.innerHTML = signInHTML();
        el.classList.remove('hidden');
        el.removeAttribute('aria-hidden');

        // The observer in disable-input-suggestions-module.js would reach
        // these on its next tick; calling it directly hardens them before the
        // first paint instead, which is what that export exists for.
        if (window.disableInputSuggestions) window.disableInputSuggestions(el);

        const form = document.getElementById('admin-signin-form');
        if (form) form.addEventListener('submit', onSubmit);

        const first = document.getElementById('admin-identifier');
        if (first) first.focus({ preventScroll: true });
    }

    function showRefused(message) {
        const el = gate();
        if (!el) return;
        if (gateState === 'refused') return;
        gateState = 'refused';

        el.innerHTML = refusedHTML(message);
        el.classList.remove('hidden');
        el.removeAttribute('aria-hidden');

        // Signing in as somebody else means ending this session first, or the
        // new one would be refused for the same reason. Logging out and
        // painting the form is the whole of "switch account".
        const button = document.getElementById('admin-refused-signin');
        if (button) {
            button.addEventListener('click', () => {
                fetch('/api/auth/logout', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' }
                }).catch(() => {}).then(() => {
                    gateState = null;   // a deliberate repaint, so drop the guard
                    showSignIn();
                });
            });
        }
    }

    // The one path that opens the dashboard.
    function admitted(admin) {
        const el = gate();
        if (el) {
            el.classList.add('hidden');
            el.setAttribute('aria-hidden', 'true');
            el.innerHTML = '';
        }
        const shell = document.getElementById('admin-app-shell');
        if (shell) {
            shell.removeAttribute('inert');
            shell.removeAttribute('aria-hidden');
        }
        gateState = null;

        // The header used to say a hardcoded "ADMINISTRATOR", which was the
        // most it could know when everyone shared one password. There is a
        // person behind the session now.
        const identity = document.getElementById('admin-identity');
        if (identity) identity.textContent = (admin && (admin.name || admin.email)) || 'Administrator';

        resolveReady();
    }

    function showError(message) {
        const banner = document.getElementById('admin-signin-error');
        if (!banner) return;

        banner.textContent = message;
        banner.classList.remove('hidden');
    }

    function clearError() {
        const banner = document.getElementById('admin-signin-error');
        if (banner) banner.classList.add('hidden');
    }

    // ------------------------------------------------------------------
    // SUBMIT
    // ------------------------------------------------------------------
    async function onSubmit(event) {
        event.preventDefault();
        clearError();

        const identifierField = document.getElementById('admin-identifier');
        const passwordField = document.getElementById('admin-password');
        const submit = document.getElementById('admin-signin-submit');

        const identifier = identifierField ? identifierField.value.trim() : '';
        const password = passwordField ? passwordField.value : '';

        // Answered here rather than after a round trip, and only for the one
        // thing that is unambiguously wrong before one is worth making. The
        // server checks it again and its copy is the one that counts.
        if (!identifier) {
            showError('Enter your administrator email or phone number.');
            if (identifierField) identifierField.focus({ preventScroll: true });
            return;
        }
        if (!password) {
            showError('Enter your administrator password.');
            if (passwordField) passwordField.focus({ preventScroll: true });
            return;
        }
        if (submit) {
            submit.disabled = true;
            submit.textContent = 'Signing in…';
        }

        let response;
        let data;

        try {
            response = await fetch('/api/admin/login', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier: identifier, password: password })
            });
            data = await response.json().catch(() => ({}));
        } catch (error) {
            if (submit) {
                submit.disabled = false;
                submit.textContent = 'Sign In';
            }
            showError('Could not reach the server. Check your connection and try again.');
            return;
        }

        if (!response.ok) {
            if (submit) {
                submit.disabled = false;
                submit.textContent = 'Sign In';
            }

            showError((data && data.error) || 'Could not sign you in.');

            if (passwordField) {
                passwordField.value = '';
                passwordField.focus({ preventScroll: true });
            }
            return;
        }

        // The session that /api/admin/session would now report, without
        // asking again: this response carries the same identity.
        const admin = (data && data.admin) || null;
        sessionCheck = Promise.resolve(admin);
        admitted(admin);
    }

    // ------------------------------------------------------------------
    // PUBLIC
    // ------------------------------------------------------------------
    window.adminAuth = {
        ready,

        // Every admin-authenticated call in the dashboard goes through this
        // rather than a bare fetch(): it attaches the session cookie, and it
        // answers 401 and 403 differently for the reason in the header above.
        fetch: function (url, options = {}) {
            return fetch(url, { ...options, credentials: 'include' }).then(response => {
                if (response.status === 401) {
                    // Not signed in at this door — which this page can now do
                    // something about. It used to reload here, which was the
                    // only move available when the form lived on another
                    // origin's page.
                    showSignIn();
                } else if (response.status === 403) {
                    response.clone().json().catch(() => ({})).then(data => showRefused(data && data.error));
                }
                return response;
            });
        },

        // Ends the session and reloads, rather than navigating to the store.
        //
        // The store is not where an administrator came from any more, so
        // sending them there on the way out would be sending them somewhere
        // they were never signed in. Reloading lands on this page's own
        // sign-in form, which is both the honest destination and the only way
        // to reset a dashboard whose `ready` promise has already resolved and
        // cannot be un-resolved.
        //
        // Cleared locally either way: a request that fails to reach the server
        // still sends the browser on, the same call customerSession.signOut
        // makes on the storefront.
        logout: function () {
            return fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            })
                .catch(() => {})
                .then(() => { window.location.reload(); });
        }
    };

    function wireGate() {
        if (!gate()) return;

        gate().addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const focusable = Array.from(gate().querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'));
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        sessionCheck.then(admin => {
            if (admin) return admitted(admin);

            // Nobody is signed in at this door. Whether some *other* kind of
            // session is live is not this page's business and is not asked:
            // /api/admin/session answers null for a storefront session
            // exactly as it does for no session at all, and the form is the
            // right answer to both. showRefused() is reached only from a live
            // 403, where a route has actually turned somebody away.
            showSignIn();

            // `ready` is deliberately left unresolved. It is what init()
            // awaits before touching an admin route, and there is nothing
            // this visitor may load until they sign in — at which point
            // admitted() resolves it and the dashboard starts.
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireGate);
    } else {
        wireGate();
    }
})();
