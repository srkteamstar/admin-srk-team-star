// The administration console's authorization matrix, against the stubbed
// server (port 3456).
//
// WHAT THIS SUITE IS FOR: proving that the only way into this application is
// the password-protected administrator door, that role checks still apply, that every
// route is shut to anybody who has not come through it, and that the two
// writes which can lock an operator out of their own console refuse to.
//
// IT ALSO PROVES A NEGATIVE. Section 2 asks this process for the storefront's
// routes and expects 404 on every one. That is the split written down as a
// test: a public catalogue route copied back across to save a round trip
// would fail here as well as in verify-boot.
const BASE = 'http://localhost:3456';
const control = require('./harness-control');
const sharp = require('sharp');

let pass = 0, fail = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + '  << ' + detail); console.log('  FAIL  ' + name + '   << ' + detail); }
}

// A cookie jar per actor, so sessions do not bleed between them.
function jar() {
    const store = new Map();
    let lastSetCookies = [];
    return {
        header: () => [...store.entries()].map(([k, v]) => k + '=' + v).join('; '),
        absorb: (res) => {
            const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
            lastSetCookies = raw.slice();
            raw.forEach(line => {
                const [pair] = line.split(';');
                const idx = pair.indexOf('=');
                store.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
            });
        },
        lastSetCookies: () => lastSetCookies.slice(),
        clear: () => store.clear()
    };
}

async function req(cookies, method, path, body, extraHeaders) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    const cookieHeader = cookies ? cookies.header() : '';
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
    });
    if (cookies) cookies.absorb(res);

    let payload = null;
    const text = await res.text();
    try { payload = JSON.parse(text); } catch { payload = text; }
    return { status: res.status, body: payload };
}

async function reqForm(cookies, path, form) {
    const headers = {};
    const cookieHeader = cookies ? cookies.header() : '';
    if (cookieHeader) headers.Cookie = cookieHeader;
    const res = await fetch(BASE + path, { method: 'POST', headers, body: form, redirect: 'manual' });
    if (cookies) cookies.absorb(res);
    let payload = null;
    const body = await res.text();
    try { payload = JSON.parse(body); } catch { payload = body; }
    return { status: res.status, body: payload };
}

