// The console has one document, and everything about it that matters before
// anyone signs in is asserted here.
const { test, expect } = require('@playwright/test');

test('the dashboard answers at the site root', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Admin Dashboard/);
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
    await expect(page.locator('#admin-code')).toHaveCount(0);
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

test('stored project copy is rendered as text rather than executable markup', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#admin-identifier').fill('admin@example.test');
    await page.locator('#admin-password').fill('Correct Horse Battery Staple');
    await page.locator('#admin-signin-submit').click();
    await expect(page.getByRole('heading', { name: 'Your store, at a glance.' })).toBeVisible();

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
