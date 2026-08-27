/*
 * core/http/not-found.js — every /api path no module claimed
 * ============================================================================
 *
 * Mounted last in main.js, after every module's router, so it only ever sees
 * what nothing declared.
 */
// ==========================================
// DEFAULT DENY — every /api path not declared above
// ==========================================
//
// Registered after every route, so it only ever sees what nothing claimed.
//
// Two things were wrong with letting these fall through to the static
// handler and then to Express's finalhandler. It answered an API call with
// an HTML error document, so a client parsing JSON got a syntax error rather
// than a status it could act on; and the body echoed the method and path
// back ("Cannot GET /api/whatever"), which turns the 404 into a confirmation
// oracle for probing route shapes.
//
// A fixed JSON body says nothing about what does exist. It is also what
// answers every storefront route this application does not have — /api/cart,
// /api/checkout, /api/products/public and the rest are the storefront's, on
// the storefront's origin, and asking this process for one gets the same
// answer as asking for something that was never anywhere.
function apiNotFound(req, res) {
    res.status(404).json({ error: "Not found." });
}

module.exports = { apiNotFound };
