/*
 * core/http/csrf.js — the Origin check SameSite is not
 * ============================================================================
 */
// ==========================================
// CSRF — the Origin check SameSite is not
// ==========================================
//
// SameSite=lax already stops a cross-site fetch from carrying srk_sid, and it
// is a real defence. It is also a single browser default, applied to a cookie
// this app does not control the transport of, covering a session that can
// delete every product in the catalogue. So state-changing requests are
// checked here too: a browser always sends Origin on POST/PATCH/DELETE, and
// where it is present it must be this host or an entry in the allow list.
//
// An absent Origin is permitted, because a non-browser client (curl, a
// server) legitimately sends none — and such a client carries no ambient
// cookie to abuse, which is the entire mechanism CSRF depends on.
const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function csrfOriginGuard(req, res, next) {
    if (!STATE_CHANGING.has(req.method)) return next();

    // Modern browsers state the relationship even when an Origin header is
    // absent. Same-site is still a different origin and is not trusted here:
    // an XSS on the public storefront must not become an admin API client.
    const fetchSite = req.get('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        return res.status(403).json({ error: "Cross-origin request refused." });
    }

    const origin = req.get('origin');
    if (!origin) return next();

    // Same-origin: compared against the Host the request actually arrived on,
    // so this needs no configuration and cannot drift from where the site is
    // really being served.
    try {
        const host = req.get('host');
        const expected = host ? `${req.protocol}://${host}` : '';
        if (expected && new URL(origin).origin === expected) return next();
    } catch (error) {
        // A malformed Origin is not something a browser produces.
    }

    return res.status(403).json({ error: "Cross-origin request refused." });
}

module.exports = { csrfOriginGuard };
