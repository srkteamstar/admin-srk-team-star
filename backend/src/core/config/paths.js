/*
 * core/config/paths.js — every filesystem root, resolved once
 * ============================================================================
 *
 * Nothing else in the codebase may call `path.join(__dirname, '..')` to reach
 * across a tier. A module that needs a directory asks for it here, so moving a
 * folder is one edit rather than a search.
 *
 * THE STOREFRONT'S ROOTS ARE NOT HERE, AND THERE IS NO PATH TO THEM. The two
 * applications are separate checkouts on separate deployments; this one serves
 * its own `frontend/` and nothing else, at any depth.
 */
const path = require('path');

/** backend/ — the Node application's own root. */
const BACKEND_ROOT = path.join(__dirname, '..', '..', '..');

/** The repository root, the parent of both tiers. */
const PROJECT_ROOT = path.join(BACKEND_ROOT, '..');

/** frontend/ — everything the browser is ever allowed to see. */
const FRONTEND_ROOT = path.join(PROJECT_ROOT, 'frontend');

/** frontend/pages/ — the dashboard document, mounted at `/`. */
const PAGES_ROOT = path.join(FRONTEND_ROOT, 'pages');

/** frontend/js/ — the browser modules, mounted at `/js`. */
const JS_ROOT = path.join(FRONTEND_ROOT, 'js');

/** frontend/assets/ — the logo, the vendored fonts and the compiled stylesheet. */
const ASSETS_ROOT = path.join(FRONTEND_ROOT, 'assets');

/** frontend/public/ — files that must answer from the site root (robots.txt). */
const PUBLIC_ROOT = path.join(FRONTEND_ROOT, 'public');

/** The document `/` and `/index.html` both resolve to: the dashboard itself. */
const INDEX_HTML = path.join(PAGES_ROOT, 'index.html');

module.exports = {
    BACKEND_ROOT,
    PROJECT_ROOT,
    FRONTEND_ROOT,
    PAGES_ROOT,
    JS_ROOT,
    ASSETS_ROOT,
    PUBLIC_ROOT,
    INDEX_HTML
};
