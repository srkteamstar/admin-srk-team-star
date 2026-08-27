/*
 * modules/enquiries/domain/enquiry-status.js
 * ============================================================================
 */
// quote and order equivalents of this route have always validated against
// their own lists; this one wrote req.body.status straight through, so any
// string at all — of any length, from a session that had merely been
// hijacked or an XSS on the dashboard — became the status of a real support
// ticket, and the tab would then render it as an unknown state forever.
// Admin-only is a reason to trust the *person*, not the request body.
const ENQUIRY_STATUSES = ['Open', 'In Progress', 'Resolved'];

module.exports = { ENQUIRY_STATUSES };
