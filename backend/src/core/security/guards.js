/*
 * core/security/guards.js — who is asking, and are they allowed
 * ============================================================================
 *
 * The doctrine puts "core authentication guards and generic role-based access
 * control resolvers" in core/, and that is exactly what these are: they answer
 * "is there a session, whose is it, and what may it do" without knowing a
 * single thing about enquiries, carts or orders. Every module imports them;
 * they import no module.
 *
 * modules/auth OPENS a session (it owns the admin door and what it demands).
 * This file READS one. The split matters: a route that can create a session is
 * a route that can grant access, and there is exactly one in this process. It
 * is rate limited; everything else only ever reads the session here.
 *
 * The comment below is the original and is worth keeping whole — it is the
 * record of why the two roles have two doors.
 */
const { supabase } = require('../database/supabase');
const { sessionCredentialMatches } = require('./session-credentials');
const { errorTag } = require('../../shared/error-tag');

// AUTHORIZATION
//
// THE TWO ROLES SIGN IN THROUGH TWO DIFFERENT DOORS, AND HOLD TWO
// DIFFERENT KINDS OF SESSION.
//
// An administrator used to sign in through the storefront account overlay
// and be recognised here by their role. That was one door with a second
// factor bolted onto it for one of the two roles walking through, and it
// leaked in both directions: an admin who signed in came back as a
// storefront customer — "Hello, Admin", a delivery address, an order
// history — none of which an `admin` row planted by hand in user_profiles
// has or should have, and all of which the store had to special-case to
// hide. The redirect that papered over it (sign in on the store, get
// bounced to the dashboard) was the tell.
//
// So the doors are separate now:
//
//   POST /api/auth/login    storefront process. Customer password + role.
//   POST /api/admin/login   this process. Administrator password + role.
//
// and the session records WHICH door it came through, in `req.session.scope`.
// The role in the database says what someone may be; the scope says what
// they signed in AS. Both are checked, because either alone is a hole:
// without the role check a scope could be forged by a future route that
// forgets to set it; without the scope check an admin session would still
// satisfy requireCustomer and reappear on the storefront.
//
// ONE COOKIE, STILL. That is deliberate and is the mechanism behind "signing
// into the dashboard signs you out of the store": startSession regenerates
// the session, so an admin sign-in destroys whatever customer session the
// same browser was holding. There is never a moment where one browser is
// both.
//
// The role is still read from the database on every request rather than
// stamped into the session at login, so revoking someone's admin takes
// effect immediately instead of whenever their cookie happens to expire.
// What keeps the door shut is unchanged: nothing can *raise* a role. Signup
// hard-codes the customer role, PATCH /api/auth/me refuses role_id,
// POST /api/checkout refuses to adopt or create a non-customer profile, and
// making someone an admin is a hand edit in the Supabase table editor.
//
// These are `function` declarations so they hoist above the route table
// below, which evaluates its middleware arguments at load time.

// roles has two rows and gains more roughly never, so one query per process
// beats one per admin request. A restart is the cache invalidation.
let rolesCache = null;
async function roleNameById(id) {
    if (id === null || id === undefined) return null;

    if (!rolesCache) {
        const { data, error } = await supabase.from('roles').select('id, role_name');
        if (error) throw error;
        rolesCache = new Map((data || []).map(r => [String(r.id), String(r.role_name || '').toLowerCase()]));
    }

    return rolesCache.get(String(id)) || null;
}


// The signed-in profile, or null. Read fresh every time: a profile deleted
// from under a live cookie has to read as signed out, not as a ghost.
async function sessionProfile(req) {
    const id = req.session && req.session.customerId;
    if (!id) return null;

    const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

// Set by an administrator through PATCH /api/customers/:id/status. Checked
// on every request that reads a session rather than only at sign-in, so
// blocking somebody who is already signed in takes effect on their next
// click instead of whenever their eight-hour cookie happens to expire — the same
// reasoning requireAdmin gives for reading the role fresh every time.
const isBlocked = (profile) => !!profile && profile.is_blocked === true;

const BLOCKED_MESSAGE = "This account has been suspended. Contact us if you think that is a mistake.";

// The scope a session was opened with. Absent on a session issued before
// scopes existed, and that reads as a customer: those are storefront
// sessions by construction. Treating them as unscoped-and-therefore-suspect
// would sign out every shopper on deploy for no gain. An ADMIN session is
// never inferred — it has to say so.
const sessionScope = (req) => (req.session && req.session.scope) === 'admin' ? 'admin' : 'customer';

// 401 and 403 are deliberately different answers, and the dashboard treats
// them differently: 401 means "nobody is signed in here" and paints the
// dashboard's own sign-in form; 403 means "somebody is, but not as an
// admin" and must NOT bounce anywhere, or an ordinary visitor who opens the
// dashboard URL is put in an unbreakable reload loop.
//
// BOTH the scope and the role are required. A customer-scope session on an
// admin row answers 401, not 403 — from this route's point of view nobody
// has signed in at the admin door, and the honest next step is to offer it
// rather than to say "you are not an administrator" to someone who is.
async function requireAdmin(req, res, next) {
    try {
        if (sessionScope(req) !== 'admin') {
            return res.status(401).json({ error: "Not signed in." });
        }

        const profile = await sessionProfile(req);
        if (!profile) {
            return res.status(401).json({ error: "Not signed in." });
        }

        if (!sessionCredentialMatches(req, profile)) {
            req.session.destroy(() => {});
            res.clearCookie('srk_admin_sid');
            return res.status(401).json({ error: "Your administrator session expired. Sign in again." });
        }

        // Read fresh every request: an administrator demoted or suspended
        // under a live cookie loses access on their next click, not when
        // the cookie expires.
        if (isBlocked(profile)) {
            return res.status(403).json({ error: BLOCKED_MESSAGE });
        }

        const role = await roleNameById(profile.role_id);
        if (role !== 'admin') {
            return res.status(403).json({ error: "This account is not an administrator." });
        }

        req.profile = profile;
        next();
    } catch (error) {
        console.error("Admin check failed:", errorTag(error));
        res.status(500).json({ error: "Could not verify your session." });
    }
}

module.exports = {
    roleNameById,
    sessionProfile,
    isBlocked,
    BLOCKED_MESSAGE,
    sessionScope,
    requireAdmin
};

// requireCustomer AND roleIdByName ARE DELIBERATELY NOT HERE. Both belong to
// the storefront: one admits a shopper to a cart and an order history, the
// other stamps the customer role on an account being created at signup or at
// guest checkout. This process has no signup, no checkout and no storefront
// surface, so carrying either would be publishing a door nothing opens. They
// remain in the storefront repository, which is the only place they are used.