(async () => {
    const anon = jar(), admin = jar(), admin2 = jar();

    console.log('\n=== 1. THE ADMIN DOOR REQUIRES AN IDENTIFIER AND PASSWORD ===');

    // THE STOREFRONT DOOR IS NOT ON THIS ORIGIN AT ALL, which is the split's
    // strongest version of "an administrator does not sign in as a shopper":
    // not a role check that has to be got right, but a route that is not here.
    let r = await req(admin, 'POST', '/api/auth/login', { identifier: 'admin@example.test' });
    check('the storefront sign-in route does not exist on this application', r.status === 404, JSON.stringify(r));
    r = await req(admin, 'GET', '/api/customers');
    check('...and asking for it started no session', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(admin, 'POST', '/api/admin/login', {});
    check('admin login with no identifier is refused', r.status === 400, JSON.stringify(r));

    r = await req(admin, 'POST', '/api/admin/login', { identifier: 'admin@example.test' });
    check('admin login with no password is refused', r.status === 400 && r.body.field === 'password', JSON.stringify(r));

    // A customer identifier at the admin door is refused by the role check,
    // and an unknown one gets the identical sentence.
    r = await req(jar(), 'POST', '/api/admin/login', { identifier: 'a@example.test', password: 'Correct Horse Battery Staple' });
    check('a customer is refused at the admin door', r.status === 401, JSON.stringify(r));
    const customerRefusal = JSON.stringify(r.body);

    r = await req(jar(), 'POST', '/api/admin/login', { identifier: 'nobody@example.test', password: 'Correct Horse Battery Staple' });
    check('an unknown identifier gets the SAME answer as a customer (no enumeration)',
        r.status === 401 && JSON.stringify(r.body) === customerRefusal,
        customerRefusal + ' vs ' + JSON.stringify(r.body));

    r = await req(admin, 'GET', '/api/customers');
    check('...and no session was started by the failed attempts', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(admin, 'POST', '/api/admin/login', { identifier: 'admin@example.test', password: 'Definitely The Wrong Password' });
    check('an administrator with the wrong password is refused', r.status === 401, JSON.stringify(r));
    r = await req(admin, 'GET', '/api/customers');
    check('...and the wrong password started no session', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(admin, 'POST', '/api/admin/login', { identifier: 'admin@example.test', password: 'Correct Horse Battery Staple' });
    check('admin signs in with an email identifier and password',
        r.status === 200 && r.body.admin && r.body.admin.role === 'admin', JSON.stringify(r).slice(0, 120));

    check('admin identity response carries no password field',
        r.status === 200
            && !JSON.stringify(r.body).toLowerCase().includes('password'), JSON.stringify(r.body).slice(0, 200));

    // The admin identity is deliberately smaller than a customer profile: a
    // name, an email and the role. No address, no order history, nothing the
    // storefront would render.
    check('admin identity carries no storefront fields',
        r.body.admin && !('address_line' in r.body.admin) && !('phone' in r.body.admin),
        JSON.stringify(r.body.admin));

    console.log('\n=== 2. THIS APPLICATION SERVES NOTHING A SHOPPER WOULD ASK FOR ===');

    // The routes below are the storefront's, and this process has none of
    // them. An admin session presented to one is answered exactly as an
    // unknown path is - which is what makes "the dashboard cannot accumulate
    // a cart" a fact about the route table rather than a guard somebody has
    // to keep writing.
    for (const [m, p] of [['GET', '/api/auth/me'], ['GET', '/api/orders/mine'],
                          ['GET', '/api/cart'], ['POST', '/api/checkout'],
                          ['GET', '/api/products/public'], ['GET', '/api/categories/public']]) {
        r = await req(admin, m, p, m === 'GET' ? undefined : {});
        check(`admin -> ${m} ${p} is 404`, r.status === 404, r.status + ' ' + JSON.stringify(r.body).slice(0, 70));
    }

    r = await req(admin, 'GET', '/api/admin/session');
    check('/api/admin/session reads the cookie as an admin',
        r.status === 200 && r.body.admin && r.body.admin.role === 'admin', JSON.stringify(r).slice(0, 120));

    console.log('\n=== 3. PHONE IDENTIFIERS OPEN THE SAME ADMIN DOOR ===');
    r = await req(admin2, 'POST', '/api/admin/login', {
        identifier: '+91 90000 00004', password: 'Second Admin Secure Pass'
    });
    check('an administrator signs in with phone and password',
        r.status === 200 && r.body.admin && String(r.body.admin.id) === '101', JSON.stringify(r).slice(0, 120));
    r = await req(admin2, 'GET', '/api/customers');
    check('...and receives an administrator session', r.status === 200, JSON.stringify(r).slice(0, 80));
    console.log('\n=== 4. NOBODY SIGNED IN REACHES AN ADMIN ROUTE ===');

    // 401 rather than 403 on every one of them: from this application's point
    // of view nobody has signed in, and the honest next step is to offer the
    // door rather than to tell a stranger they are not an administrator.
    for (const [m, p] of [['GET', '/api/customers'], ['GET', '/api/dashboard/summary'], ['GET', '/api/orders'], ['GET', '/api/enquiries'],
                          ['GET', '/api/quote-requests'], ['GET', '/api/products'], ['GET', '/api/categories'],
                          ['GET', '/api/projects'], ['PATCH', '/api/orders/900/status'],
                          ['DELETE', '/api/products/1'], ['DELETE', '/api/enquiries/500']]) {
        r = await req(anon, m, p, m === 'GET' ? undefined : { status: 'Shipped' });
        check(`signed out -> ${m} ${p} is 401`, r.status === 401, r.status + ' ' + JSON.stringify(r.body).slice(0, 70));
    }

    console.log('\n=== 5. ADMIN CAN STILL DO ADMIN WORK ===');
    for (const [m, p] of [['GET', '/api/customers'], ['GET', '/api/dashboard/summary'], ['GET', '/api/orders'], ['GET', '/api/enquiries'],
                          ['GET', '/api/quote-requests'], ['GET', '/api/products'], ['GET', '/api/categories'],
                          ['GET', '/api/projects'], ['GET', '/api/settings/upcoming-projects-visibility']]) {
        r = await req(admin, m, p);
        check(`admin -> ${m} ${p} is 200`, r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 70));
    }
    r = await req(admin, 'GET', '/api/dashboard/summary');
    check('dashboard summary is bounded and includes operating totals',
        r.status === 200 && r.body.orders && r.body.orders.total >= 2
            && Array.isArray(r.body.orders.recent) && r.body.orders.recent.length <= 5,
        JSON.stringify(r).slice(0, 180));
    r = await req(admin, 'GET', '/api/orders?limit=251');
    check('list APIs reject attempts to bypass their page-size ceiling',
        r.status === 400 && /250/.test(r.body.error || ''), JSON.stringify(r));
    r = await req(admin, 'GET', '/api/orders');
    const guestOrder = (r.body || []).find(order => String(order.id) === '902');
    check('guest orders expose their frozen contact snapshot to the console',
        r.status === 200 && guestOrder && !guestOrder.customer && guestOrder.contact
            && guestOrder.contact.full_name === 'Guest Buyer'
            && guestOrder.contact.email === 'guest@example.test'
            && guestOrder.contact.phone_number === '9000000099'
            && guestOrder.contact.is_guest === true,
        JSON.stringify(guestOrder));
    check('failed zero-money checkout attempts are absent from the fulfilment console',
        !(r.body || []).some(order => String(order.id) === '899'), JSON.stringify(r.body));
    r = await req(admin, 'GET', '/api/orders?page=2&limit=2');
    check('list APIs support explicit bounded pages',
        r.status === 200 && Array.isArray(r.body) && r.body.length === 1, JSON.stringify(r));
    r = await req(admin, 'PATCH', '/api/orders/900/status', { status: 'Shipped', tracking: 'TRK-A' });
    check('admin can update an order status', r.status === 200, JSON.stringify(r).slice(0, 90));

    const disguisedImage = new FormData();
    disguisedImage.append('id', 'new');
    disguisedImage.append('project_name', 'Fake project');
    disguisedImage.append('image', new Blob(['not a real image'], { type: 'image/webp' }), 'fake.webp');
    r = await reqForm(admin, '/api/projects', disguisedImage);
    check('an upload with a forged image MIME type is refused',
        r.status === 400 && /not a valid/i.test(String(r.body && r.body.error)), JSON.stringify(r));

    console.log('\n=== 6. STATUS VOCABULARIES ARE ENFORCED ===');
    r = await req(admin, 'PATCH', '/api/enquiries/500/status', { status: '<script>x</script>' });
    check('enquiry status rejects free text (was unvalidated)', r.status === 400, JSON.stringify(r).slice(0, 90));
    r = await req(admin, 'PATCH', '/api/enquiries/500/status', { status: 'Resolved' });
    check('enquiry status accepts a real value', r.status === 200, JSON.stringify(r).slice(0, 90));
    r = await req(admin, 'PATCH', '/api/orders/900/status', { status: 'Paid' });
    check('order status rejects a value outside its list', r.status === 400, JSON.stringify(r).slice(0, 90));
    r = await req(admin, 'PATCH', '/api/quote-requests/600/status', { status: 'Whatever' });
    check('quote status rejects a value outside its list', r.status === 400, JSON.stringify(r).slice(0, 90));

    // 'Pending Payment' IS IN THE ORDER LIST NOW, AND WAS NOT.
    //
    // No admin action produces it — POST /api/checkout writes it and
    // markOrderPaid() clears it — so it was left out of ORDER_STATUSES. That
    // did not make it unreachable, it made it unrepresentable: an order sitting
    // in it could be moved to any of the other four and never moved back, so
    // one stray click in the dashboard destroyed the only record that money was
    // still owed. Walked there and back, so order 900 is left as the fixture
    // found it.
    r = await req(admin, 'PATCH', '/api/orders/900/status', { status: 'Pending Payment' });
    check("order status accepts 'Pending Payment'", r.status === 200, JSON.stringify(r).slice(0, 90));

    r = await req(admin, 'GET', '/api/orders');
    let order900 = (r.body || []).find(o => String(o.id) === '900');
    check('...and it reads back as exactly that',
        order900 && order900.status === 'Pending Payment', JSON.stringify(order900 && order900.status));

    r = await req(admin, 'PATCH', '/api/orders/900/status', { status: 'Payment Review' });
    check("order status accepts 'Payment Review' for captured-after-cancellation handling",
        r.status === 200, JSON.stringify(r).slice(0, 90));

    r = await req(admin, 'GET', '/api/orders');
    order900 = (r.body || []).find(o => String(o.id) === '900');
    check('...and the review state reads back without being collapsed into fulfilment',
        order900 && order900.status === 'Payment Review', JSON.stringify(order900 && order900.status));

    r = await req(admin, 'PATCH', '/api/orders/900/status', { status: 'Processing' });
    check('...and it can be moved out again', r.status === 200, JSON.stringify(r).slice(0, 90));

    r = await req(admin, 'GET', '/api/orders');
    order900 = (r.body || []).find(o => String(o.id) === '900');
    check('...leaving the fixture where it started',
        order900 && order900.status === 'Processing', JSON.stringify(order900 && order900.status));

    console.log('\n=== 7. BLOCKING AND DELETING A CUSTOMER (the two writes with teeth) ===');

    // Not signed in at all.
    r = await req(anon, 'DELETE', '/api/customers/201');
    check('signed out -> delete is 401', r.status === 401, JSON.stringify(r).slice(0, 90));
    r = await req(anon, 'PATCH', '/api/customers/201/status', { blocked: true });
    check('signed out -> block is 401', r.status === 401, JSON.stringify(r).slice(0, 90));

    // Admin, but aimed at a target the routes refuse. These two are the
    // reason the routes exist in this shape: a dashboard button that can
    // lock out the dashboard is an outage one misclick away.
    r = await req(admin, 'PATCH', '/api/customers/100/status', { blocked: true });
    check('admin cannot block their own account', r.status === 400, JSON.stringify(r).slice(0, 90));
    r = await req(admin, 'DELETE', '/api/customers/100');
    check('admin cannot delete their own account', r.status === 400, JSON.stringify(r).slice(0, 90));
    r = await req(admin, 'PATCH', '/api/customers/101/status', { blocked: true });
    check('admin cannot block another administrator', r.status === 403, JSON.stringify(r).slice(0, 90));
    r = await req(admin, 'DELETE', '/api/customers/101');
    check('admin cannot delete another administrator', r.status === 403, JSON.stringify(r).slice(0, 90));

    r = await req(admin, 'PATCH', '/api/customers/201/status', { blocked: 'yes please' });
    check('block status must be a boolean', r.status === 400, JSON.stringify(r).slice(0, 90));

    // An order is a wall, not something to cascade through.
    r = await req(admin, 'DELETE', '/api/customers/200');
    check('a customer with orders cannot be deleted', r.status === 409, JSON.stringify(r).slice(0, 120));
    r = await req(admin, 'GET', '/api/customers');
    check('...and that customer is still there',
        Array.isArray(r.body) && r.body.some(c => String(c.id) === '200'), JSON.stringify(r.body).slice(0, 80));

    // Blocking, and what blocking actually costs the customer.
    r = await req(admin, 'PATCH', '/api/customers/201/status', { blocked: true });
    check('admin can block a customer', r.status === 200 && r.body.is_blocked === true, JSON.stringify(r).slice(0, 90));

    // WHAT BLOCKING COSTS THE CUSTOMER IS PROVED ON THE STOREFRONT, not here.
    // This flag is written on the row; refusing a live session and refusing a
    // guest checkout are the storefront's own reads of it, and belong to the
    // suite that can open a shopper's session.
    r = await req(admin, 'GET', '/api/customers');
    check('...and the block reads back on the record',
        (r.body || []).some(c => String(c.id) === '201' && c.is_blocked === true),
        JSON.stringify((r.body || []).find(c => String(c.id) === '201')).slice(0, 120));

    r = await req(admin, 'PATCH', '/api/customers/201/status', { blocked: false });
    check('admin can unblock', r.status === 200 && r.body.is_blocked === false, JSON.stringify(r).slice(0, 90));

    // The one case delete is for: a profile with nothing filed against it.
    r = await req(admin, 'DELETE', '/api/customers/202');
    check('a customer with no orders can be deleted', r.status === 200, JSON.stringify(r).slice(0, 120));
    r = await req(admin, 'GET', '/api/customers');
    check('...and is gone from the list',
        Array.isArray(r.body) && !r.body.some(c => String(c.id) === '202'), JSON.stringify(r.body).slice(0, 80));

    console.log('\n=== 8. WRITE INPUTS ARE BOUNDED AND TARGETS ARE REAL ===');
    const incompleteProject = new FormData();
    incompleteProject.append('id', 'new');
    incompleteProject.append('project_name', 'Only a name');
    r = await reqForm(admin, '/api/projects', incompleteProject);
    check('project save rejects missing required fields', r.status === 400, JSON.stringify(r));

    const oversizedCategory = new FormData();
    oversizedCategory.append('id', 'new');
    oversizedCategory.append('name', 'x'.repeat(161));
    r = await reqForm(admin, '/api/categories', oversizedCategory);
    check('category save rejects an oversized name', r.status === 400, JSON.stringify(r));

    r = await req(admin, 'PATCH', '/api/orders/900/status', { status: 'Processing', tracking: 'x'.repeat(201) });
    check('order update rejects an oversized tracking reference', r.status === 400, JSON.stringify(r));

    // Order 900 is reused all over this suite and is walked back to where it
    // started (section 6); order 901 is not referenced anywhere else, so it is
    // the one this block permanently cancels.
    r = await req(admin, 'PATCH', '/api/orders/901/status', { status: 'Cancelled' });
    check('cancelling an order without a reason is refused', r.status === 400, JSON.stringify(r));

    r = await req(admin, 'PATCH', '/api/orders/901/status',
        { status: 'Cancelled', cancellationReason: 'Customer requested cancellation by phone.' });
    check('cancelling an order with a reason succeeds',
        r.status === 200 && r.body.data && r.body.data.status === 'Cancelled', JSON.stringify(r).slice(0, 160));

    r = await req(admin, 'PATCH', '/api/orders/901/status', { status: 'Cancelled', tracking: 'TRK-B' });
    check('an order already Cancelled can be re-saved without a fresh reason', r.status === 200, JSON.stringify(r).slice(0, 160));

    r = await req(admin, 'PATCH', '/api/orders/900/refund', {});
    check('refund cannot be recorded on an order that was never cancelled',
        r.status === 400 && /cancelled/i.test(r.body.error || ''), JSON.stringify(r));

    r = await req(admin, 'PATCH', '/api/orders/901/refund', {});
    check('refund cannot be recorded without a captured payment',
        r.status === 400 && /captured payment/i.test(r.body.error || ''), JSON.stringify(r));

    r = await req(admin, 'PATCH', '/api/orders/900/confirm', {});
    check('admin can confirm an order', r.status === 200 && r.body.data && !!r.body.data.confirmed_at, JSON.stringify(r).slice(0, 160));

    r = await req(admin, 'PATCH', '/api/orders/900/confirm', {});
    check('confirming an already-confirmed order is a no-op, not a second notification',
        r.status === 200 && r.body.alreadyConfirmed === true, JSON.stringify(r).slice(0, 160));

    r = await req(admin, 'DELETE', '/api/enquiries/999999');
    check('deleting a missing record returns 404 instead of false success', r.status === 404, JSON.stringify(r));

    const categoryA = new FormData();
    categoryA.append('id', '10');
    categoryA.append('name', 'Machinery');
    categoryA.append('parent_id', '11');
    r = await reqForm(admin, '/api/categories', categoryA);
    check('a valid parent relationship can be saved', r.status === 200, JSON.stringify(r));

    const categoryCycle = new FormData();
    categoryCycle.append('id', '11');
    categoryCycle.append('name', 'Photo Frame Moldings');
    categoryCycle.append('parent_id', '10');
    r = await reqForm(admin, '/api/categories', categoryCycle);
    check('category save rejects an indirect parent cycle', r.status === 400, JSON.stringify(r));

    const validWebp = await sharp({
        create: { width: 8, height: 8, channels: 4, background: '#420c14' }
    }).webp().toBuffer();
    const categoryWithImage = new FormData();
    categoryWithImage.append('id', 'new');
    categoryWithImage.append('name', 'Rollback Test Category');
    categoryWithImage.append('description', 'Must not survive a failed file write.');
    categoryWithImage.append('image', new Blob([validWebp], { type: 'image/webp' }), 'cover.webp');
    control.failNextStorageOperation('upload');
    r = await reqForm(admin, '/api/categories', categoryWithImage);
    check('a failed category image upload reports failure', r.status === 500, JSON.stringify(r));
    r = await req(admin, 'GET', '/api/categories');
    check('...and rolls back the inserted category row',
        r.status === 200 && !r.body.some(row => row.name === 'Rollback Test Category'), JSON.stringify(r).slice(0, 160));

    console.log('\n=== 9. SIGN-OUT ACTUALLY ENDS THE SESSION ===');
    r = await req(admin, 'POST', '/api/auth/logout', {});
    check('logout returns 200', r.status === 200, JSON.stringify(r).slice(0, 60));
    r = await req(admin, 'GET', '/api/customers');
    check('admin routes closed after logout', r.status === 401, r.status);
    r = await req(admin, 'GET', '/api/admin/session');
    check('...and the session route reads nobody',
        r.status === 200 && r.body.admin === null, JSON.stringify(r).slice(0, 80));

    console.log('\n=== 10. CROSS-ORIGIN ===');
    const cors = await fetch(BASE + '/api/admin/session', { headers: { Origin: 'https://evil.example' } });
    check('no ACAO for a foreign origin', !cors.headers.get('access-control-allow-origin'),
        String(cors.headers.get('access-control-allow-origin')));
    r = await req(anon, 'POST', '/api/admin/login',
        { identifier: 'admin@example.test', password: 'Correct Horse Battery Staple' },
        { Origin: 'https://evil.example' });
    check('cross-origin state change is refused', r.status === 403, r.status + ' ' + JSON.stringify(r.body).slice(0, 60));

    r = await req(anon, 'POST', '/api/admin/login',
        { identifier: 'admin@example.test', password: 'Correct Horse Battery Staple' },
        { 'Sec-Fetch-Site': 'same-site' });
    check('same-site but cross-origin browser requests are refused even without Origin',
        r.status === 403, r.status + ' ' + JSON.stringify(r.body).slice(0, 60));

    const forwardedHttpsJar = jar();
    r = await req(forwardedHttpsJar, 'POST', '/api/admin/login',
        { identifier: 'admin@example.test', password: 'Correct Horse Battery Staple' },
        {
            Origin: 'https://localhost:3456',
            'X-Forwarded-Proto': 'https',
            'Sec-Fetch-Site': 'same-origin'
        });
    check('trusted forwarded HTTPS is accepted by the same-origin guard',
        r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
    check('forwarded HTTPS issues a Secure administrator cookie',
        forwardedHttpsJar.lastSetCookies().some(line => /;\s*Secure(?:;|$)/i.test(line)),
        JSON.stringify(forwardedHttpsJar.lastSetCookies()));

    console.log('\n' + '='.repeat(64));
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
    console.log('='.repeat(64));
    process.exit(fail ? 1 : 0);
})();
