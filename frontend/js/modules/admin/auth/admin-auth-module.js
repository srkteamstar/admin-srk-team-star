/**
 * window.adminAuth: the administrator's independent sign-in gate.
 * The form and critical styles are in the HTML so neither JavaScript nor a
 * session round trip delays first paint. The server still verifies passwords,
 * sessions, roles and suspension on every protected API request.
 *
 * ready resolves only after authentication AND the dashboard dependencies are
 * available. No storefront session or API is involved.
 */
(function () {
    'use strict';

    const gate = () => document.getElementById('admin-auth-gate');
    const signInMarkup = gate().innerHTML;
    let gateState = null;
    let authVersion = 0;
    let authenticated = false;
    let submitPending = false;
    let readyResolved = false;
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });

    // The form stays usable while this request is pending. A version check
    // prevents its old answer from undoing a subsequent successful login.
    const initialVersion = authVersion;
    const sessionCheck = fetch('/api/admin/session', { credentials: 'include', cache: 'no-store' })
        .then(response => response.ok ? response.json() : null)
        .then(data => (data && data.admin) || null)
        .catch(() => null);

    const escapeHtml = value => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function lockShell() {
        authenticated = false;
        const shell = document.getElementById('admin-app-shell');
        shell.setAttribute('inert', '');
        shell.setAttribute('aria-hidden', 'true');
    }

    function setBusy(busy, label) {
        submitPending = busy;
        const submit = document.getElementById('admin-signin-submit');
        if (submit) {
            submit.disabled = busy;
            submit.textContent = label || (busy ? 'Signing in…' : 'Sign In');
        }
    }

    function showSignIn() {
        lockShell();
        // Repeated expired-session responses must not erase partially typed
        // credentials or move focus away from a field the user is editing.
        if (gateState === 'signin') return;
        gateState = 'signin';
        const element = gate();
        if (!document.getElementById('admin-signin-form')) element.innerHTML = signInMarkup;
        element.classList.remove('hidden');
        element.removeAttribute('aria-hidden');
        document.getElementById('admin-signin-form').addEventListener('submit', onSubmit);
        setBusy(false);
        document.getElementById('admin-identifier').focus({ preventScroll: true });
    }

    function showRefused(message) {
        lockShell();
        if (gateState === 'refused') return;
        gateState = 'refused';
        const element = gate();
        element.innerHTML = '<div class="admin-auth-card">' +
            '<h2 id="admin-signin-title">Not an administrator</h2>' +
            '<p id="admin-signin-description" class="admin-auth-copy">' +
            escapeHtml(message || 'This account does not have administrator access to this dashboard.') + '</p>' +
            '<button id="admin-refused-signin" type="button" class="admin-auth-submit">Sign in as an administrator</button>' +
            '<a href="/storefront" class="admin-auth-link">Back to the store</a></div>';
        element.classList.remove('hidden');
        element.removeAttribute('aria-hidden');
        const button = document.getElementById('admin-refused-signin');
        button.focus({ preventScroll: true });
        button.addEventListener('click', async () => {
            button.disabled = true;
            await fetch('/api/auth/logout', {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }
            }).catch(() => {});
            authVersion += 1;
            showSignIn();
        });
    }

    async function admitted(admin) {
        const version = ++authVersion;
        setBusy(true, 'Opening dashboard…');
        try {
            await window.adminAssets.loadShell();
        } catch (error) {
            if (version !== authVersion) return;
            setBusy(false);
            showError('Could not load the dashboard. Check your connection and sign in again.');
            return;
        }
        if (version !== authVersion) return;

        const element = gate();
        element.classList.add('hidden');
        element.setAttribute('aria-hidden', 'true');
        element.innerHTML = '';
        const shell = document.getElementById('admin-app-shell');
        shell.removeAttribute('inert');
        shell.removeAttribute('aria-hidden');
        document.getElementById('admin-identity').textContent = admin.name || admin.email || 'Administrator';
        gateState = null;
        authenticated = true;
        submitPending = false;

        if (readyResolved) {
            // Refresh data after signing back in to an expired session.
            window.app.init();
        } else {
            readyResolved = true;
            resolveReady();
        }
    }

    function showError(message) {
        const banner = document.getElementById('admin-signin-error');
        if (banner) {
            banner.textContent = message;
            banner.hidden = false;
        }
    }

    function clearError() {
        const banner = document.getElementById('admin-signin-error');
        if (banner) {
            banner.hidden = true;
            banner.textContent = '';
        }
        gate().querySelectorAll('[aria-invalid]').forEach(field => field.removeAttribute('aria-invalid'));
    }

    async function onSubmit(event) {
        event.preventDefault();
        if (submitPending) return;
        clearError();
        const identifierField = document.getElementById('admin-identifier');
        const passwordField = document.getElementById('admin-password');
        const identifier = identifierField.value.trim();
        const password = passwordField.value;

        if (!identifier || !password) {
            const field = !identifier ? identifierField : passwordField;
            showError(!identifier ? 'Enter your administrator email or phone number.' : 'Enter your administrator password.');
            field.setAttribute('aria-invalid', 'true');
            field.focus({ preventScroll: true });
            return;
        }

        const version = ++authVersion;
        setBusy(true);
        let response;
        let data;
        try {
            response = await fetch('/api/admin/login', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, password })
            });
            data = await response.json().catch(() => ({}));
        } catch (error) {
            if (version !== authVersion) return;
            setBusy(false);
            showError('Could not reach the server. Check your connection and try again.');
            return;
        }
        if (version !== authVersion) return;
        if (!response.ok || !data.admin) {
            setBusy(false);
            showError(data.error || 'Could not sign you in.');
            passwordField.value = '';
            passwordField.focus({ preventScroll: true });
            return;
        }
        // Do not keep the credential in the DOM while dashboard assets load.
        passwordField.value = '';
        await admitted(data.admin);
    }

    window.adminAuth = {
        ready,
        get isAuthenticated() { return authenticated; },
        fetch: function (url, options = {}) {
            const version = authVersion;
            return fetch(url, { ...options, credentials: 'include' }).then(response => {
                // A response from a retired session must not close a newer one.
                if (version !== authVersion) return response;
                if (response.status === 401) {
                    authVersion += 1;
                    showSignIn();
                } else if (response.status === 403) {
                    const refusedVersion = ++authVersion;
                    lockShell();
                    response.clone().json().catch(() => ({})).then(data => {
                        if (refusedVersion === authVersion) showRefused(data && data.error);
                    });
                }
                return response;
            });
        },
        logout: function () {
            return fetch('/api/auth/logout', {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }
            }).catch(() => {}).then(() => { window.location.reload(); });
        }
    };

    gate().addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const focusable = Array.from(gate().querySelectorAll(
            'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
        ));
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

    showSignIn();
    sessionCheck.then(admin => {
        if (authVersion === initialVersion && admin) return admitted(admin);
    });
})();
