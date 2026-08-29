/*
 * modules/auth/infrastructure/auth-rate-limit.js
 * ============================================================================
 *
 * One limiter dedicated to the one administrator sign-in route. It bounds both
 * identifier probing and password guessing without coupling the budget to an
 * unrelated form.
 */
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { supabase } = require('../../../core/database/supabase');
const { normalizeEmail, normalizePhone, looksLikeEmail } = require('../domain/identifier');
const { SupabaseRateLimitStore } = require('./supabase-rate-limit-store');

// Authentication is credentialed, but rate limiting still bounds guessing and
// account enumeration. Tighter than the form limiter, not looser.
const common = {
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again in a few minutes." }
};

const authIpLimiter = rateLimit({
    ...common,
    identifier: 'admin-login-ip',
    store: new SupabaseRateLimitStore(supabase, 'ip:')
});

const authIdentifierLimiter = rateLimit({
    ...common,
    identifier: 'admin-login-identifier',
    store: new SupabaseRateLimitStore(supabase, 'identifier:'),
    keyGenerator: req => {
        const raw = String((req.body && req.body.identifier) || '').trim();
        const normalized = looksLikeEmail(raw) ? normalizeEmail(raw) : normalizePhone(raw);
        return crypto
            .createHmac('sha256', process.env.SESSION_SECRET)
            .update(normalized || 'missing')
            .digest('hex');
    }
});

module.exports = { authLimiters: [authIpLimiter, authIdentifierLimiter] };
