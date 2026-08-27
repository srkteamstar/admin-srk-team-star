/*
 * modules/auth/services/session.service.js - resolving, and opening
 * ============================================================================
 *
 * THESE TWO ARE DELIBERATELY SEPARATE FUNCTIONS, and the separation is the
 * seam a real second factor for CUSTOMERS drops into.
 *
 * resolveIdentifier() answers "whose account is this?". startSession() answers
 * "let them in". Today the storefront login calls one and then the other with
 * nothing in between, which is exactly the weakness written up in the module
 * header: knowing an identifier is owning the account. Mailing or texting a
 * one-time code is a step BETWEEN these two calls - it needs no change to the
 * route's shape, to the browser module, or to the overlay.
 *
 * startSession() regenerates the session first. That is what makes signing in
 * at one door sign you out of the other: a browser is a customer or an
 * administrator, never both, and that is a property of this function rather
 * than a rule somebody has to remember.
 */
const { supabase } = require('../../../core/database/supabase');
const { trimmed } = require('../../../shared/validation');
const { normalizePhone, normalizeEmail, looksLikeEmail } = require('../domain/identifier');

async function resolveIdentifier(identifier) {
    const value = trimmed(identifier);
    if (!value) return null;

    const query = supabase.from('user_profiles').select('*');

    const { data, error } = looksLikeEmail(value)
        ? await query.eq('email', normalizeEmail(value)).maybeSingle()
        : await query.eq('phone_normalized', normalizePhone(value)).maybeSingle();

    if (error) throw error;
    return data || null;
}

// Regenerated on every sign-in so a session id issued beforehand can never be
// reused to piggyback onto this one — standard fixation defence.
//
// `scope` is which door this session came through, and it is the whole of
// "signing into the dashboard signs you out of the store": one cookie plus a
// regenerate means the admin session REPLACES the customer one in that
// browser rather than sitting alongside it. Defaults to the storefront, so a
// route has to ask for an admin session explicitly — a new sign-in path that
// forgets the argument creates a customer session, which is the failure that
// costs nothing.
function startSession(req, customerId, scope) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((err) => {
            if (err) return reject(err);
            req.session.customerId = customerId;
            req.session.scope = scope === 'admin' ? 'admin' : 'customer';
            req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
        });
    });
}

// Both roles use identifier-based access by product decision. Administrators
// still use a separate dashboard-only route; the storefront route never
// creates an admin session.

module.exports = { resolveIdentifier, startSession };
