# Architecture

The SRK Team Star administration console, arranged as a **modular monolith**:
one process, one deployment, and boundaries between features that a tool
refuses to let you cross by accident.

This is the same shape the storefront has, because it *is* the storefront's
shape — this repository was cut out of it. `README.md` says how to run it;
`AGENTS.md` says how to work in it.

---

## What this is, and what it is not

This is the storefront repository's administration half, **moved, not
rewritten**.

Every route answers on the path it answered on before. Every browser module
keeps its filename and its `window.*` global. `admin-dashboard.html` became
`frontend/pages/index.html` and that is the only rename: the console is now the
whole of a site rather than one document inside one, so it answers at `/`.

What changed is where it runs and what it can see:

| | before | now |
|---|---|---|
| Process | shared with the storefront | its own |
| Origin | `/admin-dashboard.html` on the shop's hostname | its own hostname |
| Session cookie | `srk_sid`, shared with shoppers | `srk_admin_sid`, admins only |
| Routes in the process | 46, half of them public | 33, none of them public |
| `core/` and `shared/` | one copy | copied, and now divergent |
| Reaching the storefront | a function call away | a database away |

---

## The split, and the one decision behind it

**The two applications meet at the database.** Not over HTTP, not through a
shared module, not through a shared session.

That was a choice, and the alternative was real: keep the admin API in the
storefront process and deploy only the HTML separately. It would have been a
smaller change. It was rejected because it does not deliver what splitting is
for — the storefront process would still carry every route that can delete a
product or suspend a customer and still be one missing `requireAdmin` away from
disaster. Moving the pages without moving the power is theatre.

So the whole vertical moved: the controllers, the repositories they use and
the guards. What is left in the storefront is a process with no privileged
route in it at all.

### What that costs, stated plainly

**The service-role key is now in two places.** Both processes hold a credential
that bypasses every RLS policy. That is strictly worse than one, and it is the
price of two deployments against one Supabase project. Rotation is a two-place
job. Splitting the database credential — a second Supabase role, or RLS
policies that distinguish the two — is the obvious next step and is not done.

**Some code is duplicated rather than shared.** `core/` and `shared/` were
copied, and the copies will drift. A fix to `postgrest-errors.js` here does not
reach the storefront. This is the ordinary cost of two repositories and it is
better than the alternative — a shared package neither repository owns, whose
version becomes a third thing to deploy — but it means a bug found in one is
worth grepping for in the other.

**A test that spanned both sides had to pick one.** "A blocked customer's live
session stops working" needs an admin to do the blocking and a shopper to feel
it. The write is asserted here; the consequence is asserted in the storefront's
suite. Neither suite proves the whole sentence any more. That is written down
in both, at the assertion, rather than left to be discovered.

---

## What came across, and what did not

```
core/                            shared/
├── config/                      ├── validation.js
│   ├── app-settings.js          ├── text.js
│   ├── paths.js                 └── contracts/order-status.js
│   └── static-mounts.js
├── database/
│   ├── supabase.js
│   └── postgrest-errors.js
├── health/probes.js
├── http/
│   ├── cors.js  csrf.js  security-headers.js  body-parsing.js
│   ├── session.js  private-paths.js  static-files.js  not-found.js
│   └── storefront-link.js       ← the only new file in core/
├── security/guards.js
└── uploads/image-upload.js
```

**Left behind, because this process cannot do the things they are for:**
`core/config/commercial.js` and `core/config/payments.js`,
`core/gateways/razorpay.js`, `shared/money.js`,
`shared/contracts/order-reference.js` and `shared/contracts/payment.js`. There
is no cart, no checkout, no payments module and no legal route either. This
console never takes money and never renders a public page.

**`core/security/guards.js` kept `requireAdmin` and dropped `requireCustomer`
and `roleIdByName`.** Both of those belong to a storefront: one admits a shopper
to a cart and an order history, the other stamps the customer role on an
account being created. Neither has a caller here, and an exported guard with no
caller is a door waiting for somebody to decide it implies a route.

**`core/http/storefront-link.js` is the only file that did not exist before.**
It reads `STOREFRONT_URL` once at boot and serves `GET /storefront` as a redirect
(which is what the dashboard's logo links). It grants no CORS or `connect-src`
access: the console's API and browser connections remain same-origin.

---

## The modules

Nine bounded contexts, each the administration half of one the storefront also
has — except `customers`, which came across whole because an administrator's
view of `user_profiles` was never anything but administration.

| Module | Owns | Routes |
|---|---|---|
| `auth` | the console's door and the session behind it | 3 |
| `enquiries` | `enquiries` as a worklist | 3 |
| `quotes` | `quote_requests` as a worklist | 3 |
| `projects` | `upcoming_projects`, the section switch | 6 |
| `categories` | `categories`, the image bucket | 4 |
| `products` | `products`, `product_images` | 4 |
| `orders` | fulfilment status and tracking, order confirmation and refund records | 4 |
| `customers` | accounts, suspension and deletion | 3 |
| `dashboard` | bounded aggregate read model for the console home | 1 |

There is **one cross-module edge**, and `tools/verify-boundaries.js` prints it
on every run:

```
categories -> products     countProductsByCategory
```

A read port: narrow, query-shaped, side-effect free. The storefront's other
three edges — `checkout → products`, `checkout → auth`, `orders → payments` —
all belonged to modules that did not come across.

---

## Serving: four mounts, and one document

```
/js       → frontend/js
/assets   → frontend/assets
/         → frontend/public      (robots.txt)
/         → frontend/pages       (index.html — the dashboard)
```

The backend is not under any of them at any depth, so no path a request can
spell reaches it. `core/http/private-paths.js` is kept anyway: it costs one
regex per request, it refuses stray `.md`/`.sql`/`.log` files that end up under
`frontend/`, and it carries the `X-Robots-Tag` rule.

**That header is unconditional here, and that is the difference from the
storefront.** There, two paths out of twenty-two were listed by name because
the rest of the site is meant to be found. This entire origin is an internal
console, so every response carries `noindex` rather than a list that would need
an entry the day somebody adds a second page.

**The CSP has no per-document grants.** The storefront scans its pages for a
Google Maps placeholder and the Razorpay checkout, because it has twenty-two
documents and a hand-written list would go stale. This site has one document
and it carries neither marker, so `frame-src 'none'` is simply true.

---

## Verification

```
npm run verify           four structural checks, ~1s, no network, no database
npm test                 66 API assertions against the real server.js
npm run test:browser     4 Playwright checks on the one document
npm run test:all         all of it
```

**`verify-boot` compares the assembled route table against
`tools/api-surface.json` in both directions**, and the second direction is what
enforces the split. The storefront's routes are not in that contract, so a
public catalogue controller copied back across to save a round trip fails the
build before it reaches a deployment. `test/authz.test.js` section 2 asks this
process for six of the storefront's routes and expects 404 on every one, which
is the same rule asserted from the outside.
