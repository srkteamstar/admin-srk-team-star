/*
 * modules/customers/customers.module.js - the module registration file
 * ============================================================================
 *
 * WHAT THIS MODULE OWNS
 *   the administrator's view of user_profiles
 *   GET    /api/customers              admin
 *   PATCH  /api/customers/:id/status   admin - block / unblock
 *   DELETE /api/customers/:id          admin - refuses a customer with orders
 *
 * IT DOES NOT OWN THE ACCOUNT. Accounts are created by the storefront and by
 * guest checkout, never by an administrator, which is why there is no POST and
 * no general PATCH here: modules/auth owns the profile a customer edits, and
 * this module owns what an administrator may do ABOUT a customer.
 *
 * Nothing is hidden from an administrator by a block. The row, its orders and
 * its address stay exactly where they were, with a badge - blocking is about
 * the front door, not about deleting evidence.
 *
 * THE ORIGINAL SECTION HEADER
 *
 *
 * A CRM view over user_profiles. Accounts are still created by the storefront
 * and never by admin, so there is no POST and no general PATCH — the two
 * writes here are the two an administrator genuinely owns:
 *
 *   PATCH /api/customers/:id/status   suspend or restore an account
 *   DELETE /api/customers/:id         remove a profile that has no orders
 *
 * Both refuse two targets outright, and the refusals are the interesting
 * part:
 *
 *   * the caller's own row — an administrator who blocks or deletes
 *     themselves has locked the dashboard with the key inside;
 *   * any row whose role is `admin` — making an admin inert stays what
 *     granting the role already is, a hand edit in the Supabase table
 *     editor. A dashboard button that can lock every administrator out is a
 *     self-inflicted outage one misclick away.
 *
 * DELETE is narrow on purpose. `orders.user_id` is NOT NULL, so removing a
 * profile that has ever ordered either fails on the foreign key or orphans
 * an invoice — and an order is a financial record, not a convenience. So a
 * customer with orders is refused by name and the answer says what to do
 * instead (block them; it is reversible and it is what suspending an account
 * actually means).
 */
const express = require('express');
const { adminCustomersController } = require('./controllers/admin-customers.controller');

/** @returns {import('express').Router} */
function customersModule() {
    const router = express.Router();
    router.use(adminCustomersController());
    return router;
}

module.exports = { customersModule };
