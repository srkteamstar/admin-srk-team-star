/*
 * core/http/cors.js — the origin allow list
 * ============================================================================
 *
 * The dashboard and its API are deliberately same-origin. No other origin is
 * allowed to read credentialed responses from this administrative process.
 */
const cors = require('cors');

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
const corsMiddleware = cors({
    origin: false,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600
});

module.exports = { corsMiddleware };
