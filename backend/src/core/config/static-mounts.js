/*
 * core/config/static-mounts.js — the URL -> folder contract, written once
 * ============================================================================
 *
 * This table is the single statement of that mapping. Two things read it, and
 * that is what stops it drifting:
 *
 *   core/http/static-files.js   mounts each entry on the app, in order
 *   tools/verify-links.js       resolves every href/src in the dashboard and
 *                               every module against these mounts, so a
 *                               reference that no mount can serve fails the
 *                               build rather than 404-ing in production
 *
 * ORDER MATTERS. Express tries mounts in the order they are registered, so the
 * narrow prefixes (`/js`, `/assets`) come before the two that answer at the
 * root. `public` precedes `pages` because a file that must answer from the
 * site root should win over a same-named page.
 *
 * THE DASHBOARD IS THIS SITE'S INDEX. In the storefront repository it was
 * `/admin-dashboard.html`, one document among twenty-two. It is the only
 * document here, so it is `index.html` and the console answers at `/`. Nothing
 * bookmarked the old URL that is not also being repointed at a new host.
 */
const paths = require('./paths');

/**
 * @typedef {object} StaticMount
 * @property {string} urlPrefix  the mount point, '/' for the site root
 * @property {string} dir        the directory served there
 * @property {string} why        what lives here, for the verifier's messages
 */

/** @type {StaticMount[]} */
const STATIC_MOUNTS = [
    {
        urlPrefix: '/js',
        dir: paths.JS_ROOT,
        why: 'browser modules — platform, shared and the admin feature folder'
    },
    {
        urlPrefix: '/assets',
        dir: paths.ASSETS_ROOT,
        why: 'the logo, the vendored fonts and the compiled stylesheet'
    },
    {
        urlPrefix: '/',
        dir: paths.PUBLIC_ROOT,
        why: 'files that must answer from the site root (robots.txt)'
    },
    {
        urlPrefix: '/',
        dir: paths.PAGES_ROOT,
        why: 'the dashboard document'
    }
];

/**
 * Server-rendered URLs that no mount can satisfy because no file sits behind
 * them. `/` is index.html by way of a sendFile, and `/storefront` is the
 * redirect in core/http/storefront-link.js — the dashboard's logo links it, so
 * the verifier has to know it is a real destination or every run would report
 * a broken link on the one page this site has.
 */
const ROUTED_URLS = [
    '/',
    '/storefront'
];

module.exports = { STATIC_MOUNTS, ROUTED_URLS };
