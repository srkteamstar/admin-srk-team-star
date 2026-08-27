# Working in this repository

The SRK Team Star **administration console**. One Node process, one HTML
document, and the API behind it.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for the layout and the reasoning.
Read [`README.md`](README.md) for how to run it. This file is the rules.

---

## The four sentences that matter most

**This console and the storefront share a database and nothing else.** No
shared session, no shared cookie, no API call in either direction. If you find
yourself wanting one, say why in the commit — it is a change to the shape of
the system, not a convenience.

**Run `npm run verify` after moving or renaming any file.** Three checks, about
a second, no network and no database. They catch the failure this structure
makes possible: a reference that points at nothing, a module reaching past a
sibling's published interface, or a route that quietly stopped existing.

**Backend edits do not take effect until the process restarts.** HTML, CSS and
browser JS are read off disk per request; everything under `backend/src/` is
loaded once at boot. The symptom is silence — it reads as "my change did not
save". Use `npm --prefix backend run dev`.

**Adding a Tailwind class needs `npm --prefix backend run build:css`.** The
generated stylesheet is committed. Write whole class names; a name assembled
from pieces will not survive the build.

---

## Do not bring the storefront's routes back

The temptation is specific and it will come up: a tab wants the public
catalogue shape, or a "view this on the store" link wants to check the product
is live. Copying `public-products.controller.js` across would work, and it
would put a public route on an internal console.

Three things refuse it, on purpose:

- `tools/verify-boot.js` compares the route table to `tools/api-surface.json`
  **in both directions**, so an unexpected route fails the build.
- `test/authz.test.js` section 2 asks this process for six storefront routes
  and expects 404 on every one.
- `tools/verify-boundaries.js` prints every cross-module edge, so a new one is
  visible rather than discovered later.

`STOREFRONT_URL` is navigation only: it powers `GET /storefront`. The admin API
and browser `connect-src` are same-origin by design, so a future browser fetch
to the storefront is a security review and an explicit policy change rather
than a dormant cross-origin grant.

---

## Authentication

**One door, and it takes an identifier plus a password.**
`POST /api/admin/login` accepts the email address or phone number on an
administrator profile, verifies its salted scrypt `password_hash`, and only
then creates an administrator-scoped session. A null hash is a locked account,
never a fallback to identifier-only access.

**One answer for every credential failure.** No such account, not an
administrator, no stored hash, and a wrong password all return the same 401
with the same sentence. An administrator does nothing differently among them,
so nothing is lost — and the distinction would be a move for somebody probing.

**Passwords are never inserted as plaintext.** Run
`npm --prefix backend run set-admin-password -- <email-or-phone>` from an
interactive terminal. The operator command verifies the row is already an
administrator, reads the password without echo, and writes only its salted
scrypt hash. It never changes a role.

**Nothing here can raise a role.** Changing somebody's role is a hand edit in
the Supabase table editor. There is no route, and there should not be one.

**The role is read from the database on every request**, not stamped into the
session at sign-in, so revoking an administrator takes effect on their next
click rather than when their cookie expires. Same for suspension.

---

## Conventions worth keeping

**`window.*` globals are the browser modules' public interface.** The shell
dispatches through `window['render' + Tab]()` and the markup carries inline
`onclick=` attributes, so ES modules would break both at once. Converting them
is a separate task with its own risk.

**Script load ORDER in `frontend/pages/index.html` is load-bearing.**
`scroll-lock-module.js` before `responsive-navigation-module.js`;
`admin-auth-module.js` before anything that fetches; `price-format-module.js`
and `custom-select-module.js` before the tab modules.

**Controllers were not thinned when they moved.** They parse, validate and
query in one function. Extracting services is a reasonable next pass; do it one
module at a time with the suite green after each, and not in the same commit as
a behaviour change.

**Route handlers keep the paths they had.** `/api/products`, not
`/api/admin/products`. Four thousand lines of browser module call them by name,
and renaming a route and its caller together is how a behaviour change gets
smuggled into a structural one.

---

## What is still open

1. **The service-role key is in two deployments.** A second Supabase role
   scoped to what this console actually touches would shrink the blast radius.
   Not done.
2. **`core/` and `shared/` are copies and will drift.** A bug fixed in one
   repository is worth grepping for in the other.
3. **The inline handlers.** Removing `'unsafe-inline'` from `script-src` means
   extracting every `onclick=` first.
4. **No network restriction is enforced by this application.** Password auth
   now protects the door, but a private deployment perimeter remains worthwhile
   defence in depth for a console with destructive routes.
