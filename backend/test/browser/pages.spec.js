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
