# SRK Team Star — administration console

The internal dashboard: orders, products, categories, customers, enquiries,
quotations and upcoming projects. One Node process serving one HTML document
and the API behind it.

It used to live inside the storefront repository, at `/admin-dashboard.html`,
sharing that process and that deployment. It does not any more. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) for what the split moved and what it left
behind, and [`AGENTS.md`](AGENTS.md) for how to work here.

---

## The one thing to understand first

**This application and the storefront share a database, and nothing else.**

A product added here appears on the store because both processes read and write
the same Supabase project — not because either calls the other. There is no
shared session, no shared cookie, no API call in either direction, and no
build-time dependency. The only HTTP link between them is `GET /storefront`,
which redirects a person who clicked the logo.

That has a consequence worth stating plainly: `backend/.env` here holds a
**second copy of the Supabase service-role key**. Two deployments now hold a
credential that bypasses every row-level security policy in the database.
Rotating it is a two-place job, and a leak from either is a leak of both.

---

## Running it

```bash
npm install                 # once, at the repo root
npm --prefix backend run dev
```

Then open <http://localhost:3100>. `backend/.env` must exist first — copy
[`backend/.env.example`](backend/.env.example) and fill it in. The process
refuses to start without `SESSION_SECRET`, and refuses to be useful without the
Supabase pair.

`npm run dev` is `node --watch`. Use it: **everything under `backend/src/` is
loaded once at boot**, so an edit there changes nothing until the process
restarts — with no error and no clue, which reads as "my change did not save".
The HTML, the CSS and the browser modules are read off disk per request and
need no restart.

### Signing in

There is no password or authenticator code. An administrator signs in with the
email address or phone number on their profile. The matching profile must have
the administrator role; changing that role remains a hand edit to
`user_profiles.role_id` in the Supabase table editor.

### Running both applications at once

They are two processes on two ports and they do not need each other to start.

```bash
# terminal 1 — the storefront
npm --prefix ../\#2/backend run dev          # :3000

# terminal 2 — this console
npm --prefix backend run dev                 # :3100
```

Set `STOREFRONT_URL=http://localhost:3000` in `backend/.env` and the logo will
take you across.

---

## Verifying it

```bash
npm run verify           # three structural checks, ~1s, no network, no database
npm test                 # 66 API assertions against the real server.js
npm --prefix backend run test:browser   # 4 Playwright checks on the one document
npm run test:all         # all of it
```

`npm run verify` is the one to run after moving or renaming **any** file:

- **verify-links** — every `href`/`src` in the dashboard and every browser
  module resolves through the same mount table the server uses.
- **verify-boundaries** — no module reaches past a sibling's `.public.js`,
  `shared/` imports nothing, `core/` imports no module, no barrel files.
- **verify-boot** — every file under `backend/src/` loads, and the assembled
  route table matches `tools/api-surface.json` **both ways**. A missing route
  fails; so does an unexpected one. That second direction is what keeps the
  storefront's routes out of this process.

---

## Styling

Tailwind is compiled, not loaded in the browser:

```bash
npm --prefix backend run build:css     # once, after adding a class
npm --prefix backend run watch:css     # or leave this running
```

The generated `frontend/assets/vendor/tailwind.build.css` is **committed**, so
a fresh checkout runs with no build. Only whoever changed a class needs to
rebuild. Tailwind matches literal text in `frontend/js/**/*.js` and
`frontend/pages/**/*.html`, so write whole class names — a name assembled from
pieces (`'bg-' + colour`) will not survive the build.

---

## Deploying

The console is meant to be deployed **separately from the storefront**, on its
own hostname. Nothing about it should be reachable from the public site.

- `server.js` at the repo root is the Vercel entry point; `backend/server.js`
  is the ordinary Node one.
- Every response carries `X-Robots-Tag: noindex, nofollow, noarchive`, and
  `robots.txt` disallows the whole origin. Neither is a security control —
  every route is enforced server-side — they simply keep an internal console
  out of somebody else's index.
- Put it behind a strong network restriction. Identifier-only login does not
  prove possession of an email account or phone, so the deployment perimeter
  is an essential part of the access boundary.
