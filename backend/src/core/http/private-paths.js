/*
 * core/http/private-paths.js — the deny list, and a blanket noindex
 * ============================================================================
 *
 * NOT LOAD-BEARING, AND IT STAYS ANYWAY. The mounts in
 * core/config/static-mounts.js serve `frontend/` and nothing else — the
 * backend is not under a served root at any depth, so there is no path a
 * request can spell that reaches it. That is a stronger guarantee than a deny
 * list, because it cannot be defeated by a pattern nobody thought of.
 *
 * Keeping the guard costs one regex per request and buys two things. It still
 * refuses the extensions (`.md`, `.sql`, `.env`, `.log`) wherever they may end
 * up under `frontend/` — a stray note dropped into the assets tree is denied
 * without anyone having to notice it. And it carries the X-Robots-Tag rule,
 * which was never about privacy in the first place.
 *
 * THE NOINDEX IS UNCONDITIONAL HERE, AND THAT IS THE DIFFERENCE FROM THE
 * STOREFRONT. There, two paths out of twenty-two were listed by name because
 * the rest of the site is meant to be found. This entire origin is an
 * administrator's console: there is no page on it a search engine should hold,
 * so the header goes on every response rather than on a list that would need
 * an entry the day somebody adds a second page. robots.txt says the same thing
 * in the half a crawler can choose to ignore; this is the half it cannot.
 */
const PRIVATE_PATH = /(^|\/)(backend|node_modules)(\/|$)|\.(md|sql|prompt|env|log|bak|db|sqlite|txt|ini|yml|yaml|lock)$/i;

const PRIVATE_EXACT = new Set(['/locator']);

const ALLOW_PUBLIC = /^\/(robots\.txt|ads\.txt|sitemap\.xml|\.well-known\/[\w.-]+)$/i;

function privatePathGuard(req, res, next) {
    // decodeURIComponent so %2e%2e and friends cannot smuggle a segment past
    // the test; a malformed escape is itself reason enough to refuse.
    let pathname;
    try {
        pathname = decodeURIComponent(req.path);
    } catch (error) {
        return res.status(400).send('Bad request');
    }

    // Set before the allow list returns, so even robots.txt carries it.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

    if (ALLOW_PUBLIC.test(pathname)) return next();

    if (PRIVATE_PATH.test(pathname) || PRIVATE_EXACT.has(pathname.toLowerCase())) {
        // 404, not 403: "this does not exist" tells an attacker less than
        // "this exists and you may not have it".
        return res.status(404).send('Not found');
    }

    next();
}

module.exports = { privatePathGuard, PRIVATE_PATH, PRIVATE_EXACT, ALLOW_PUBLIC };
