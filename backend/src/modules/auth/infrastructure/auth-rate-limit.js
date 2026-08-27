/*
 * modules/auth/infrastructure/auth-rate-limit.js
 * ============================================================================
 *
 * One limiter dedicated to the one administrator sign-in route. It bounds both
 * identifier probing and password guessing without coupling the budget to an
 * unrelated form.
 */
const rateLimit = require('express-rate-limit');

// Authentication is credentialed, but rate limiting still bounds guessing and
// account enumeration. Tighter than the form limiter, not looser.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: "Too many attempts. Try again in a few minutes." }
});

module.exports = { authLimiter };
