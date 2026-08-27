/*
 * core/http/security-headers.js — deny by default, on every response
 * ============================================================================
 *
 * ONE DOCUMENT, SO NO PER-DOCUMENT GRANTS.
 *
 * The storefront builds this header by scanning its pages for two markers —
 * a Google Maps consent placeholder and the Razorpay checkout — because it has
 * twenty-two documents and a hand-written list of which ones carry a map is a
 * list that goes stale silently. This site has one document, it carries
 * neither marker, and it never will: there is no map on a dashboard and this
 * process does not take payments. The scan came out with the pages it was
 * scanning, and `frame-src 'none'` is simply true here.
 *
 * WHAT IS STILL GRANTED, AND WHY.
 *
 *   img-src     the Supabase storage origin, because every product, category
 *               and project image the administrator is looking at while they
 *               work is served from that bucket.
 *
 *   connect-src 'self', plus the storefront's origin WHEN STOREFRONT_URL IS
 *               SET. connect-src is this site's strongest single control — it
 *               is the exfiltration channel — so the storefront is named only
 *               when a deployment has deliberately said where the storefront
 *               is, and an unset variable leaves the directive at 'self'.
 *               Nothing on the dashboard calls the storefront's API today: the
 *               two applications meet at the database, and the only link
 *               between them is a navigation (GET /storefront). The grant is
 *               here so that a future read against the public catalogue is a
 *               configuration change rather than a security review, and it is
 *               scoped to one origin rather than left open.
 *
 * Everything else is refused. The dashboard uses no powerful browser
 * capability at all, so Permissions-Policy denies the lot with `=()` — an
 * empty allow list, not even self.
 */
const { STOREFRONT_ORIGIN } = require('./storefront-link');

const SUPABASE_STORAGE_ORIGIN = (() => {
    try {
        return new URL(process.env.SUPABASE_URL).origin;
    } catch (error) {
        return '';
    }
})();

const CSP = [
    "default-src 'none'",
    // 'unsafe-inline' is not a free choice: there is no build step, the
    // dashboard carries inline onclick= attributes on every navigation button
    // and an inline <style> block, and the tab modules hand-build markup that
    // carries handlers. Removing it means extracting those, which is real work
    // and a separate change. What it still buys is that no EXTERNAL host is a
    // script source — Tailwind is vendored same-origin, so nothing here names
    // a CDN.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:" + (SUPABASE_STORAGE_ORIGIN ? ' ' + SUPABASE_STORAGE_ORIGIN : ''),
    "font-src 'self'",
    "connect-src 'self'" + (STOREFRONT_ORIGIN ? ' ' + STOREFRONT_ORIGIN : ''),
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    // The dashboard cannot be framed, so there is nothing to clickjack.
    // X-Frame-Options repeats it for anything predating CSP level 2.
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'none'"
].join('; ');

const PERMISSIONS_POLICY = [
    'accelerometer=()', 'autoplay=()',
    'bluetooth=()', 'browsing-topics=()', 'camera=()', 'display-capture=()',
    'encrypted-media=()', 'fullscreen=()', 'gamepad=()', 'geolocation=()',
    'gyroscope=()', 'hid=()', 'idle-detection=()', 'local-fonts=()',
    'magnetometer=()', 'microphone=()', 'midi=()', 'payment=()',
    'picture-in-picture=()', 'publickey-credentials-create=()',
    'publickey-credentials-get=()', 'screen-wake-lock=()', 'serial=()',
    'usb=()', 'web-share=()', 'window-management=()', 'xr-spatial-tracking=()',
    // Chrome's advertising and measurement surfaces. Denied explicitly
    // because they are enabled by default in the browsers that ship them.
    'attribution-reporting=()', 'interest-cohort=()', 'join-ad-interest-group=()',
    'run-ad-auction=()', 'private-state-token-issuance=()',
    'private-state-token-redemption=()', 'shared-storage=()',
    'shared-storage-select-url=()'
].join(', ');

function securityHeaders(req, res, next) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // no-referrer: the only cross-origin request this console makes is an
    // image fetch to Supabase storage, and that host has no business being
    // told which page wanted it.
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

    // Only over TLS. Sent unconditionally on a plain-HTTP dev server it would
    // pin localhost to https for a year in the developer's own browser.
    if (req.secure || req.get('x-forwarded-proto') === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
}

module.exports = { securityHeaders, CSP, PERMISSIONS_POLICY };
