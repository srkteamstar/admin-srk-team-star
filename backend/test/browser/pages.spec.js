// The console has one document, and everything about it that matters before
// anyone signs in is asserted here.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

async function signIn(page) {
    await page.locator('#admin-identifier').fill('admin@example.test');
    await page.locator('#admin-password').fill('Correct Horse Battery Staple');
    await page.locator('#admin-signin-submit').click();
    await expect(page.getByRole('heading', { name: 'Your store, at a glance.' })).toBeVisible();
}

test('the dashboard answers at the site root', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Admin Dashboard/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S.{30,}/);
    if (process.env.SRK_TEST_BUILT_ASSETS === '1') {
        const script = await page.request.get('/js/modules/admin/auth/admin-auth-module.js');
        const built = fs.readFileSync(path.resolve(__dirname, '../../../public/js/modules/admin/auth/admin-auth-module.js'), 'utf8');
        expect(await script.text()).toBe(built);
    }
});

test('every response is marked noindex, robots.txt included', async ({ page }) => {
    for (const path of ['/', '/robots.txt']) {
        const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
        expect(response.headers()['x-robots-tag'], path).toContain('noindex');
    }
});

// THE GATE IS A COURTESY, NOT THE BOUNDARY — every route behind it is refused
// server-side by test/authz.test.js. What this asserts is that the console is
// not usable, and not reachable by a screen reader or a tab key, until it has
// been signed into: an app shell that merely LOOKS covered is one keyboard
// press away from being operated through the overlay.
test('the sign-in gate is a modal boundary and the app is inert behind it', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const gate = page.locator('#admin-auth-gate');
    await expect(gate).toHaveAttribute('role', 'dialog');
    await expect(gate).toHaveAttribute('aria-modal', 'true');
    await expect(gate).toHaveAttribute('aria-labelledby', 'admin-signin-title');
    await expect(page.locator('#admin-signin-title')).toBeVisible();
    await expect(page.locator('#admin-app-shell')).toHaveAttribute('inert', '');

    await expect(page.locator('#admin-identifier')).toBeVisible();
    await expect(page.locator('#admin-identifier')).toHaveAttribute('autocomplete', 'username');
    await expect(page.locator('#admin-password')).toBeVisible();
    await expect(page.locator('#admin-password')).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.locator('#admin-mfa-code')).toHaveCount(0);

    await page.locator('#admin-identifier').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#admin-password')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#admin-signin-submit')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#admin-identifier')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#admin-signin-submit')).toBeFocused();
});

test('signed-out visits do not download dashboard modules, protected data, or full-size logos', async ({ page }) => {
    const requestedPaths = [];
    page.on('request', request => requestedPaths.push(new URL(request.url()).pathname));

    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('#admin-signin-form')).toBeVisible();

    expect(requestedPaths.filter(path => path.endsWith('.js')).sort()).toEqual([
        '/js/modules/admin/auth/admin-auth-module.js',
        '/js/modules/admin/shell/admin-assets.js'
    ]);
    expect(requestedPaths.filter(path => path.endsWith('.css'))).toEqual([]);
    expect(requestedPaths.filter(path => path.startsWith('/api/') && path !== '/api/admin/session')).toEqual([]);
    expect(requestedPaths.filter(path => /\/SRK-Team-Star-Logos\/primary(?:-bgless)?\.png$/.test(path))).toEqual([]);
});

