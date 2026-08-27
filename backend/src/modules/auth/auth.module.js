/*
 * modules/auth/auth.module.js - the module registration file
 * ============================================================================
 *
 *
 * Owns the administrator door against user_profiles and the session it opens.
 *
 * PASSWORD-BASED ADMINISTRATOR ACCESS
 * -----------------------------------
 * Sign-in resolves an email or phone identifier, checks the administrator role
 * and verifies password_hash before starting an administrator-scoped session.
 * ==========================================
 *
 * Digits only, so "+91 89015 03544", "089015 03544" and "8901503544" all
 * resolve to one account. Written to phone_normalized on every write; the
 * as-typed string stays in phone_number for display and for calling back.
 *
 * The two special cases are India's, because that is the catalogue's market:
 * a 12-digit number starting 91 has the country code on the front, and an
 * 11-digit number starting 0 has the trunk prefix. Anything else is kept
 *
 * WHAT THIS MODULE OWNS
 *   user_profiles as the ACCOUNT (modules/customers owns the administrator's
 *   management view of the same table), and the dashboard sign-in door.
 *
 *   POST /api/admin/login
 *   GET  /api/admin/session
 *   POST /api/auth/logout
 *
 * NOTHING HERE CAN RAISE A ROLE, and that is the whole admin boundary.
 * No route or UI grants admin. Making somebody an administrator is a hand edit
 * in the Supabase table editor; the credential setter refuses to change roles.
 *
 * READING A SESSION IS NOT THIS MODULE'S JOB. core/security/guards.js does
 * that, and every other module imports it from there. This module is the only
 * one that OPENS a session, which is why both doors are here, both are behind
 * one rate limiter, and there is exactly one sign-in route.
 */
const express = require('express');
const { adminAuthController } = require('./controllers/admin-auth.controller');

/** @returns {import('express').Router} */
function authModule() {
    const router = express.Router();
    router.use(adminAuthController());
    return router;
}

module.exports = { authModule };
