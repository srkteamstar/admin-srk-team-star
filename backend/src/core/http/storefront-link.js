/*
 * core/http/storefront-link.js — the one HTTP link to the storefront
 * ============================================================================
 *
 * THE TWO APPLICATIONS MEET AT THE DATABASE, NOT OVER HTTP.
 *
 * Everything an administrator changes here — a product, a category, an order
 * status, a project's visibility — reaches the storefront because both
 * processes read and write the same Supabase project. Neither calls the
 * other's API to make that happen, and that is the point: an outage on one
 * side cannot take the other down, and there is no shared secret between them
 * beyond the database credentials each already holds.
 *
 * What DOES need a link is the person. The dashboard's logo used to be an
 * `<a href="/index.html">` back to the storefront, which worked while both
 * were served by one process and means "the dashboard" now that they are not.
 *
 * A REDIRECT ROUTE RATHER THAN A HARD-CODED URL IN THE MARKUP. The storefront
 * lives at a different origin in production than it does on a developer's
 * machine, and the dashboard is a plain HTML file with no template step. A
 * route reads the environment at boot, so the page can keep a relative href
 * and the deployment decides where it goes. It also keeps `form-action 'self'`
 * and the rest of the CSP untouched — a navigation is not a fetch, and nothing
 * on the page has to know the storefront's address.
 *
 * 302 rather than 301: a permanent redirect is cached by the browser
 * indefinitely, and STOREFRONT_URL is configuration, not a fact about the web.
 */
const STOREFRONT_URL = (process.env.STOREFRONT_URL || '').trim().replace(/\/+$/, '');

/**
 * The storefront's origin, for the callers that need it as an origin rather
 * than as a destination — core/http/cors.js grants it, and
 * core/http/security-headers.js names it in connect-src.
 *
 * Empty when STOREFRONT_URL is unset or unparseable, and every caller treats
 * empty as "grant nothing", so a missing variable narrows the policy rather
 * than widening it.
 */
const STOREFRONT_ORIGIN = (() => {
    try {
        return new URL(STOREFRONT_URL).origin;
    } catch (error) {
        return '';
    }
})();

/** @returns {import('express').Router} */
function storefrontRedirect() {
    const express = require('express');
    const router = express.Router();

    router.get('/storefront', (req, res) => {
        if (!STOREFRONT_URL) {
            // Said out loud rather than 404-ed. A missing STOREFRONT_URL is an
            // incomplete deployment, and the operator reading this is the only
            // person who can fix it.
            return res
                .status(503)
                .type('text/plain')
                .send('STOREFRONT_URL is not configured on this deployment. See backend/.env.example.');
        }

        res.redirect(302, STOREFRONT_URL);
    });

    return router;
}

module.exports = { storefrontRedirect, STOREFRONT_URL, STOREFRONT_ORIGIN };
