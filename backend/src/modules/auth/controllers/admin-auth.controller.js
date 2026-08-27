/*
 * modules/auth/controllers/admin-auth.controller.js - the dashboard door
 * ============================================================================
 *
 *   POST /api/admin/login     administrator identifier + password
 *   GET  /api/admin/session   is an administrator signed in?
 *   POST /api/auth/logout     destroy the session
 *
 * SEPARATE FROM THE STOREFRONT DOOR, and that separation is load-bearing
 * rather than tidy. An administrator used to sign in through the storefront
 * overlay and be recognised by their role, which made them into a storefront
 * customer: greeted by name, offered an order history and a delivery address
 * that an admin row planted by hand has none of. Each patch that hid one of
 * those was reasonable; the sum was a role leaking through a storefront it had
 * no business being in, held back by a list of special cases a future surface
 * would forget to add to.
 *
 * The route accepts the same kind of identifier as the storefront door, but
 * it only opens an administrator-scoped session after checking both the role
 * and the password hash stored on that administrator's profile.
 */
const express = require('express');
const { sessionScope, sessionProfile, isBlocked, BLOCKED_MESSAGE, roleNameById } = require('../../../core/security/guards');
const { trimmed } = require('../../../shared/validation');
const { adminIdentity } = require('../services/profile-view.service');
const { resolveIdentifier, startSession } = require('../services/session.service');
const { passwordProblem, verifyAdminPassword } = require('../services/admin-password.service');
const { authLimiter } = require('../infrastructure/auth-rate-limit');

// A valid scrypt value used for accounts that do not exist, are not admins, or
// have no credential. Performing the same expensive verification keeps the
// generic refusal from becoming a useful timing oracle.
const REFUSAL_PASSWORD_HASH = 'scrypt$14af768da0c8b4a8f0d88351ee1d1538$409619e06ff5086fd5a253d9b03da3b1af26d2ed09851e018950c172e7f09b1d14739115e551e57e8df8e2e168806ca64e4e9e024bb4bc4914e13bdbf85b7b5e';

/** @returns {import('express').Router} */
function adminAuthController() {
    const router = express.Router();

    // ---- Sign in — ADMINISTRATORS -----------------------------------------------
    // The dashboard's own door, and the only way an admin session comes to exist.
    //
    // WHY THIS IS NOT THE STOREFRONT ROUTE WITH A ROLE CHECK. It was exactly that
    // until now, and the cost was that an administrator came out of it holding a
    // storefront session: the account overlay painted "Hello, Admin", asked for a
    // delivery address and offered an order history, for a row planted directly
    // into user_profiles by hand that has none of those things. Every one of those
    // surfaces then needed a special case to suppress what the login had just
    // created, plus a redirect to carry the admin back out of a storefront they
    // had no business landing in.
    //
    // The route has its own per-IP budget. There is no storefront door in this
    // process and no unrelated route that should consume the same counter.
    router.post('/api/admin/login', authLimiter, async (req, res) => {
        const identifier = trimmed(req.body.identifier);
        const password = req.body.password;

        if (!identifier) {
            return res.status(400).json({ field: 'identifier', error: "Enter your administrator email or phone number." });
        }
        const problem = passwordProblem(password);
        if (problem) return res.status(400).json({ field: 'password', error: problem });

        try {
            const profile = await resolveIdentifier(identifier);
            const role = profile ? await roleNameById(profile.role_id) : null;
            const candidateHash = profile && role === 'admin' && profile.password_hash
                ? profile.password_hash
                : REFUSAL_PASSWORD_HASH;
            const passwordMatches = await verifyAdminPassword(password, candidateHash);

            // ONE ANSWER FOR "no such account" AND "not an administrator" —
            // deliberately the opposite of what the storefront door does.
            // There, account_not_found is a fork a customer genuinely needs (try
            // another identifier, or create the account). Here every distinction
            // is a free move for someone guessing: telling them an address
            // resolved but is not an admin hands over the fact worth having. An
            // administrator does nothing differently on either failure, so
            // nothing is lost by saying the same thing to all of them.
            const refuse = () => res.status(401).json({
                field: 'identifier',
                error: "Those administrator credentials are not valid."
            });

            if (!profile || role !== 'admin' || !profile.password_hash || !passwordMatches) return refuse();
            if (isBlocked(profile)) return res.status(403).json({ error: BLOCKED_MESSAGE });

            // 'admin' is what separates this session from a storefront one, and
            // the regenerate inside destroys whatever customer session this
            // browser was holding. Signing in here signs you out of the store —
            // that is the intended behaviour, not a side effect to work around.
            await startSession(req, profile.id, 'admin');

            res.status(200).json({ admin: adminIdentity(profile) });
        } catch (error) {
            console.error("Admin Login Error:", error);
            res.status(500).json({ error: "Could not sign you in." });
        }
    });

    // ---- Who am I — ADMINISTRATORS ----------------------------------------------
    // The dashboard's counterpart to /api/auth/me, and separate for the same
    // reason the login is: /api/auth/me answers the storefront's question ("is a
    // customer signed in?") and now answers null for an admin session by design.
    // Making it serve both would put the admin identity back on the one route
    // every public page calls on every load.
    //
    // 200 with a null admin rather than 401, exactly as /api/auth/me does: this is
    // the question the dashboard asks before it knows the answer, and "nobody" is
    // an ordinary answer rather than a failure.
    router.get('/api/admin/session', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        try {
            if (sessionScope(req) !== 'admin') return res.status(200).json({ admin: null });

            const profile = await sessionProfile(req);
            if (!profile || isBlocked(profile)) return res.status(200).json({ admin: null });

            const role = await roleNameById(profile.role_id);
            if (role !== 'admin') return res.status(200).json({ admin: null });

            res.status(200).json({ admin: adminIdentity(profile) });
        } catch (error) {
            console.error("Admin Session Read Error:", error);
            res.status(500).json({ error: "Could not read your session." });
        }
    });

    // ---- Sign out ---------------------------------------------------------
    // KEEPS THE PATH IT HAD. In the combined repository this route lived in
    // the storefront's customer-auth controller and served both roles, because
    // there was one cookie and one process. Signing out is now two unrelated
    // acts on two origins, so each application owns its own — but the path
    // stays `/api/auth/logout` rather than becoming `/api/admin/logout`,
    // because the dashboard's browser modules call it by name in two places
    // and renaming it would be a behaviour change smuggled into a move.
    router.post('/api/auth/logout', (req, res) => {
        if (!req.session) return res.status(200).json({ success: true });

        req.session.destroy((err) => {
            if (err) {
                console.error("Session Destroy Error:", err);
                return res.status(500).json({ error: "Failed to sign out." });
            }
            res.clearCookie('srk_admin_sid');
            res.status(200).json({ success: true });
        });
    });

    return router;
}

module.exports = { adminAuthController };
