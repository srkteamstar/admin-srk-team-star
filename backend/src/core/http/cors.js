/*
 * core/http/cors.js — the origin allow list
 * ============================================================================
 *
 * Exports the list as well as the middleware, because core/http/csrf.js has to
 * agree with it: an origin this app is willing to answer with credentials is
 * the same origin it is willing to accept a state-changing request from, and
 * two copies of that list would drift.
 */
const cors = require('cors');
const { STOREFRONT_ORIGIN } = require('./storefront-link');

// ==========================================
// ORIGIN POLICY — an allow list, not a mirror
// ==========================================
//
// `cors({ origin: true })` does not mean "allow my own origin": it REFLECTS
// whatever Origin the caller sent and pairs it with
// Access-Control-Allow-Credentials: true, which is a standing instruction to
// every browser that any site on the internet may read this API's credentialed
// responses. This API can delete every product in the catalogue and suspend
// every customer account, so it is an allow list.
//
// The dashboard is served by this same process, so its own requests are
// same-origin and need no CORS grant at all. The list therefore starts EMPTY.
//
// THE STOREFRONT IS ADMITTED WHEN — AND ONLY WHEN — STOREFRONT_URL SAYS WHERE
// IT IS. Nothing on the storefront calls this API today, and nothing should:
// the public site has no business holding an administrator's session, and the
// two applications already exchange everything they need through the database.
// The entry exists because the split made them two origins and a deployment
// that later wants one to read the other should not have to rediscover which
// of these two files to edit. An unset variable grants nothing.
//
// ALLOWED_ORIGINS remains the manual escape hatch for anything else.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

if (STOREFRONT_ORIGIN && !ALLOWED_ORIGINS.includes(STOREFRONT_ORIGIN)) {
    ALLOWED_ORIGINS.push(STOREFRONT_ORIGIN);
}

const corsMiddleware = cors({
    origin: (origin, callback) => {
        // No Origin header: same-origin navigations, curl, server-to-server.
        // Nothing is granted here — CORS only ever *adds* permission, and a
        // request with no Origin was never subject to it.
        if (!origin) return callback(null, false);
        callback(null, ALLOWED_ORIGINS.includes(origin));
    },
    credentials: true,
    // No PUT: the only route that used it was the storefront's cart, which is
    // not in this application. Kept in step with the real route table rather
    // than copied across, because a method list that grants what does not
    // exist is a list nobody is reading.
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600
});

module.exports = { ALLOWED_ORIGINS, corsMiddleware };
