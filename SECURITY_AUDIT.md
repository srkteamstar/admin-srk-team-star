# Security audit — administration console

**Date:** 27 August 2026
**Scope:** `admin-dashboard-srk` application code, route table, authentication,
authorization, sessions, browser policy, uploads, stored-data rendering and
production dependencies.

## Outcome

The review found four actionable weaknesses. All four are remediated in this
working tree and covered by structural, API or browser verification. No known
critical or high-severity issue remains in the reviewed paths. This is a
point-in-time code audit, not a guarantee that future changes or deployment
configuration cannot introduce a vulnerability.

## Findings remediated

### 1. Cross-origin admin API grants — high

`STOREFRONT_URL` previously added the public storefront to both credentialed
CORS and `connect-src`, and CSRF accepted every CORS-allowed origin. The two
applications are intentionally separated and have no browser API relationship;
an XSS on the storefront should therefore never be able to make authenticated
admin requests.

**Fix:** the admin API now emits no cross-origin credential grant,
`connect-src` is same-origin, and state-changing requests reject `same-site` as
well as `cross-site` Fetch Metadata. `STOREFRONT_URL` remains navigation only.

### 2. Stored HTML injection in Upcoming Projects — high

Project category, name, description and due-date values were interpolated into
`innerHTML` without escaping. A malicious or malformed database row could run
script in an administrator's session.

**Fix:** every stored project value is HTML/attribute escaped before rendering.
A browser regression test injects tag and script payloads and proves they stay
text.

### 3. Upload validation trusted the declared MIME type — moderate

The upload filter accepted any bytes when the multipart part claimed
`image/webp` or `image/avif`.

**Fix:** the server now verifies WebP RIFF/WEBP and AVIF ISO-BMFF signatures
before any product, category or project write. A forged WebP upload is covered
by the API suite.

### 4. Privileged session lifetime was 30 days — moderate

A stolen admin cookie stayed useful much longer than an internal console needs.

**Fix:** administrator sessions now expire after eight hours of inactivity and
roll only while actively used. Cookies remain `httpOnly`, `SameSite=Lax`, and
secure automatically over TLS; role and suspension are re-read on each request.

## Controls verified

- Admin login requires identifier, a salted scrypt password hash and the admin
  role. Missing hashes and wrong passwords fail closed behind a rate limiter.
- Every privileged route uses `requireAdmin`; the route table contains no
  storefront or public catalogue API.
- No route can create or promote an administrator. Role changes remain an
  operator-only database action.
- Session identifiers regenerate on login and are destroyed on logout.
- Cross-origin state changes are rejected and foreign origins receive no CORS
  read grant.
- CSP denies external scripts, frames, objects, workers and browser capabilities;
  framing is denied independently with `X-Frame-Options`.
- The browser receives neither the Supabase key nor a Supabase client. Database
  access remains server-side through the service role.
- Status inputs use closed vocabularies; destructive customer actions refuse the
  current admin and every other admin.
- Production dependency audit: **0 known vulnerabilities** across 105 production
  dependencies (`npm audit --omit=dev`, 27 August 2026).

## Residual risks and deployment requirements

1. The CSP still needs `'unsafe-inline'` because the dashboard has inline event
   handlers and scripts. Removing those handlers is the prerequisite to a
   nonce-free strict CSP and should remain the next browser-security pass.
2. The Supabase service-role key exists in both storefront and admin deployments.
   Use separate least-privilege database credentials when the data model allows.
3. The application does not enforce a private network perimeter. Put the
   console behind deployment-level access control before production launch.
4. `TRUST_PROXY` must match the real controlled proxy hop count. A wrong value
   can undermine IP-based rate limiting.
5. The initial admin password was handed through the development task. Rotate it
   with `npm --prefix backend run set-admin-password -- <identifier>` before the
   final production handoff, and transmit it through a dedicated secret channel.

The former MemoryStore deployment risk has been resolved: administrator session
records now live in a server-only Supabase table and are keyed by a SHA-256 hash
of the browser's session identifier. Separate Vercel instances therefore share
the login without storing a replayable cookie value in the database.

## Verification record

- `npm run verify`
- `npm test`
- `npm --prefix backend run test:browser`
- `npm audit --omit=dev`
- Tailwind CSS rebuilt after dashboard class additions