test('the sign-in form is visible without JavaScript and cannot put credentials in a URL', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    try {
        const page = await context.newPage();
        await page.goto('/', { waitUntil: 'load' });
        await expect(page.getByRole('heading', { name: 'Administrator sign in' })).toBeVisible();
        await expect(page.getByLabel('Email or phone', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
        await expect(page.locator('#admin-signin-form')).toHaveAttribute('method', /^post$/i);
        await expect(page.locator('#admin-signin-submit')).toBeDisabled();
        await expect(page.locator('#admin-app-shell')).toHaveAttribute('inert', '');
    } finally {
        await context.close();
    }
});

test('sign-in can finish before a slow session check without a stale response relocking the dashboard', async ({ page }) => {
    let releaseSession;
    let sessionStarted;
    const heldSession = new Promise(resolve => { releaseSession = resolve; });
    const requestedSession = new Promise(resolve => { sessionStarted = resolve; });
    await page.route('**/api/admin/session', async route => {
        sessionStarted();
        await heldSession;
        await route.fulfill({ status: 200, json: { admin: null } });
    });

    try {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await requestedSession;
        await signIn(page);

        const staleResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/session');
        releaseSession();
        await staleResponse;
        await page.waitForLoadState('networkidle');

        await expect(page.locator('#admin-auth-gate')).toBeHidden();
        await expect(page.locator('#admin-app-shell')).not.toHaveAttribute('inert', '');
        await page.locator('#nav-orders').click();
        await expect(page.locator('#stat-order-revenue')).toHaveText('₹ 2,360');
        await expect(page.locator('#admin-auth-gate')).toBeHidden();
    } finally {
        releaseSession();
    }
});

// The storefront is a different origin now, so the logo cannot link a path.
test('the logo links the storefront through the redirect route', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#admin-app-shell a[href="/storefront"]').first()).toHaveCount(1);

    // Unconfigured in the harness, and it says so rather than 404-ing: a
    // missing STOREFRONT_URL is an incomplete deployment, not a missing page.
    const response = await page.request.get('/storefront', { maxRedirects: 0 });
    expect([302, 503]).toContain(response.status());
});

test('dashboard is operational, revenue is shipped-only, and order actions open on click', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#admin-identifier').fill('admin@example.test');
    await page.locator('#admin-password').fill('Correct Horse Battery Staple');
    await page.locator('#admin-signin-submit').click();

    await expect(page.getByRole('heading', { name: 'Your store, at a glance.' })).toBeVisible();
    await expect(page.getByText('What needs attention')).toBeVisible();
    await expect(page.getByText('Recent orders')).toBeVisible();

    await page.locator('#nav-orders').click();
    await expect(page.locator('#stat-order-revenue')).toHaveText('₹ 2,360');
    await expect(page.getByText('Failed Buyer')).toHaveCount(0);

    await expect(page.getByText('Guest Buyer').first()).toBeVisible();
    await page.evaluate(() => window.handleOrderAction(902));
    await expect(page.getByText('Customer contact')).toBeVisible();
    await expect(page.getByRole('link', { name: 'guest@example.test', exact: true })).toBeVisible();
    await expect(page.getByText('9000000099')).toBeVisible();
    await expect(page.getByText('Guest checkout')).toBeVisible();

    const actionButton = page.locator('#order-actions-button-901');
    const actionMenu = page.locator('#order-actions-menu-901');
    await actionButton.hover();
    await expect(actionMenu).toBeHidden();
    await actionButton.click();
    await expect(actionMenu).toBeVisible();
    await expect(actionButton).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(actionMenu).toBeHidden();
    await expect(actionButton).toHaveAttribute('aria-expanded', 'false');
});

