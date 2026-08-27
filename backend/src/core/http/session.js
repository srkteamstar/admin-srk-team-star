/*
 * core/http/session.js — one cookie, two scopes
 * ============================================================================
 *
 * The `scope` a session carries (`'admin'` or absent, meaning customer) is
 * written by modules/auth and read by core/security/guards.js. Nothing else
 * may set it.
 */
const session = require('express-session');
const { supabase } = require('../database/supabase');
const { SupabaseSessionStore } = require('./supabase-session-store');

// ADMIN SESSION
//
// The admin dashboard used to ship its password in cleartext, inside a
// publicly-served JS file, forever — anyone who loaded the site could read it
// from view-source. A session cookie is scoped to a login the admin actually
// performs, is httpOnly (invisible to any JS, first-party or injected), and
// expires. The record behind that cookie lives in Supabase rather than this
// process: serverless requests may land on different Vercel instances, and an
// in-memory record would make a successful login disappear on the next click.
// A session secret is what makes the signed cookie unforgeable. Refusing to
// start is the only safe answer to its absence: the alternative is a process
// that looks healthy while issuing sessions anybody can mint.
//
// A thrown Error, not process.exit(). On a long-running server the effect is
// the same either way — the process never comes up. On Vercel, this module is
// required inside a serverless function invocation, not a process being
// started: process.exit() there kills the whole Lambda sandbox mid-request,
// which Vercel reports as a bare "Serverless Function has crashed" with no
// application log at all. Throwing instead is caught by the platform's own
// invocation wrapper, still refuses to serve a single request, and actually
// prints this message — with a stack trace — to the function's logs.
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error('FATAL: SESSION_SECRET is missing or shorter than 32 characters. Refusing to start.');
}

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET,
    store: new SupabaseSessionStore(supabase),
    // srk_admin_sid, and the name is honest again. In the combined
    // repository this cookie carried storefront shoppers as well, so it was
    // renamed to srk_sid; here it is only ever an administrator. Distinct from
    // the storefront's name on purpose: the two applications are separate
    // origins and so already have separate cookie jars, but if they are ever
    // put behind one hostname on different paths, two names is the difference
    // between "signing into one signs you out of the other" and a silent
    // collision.
    name: 'srk_admin_sid',
    resave: false,
    saveUninitialized: false,
    // Refresh an active operator's expiry, but do not leave a privileged cookie
    // valid for weeks after the dashboard was last used.
    rolling: true,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // 'auto' rather than a NODE_ENV test. The old form meant a
        // deployment that simply forgot to set NODE_ENV=production shipped
        // the session cookie over plain HTTP, and nothing about the site
        // would look wrong while it did. 'auto' asks the connection instead
        // of an environment variable: secure over TLS, and still usable on a
        // plain-HTTP dev server, with no flag to forget in either direction.
        secure: 'auto',
        // Eight hours of inactivity. Credentials are checked when the session
        // opens; role and suspension are still re-read on every request.
        maxAge: 8 * 60 * 60 * 1000
    }
});

module.exports = { sessionMiddleware };
