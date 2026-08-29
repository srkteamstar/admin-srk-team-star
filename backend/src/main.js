/*
 * src/main.js — the composition root
 * ============================================================================
 *
 * THE ONE FILE THAT KNOWS THE WHOLE APPLICATION EXISTS.
 *
 * This is the administration console, split out of the storefront repository
 * and deployed on its own origin. It is the same modular monolith the
 * storefront is — core/ · shared/ · one folder per bounded context — carrying
 * only the half that answers to an administrator. See ARCHITECTURE.md for what
 * was copied, what was left behind and why the two are separate deployments.
 *
 * Nothing else here registers itself as a side effect of being required. Every
 * middleware in core/ and every module under modules/ exports a function that
 * RETURNS something — a handler, a router — and this file is where those are
 * put in order.
 *
 * MIDDLEWARE ORDER IS BEHAVIOUR, NOT STYLE. Two places in it are load-bearing:
 *
 *   trust proxy FIRST, before anything reads `req.ip` — the sign-in limiter
 *   keys on it, and a limiter that runs before the setting is applied is a
 *   limiter counting the wrong thing.
 *
 *   the body parsers BEFORE the session and before any route.
 *
 * WHAT IS NOT HERE, AND DELIBERATELY. There is no cart, no checkout, no
 * payments module and no Razorpay gateway: this process never takes money and
 * never holds a shopper's session. There is no legal route and no public
 * catalogue route either — every one of those is the storefront's, answered on
 * the storefront's own origin. The two applications meet at the database, not
 * over HTTP; the single HTTP link between them is GET /storefront below.
 */
const express = require('express');

// ---- core: the application's own settings and infrastructure ---------------
const { applyAppSettings } = require('./core/config/app-settings');
const { corsMiddleware } = require('./core/http/cors');
const { csrfOriginGuard } = require('./core/http/csrf');
const { securityHeaders } = require('./core/http/security-headers');
const { jsonBodyParser, formBodyParser } = require('./core/http/body-parsing');
const { sessionMiddleware } = require('./core/http/session');
const { privatePathGuard } = require('./core/http/private-paths');
const { mountStaticFiles } = require('./core/http/static-files');
const { storefrontRedirect } = require('./core/http/storefront-link');
const { apiNotFound } = require('./core/http/not-found');
const { finalErrorHandler } = require('./core/http/errors');
const { requestContext } = require('./core/security/audit-events');
const { healthRouter } = require('./core/health/probes');

// ---- modules: one bounded context each ------------------------------------
const { enquiriesModule } = require('./modules/enquiries/enquiries.module');
const { quotesModule } = require('./modules/quotes/quotes.module');
const { projectsModule } = require('./modules/projects/projects.module');
const { categoriesModule } = require('./modules/categories/categories.module');
const { productsModule } = require('./modules/products/products.module');
const { ordersModule } = require('./modules/orders/orders.module');
const { customersModule } = require('./modules/customers/customers.module');
const { authModule } = require('./modules/auth/auth.module');
const { dashboardModule } = require('./modules/dashboard/dashboard.module');

/**
 * Builds the application without starting it, so a test can hold an app it
 * never listens on.
 *
 * @returns {import('express').Express}
 */
function createApp() {
    const app = express();

    applyAppSettings(app);

    // ---- request pipeline, in the order a request meets it -----------------
    app.use(requestContext);
    app.use(corsMiddleware);
    app.use(csrfOriginGuard);
    app.use(securityHeaders);
    app.use(jsonBodyParser);
    app.use(formBodyParser);
    app.use(sessionMiddleware);
    app.use(privatePathGuard);

    // Before the static mounts so a probe is never a filesystem lookup, and
    // outside /api so the default-deny at the bottom does not claim it.
    app.use('/health', healthRouter());

    // The one link back to the storefront, and it must precede the static
    // mounts for the same reason the storefront's legal route does: there is
    // no file behind it.
    app.use(storefrontRedirect());

    // The dashboard. Everything below this line is API.
    mountStaticFiles(app);

    // ---- the modules -------------------------------------------------------
    // Same order the storefront registers its own in, so a difference between
    // the two repositories is never a difference in registration order.
    app.use(enquiriesModule());
    app.use(quotesModule());
    app.use(projectsModule());
    app.use(categoriesModule());
    app.use(productsModule());
    app.use(ordersModule());
    app.use(customersModule());
    app.use(dashboardModule());
    app.use(authModule());

    // Registered after every module, so it only ever sees what nothing claimed.
    app.use('/api', apiNotFound);

    // Last in every runtime so parser errors, rejected async handlers and any
    // future middleware failure share one non-disclosing JSON response.
    app.use(finalErrorHandler);

    return app;
}

/**
 * Builds the application and starts listening.
 *
 * @returns {import('http').Server}
 */
function start() {
    const app = createApp();
    const PORT = process.env.PORT || 3100;
    return app.listen(PORT, () => console.log(`Admin console running on port ${PORT}`));
}

module.exports = { createApp, start };