test('a slow tab script is loaded once and cannot overwrite a more recent navigation', async ({ page }) => {
    const ordersPath = '/js/modules/admin/tabs/orders.js';
    const scriptRequests = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (request.resourceType() === 'script') scriptRequests.push(new URL(request.url()).pathname);
    });

    let releaseOrders;
    let ordersStarted;
    const heldOrders = new Promise(resolve => { releaseOrders = resolve; });
    const requestedOrders = new Promise(resolve => { ordersStarted = resolve; });
    await page.route('**/js/modules/admin/tabs/orders.js*', async route => {
        ordersStarted();
        await heldOrders;
        await route.continue();
    });

    try {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await signIn(page);
        expect(scriptRequests.filter(path => path.includes('/admin/tabs/'))).toEqual([]);

        await page.locator('#nav-orders').click();
        await requestedOrders;
        // Two clicks while the same file is still in flight must share one load.
        await page.locator('#nav-orders').click();
        await page.locator('#nav-dashboard').click();
        await expect(page.getByRole('heading', { name: 'Your store, at a glance.' })).toBeVisible();

        const ordersResponse = page.waitForResponse(response => new URL(response.url()).pathname === ordersPath);
        releaseOrders();
        await ordersResponse;
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('heading', { name: 'Your store, at a glance.' })).toBeVisible();
        await expect(page.locator('#nav-dashboard')).toHaveAttribute('aria-current', 'page');

        await page.locator('#nav-orders').click();
        await expect(page.locator('#stat-order-revenue')).toHaveText('₹ 2,360');
        await page.locator('#nav-dashboard').click();
        await expect(page.getByRole('heading', { name: 'Your store, at a glance.' })).toBeVisible();
        await page.locator('#nav-orders').click();
        await expect(page.locator('#stat-order-revenue')).toHaveText('₹ 2,360');

        expect(scriptRequests.filter(path => path === ordersPath)).toHaveLength(1);
        await expect(page.locator('script[src^="/js/modules/admin/tabs/orders.js"]')).toHaveCount(1);
        expect(errors).toEqual([]);
    } finally {
        releaseOrders();
    }
});

test('a failed section download can be retried without reloading the page', async ({ page }) => {
    let attempts = 0;
    await page.route('**/js/modules/admin/tabs/orders.js', async route => {
        attempts += 1;
        if (attempts === 1) await route.abort('failed');
        else await route.continue();
    });
    await page.goto('/');
    await signIn(page);
    await page.locator('#nav-orders').click();
    await expect(page.getByRole('alert')).toContainText('Could not load this section');
    await page.locator('#nav-orders').click();
    await expect(page.locator('#stat-order-revenue')).toHaveText('₹ 2,360');
    expect(attempts).toBe(2);
});

test('an expired session locks the shell and signing back in refreshes the selected section', async ({ page }) => {
    await page.goto('/');
    await signIn(page);
    await page.request.post('/api/auth/logout');
    await page.locator('#nav-orders').click();
    await expect(page.locator('#admin-signin-form')).toBeVisible();
    await expect(page.locator('#admin-app-shell')).toHaveAttribute('inert', '');
    await expect(page.locator('#admin-app-shell')).toBeHidden();
    await expect(page.locator('#admin-password')).toHaveValue('');
    await page.locator('#admin-identifier').fill('admin@example.test');
    await page.locator('#admin-password').fill('Correct Horse Battery Staple');
    await page.locator('#admin-signin-submit').click();
    await expect(page.locator('#admin-auth-gate')).toBeHidden();
    await expect(page.locator('#stat-order-revenue')).toHaveText('₹ 2,360');
});

test('revoked access shows a focused refusal and keeps the dashboard inaccessible', async ({ page }) => {
    await page.goto('/');
    await signIn(page);
    await page.route('**/api/orders?*', route => route.fulfill({ status: 403, json: { error: 'Administrator access is suspended.' } }));
    await page.locator('#nav-orders').click();
    await expect(page.getByRole('heading', { name: 'Not an administrator' })).toBeVisible();
    await expect(page.locator('#admin-app-shell')).toHaveAttribute('inert', '');
    await expect(page.locator('#admin-app-shell')).toBeHidden();
    await expect(page.locator('#admin-refused-signin')).toBeFocused();
    await page.locator('#admin-refused-signin').click();
    await expect(page.locator('#admin-signin-form')).toBeVisible();
    await expect(page.locator('#admin-identifier')).toBeFocused();
});

test('every dashboard section loads on first use and the saved section survives a reload', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await signIn(page);

    for (const [tab, heading] of [
        ['products', 'Product list'],
        ['categories', 'Category list'],
        ['customers', 'Customer profiles'],
        ['upcoming-projects', 'Project list'],
        ['technical', 'All tickets'],
        ['quotations', 'Quote requests']
    ]) {
        await page.locator('#nav-' + tab).click();
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        await expect(page.locator('#nav-' + tab)).toHaveAttribute('aria-current', 'page');

        if (tab === 'products') {
            // The product editor uses shared toggles owned by Categories. It
            // must work before that section has ever been visited.
            await page.getByRole('button', { name: 'Add product', exact: true }).click();
            await expect(page.locator('#input-prod-name')).toBeVisible();
            await expect(page.locator('#toggle-prod-active')).toHaveAttribute('aria-checked', 'true');
            await page.locator('#toggle-prod-active').click();
            await expect(page.locator('#toggle-prod-active')).toHaveAttribute('aria-checked', 'false');
            await page.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(page.locator('#details-drawer')).toBeHidden();
        }
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Quote requests', exact: true })).toBeVisible();
    await expect(page.locator('#nav-quotations')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#admin-auth-gate')).toBeHidden();
    expect(errors).toEqual([]);
});

test('mobile section navigation works after its scripts load following sign-in', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await signIn(page);

    const menu = page.getByRole('button', { name: 'Open section navigation', exact: true });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#nav-orders').click();
    await expect(page.locator('#stat-order-revenue')).toHaveText('₹ 2,360');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('Payment Review is visible, explained, and never offered on ordinary orders', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#admin-identifier').fill('admin@example.test');
    await page.locator('#admin-password').fill('Correct Horse Battery Staple');
    await page.locator('#admin-signin-submit').click();
    await expect(page.getByRole('heading', { name: 'Your store, at a glance.' })).toBeVisible();

    await page.locator('#nav-orders').click();
    await expect(page.locator('#stat-order-revenue')).toHaveText('₹ 2,360');
    expect(await page.evaluate(() => window.orderStatusOptions('Payment Review'))).toEqual([
        'Payment Review', 'Processing', 'Shipped', 'Delivered', 'Cancelled'
    ]);
    expect(await page.evaluate(() => window.orderStatusOptions('Processing'))).not.toContain('Payment Review');

    await page.evaluate(() => {
        window.orderData[0].status = 'Payment Review';
        window.orderData[0].payment = Object.assign({}, window.orderData[0].payment, { status: 'Paid' });
        window.handleOrderAction(window.orderData[0].id);
    });
    await expect(page.getByText('Captured payment needs review')).toBeVisible();
    await expect(page.getByText(/confirm the gateway transaction/i)).toBeVisible();
});

test('stored project copy is rendered as text rather than executable markup', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#admin-identifier').fill('admin@example.test');
    await page.locator('#admin-password').fill('Correct Horse Battery Staple');
    await page.locator('#admin-signin-submit').click();
    await expect(page.getByRole('heading', { name: 'Your store, at a glance.' })).toBeVisible();
    await page.locator('#nav-upcoming-projects').click();
    await expect(page.getByRole('heading', { name: 'Project list', exact: true })).toBeVisible();

    await page.evaluate(() => {
        window.app.currentTab = 'upcoming-projects';
        window.projectData = [{
            id: 77,
            project_category_title: '<img id="stored-xss-category">',
            project_name: '<img id="stored-xss-name">',
            project_description: '<script id="stored-xss-script">window.__storedXss = true</script>',
            due_date: 'Soon',
            is_visible: true
        }];
        window.upcomingSectionVisible = true;
        window.paintUpcomingProjects();
    });

    await expect(page.locator('#stored-xss-category, #stored-xss-name, #stored-xss-script')).toHaveCount(0);
    await expect(page.getByText('<img id="stored-xss-name">')).toBeVisible();
    expect(await page.evaluate(() => window.__storedXss)).toBeUndefined();
});
