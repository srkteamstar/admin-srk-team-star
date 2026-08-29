# Security and functionality audit — SRK Team Star administration console

**Audit date:** 29 August 2026
**Scope:** `admin-dashboard-srk` source, API surface, browser application,
authentication/authorization, sessions, uploads, data-changing workflows,
deployment configuration, automated tests, and current npm dependency
advisories.

## Executive assessment

The console has a good security baseline: privileged routes consistently use
`requireAdmin`, administrator identity is verified from the database on each
request, sessions are server-side and regenerated at login, state-changing
cross-origin requests are refused, uploaded files have size/type/signature
checks, stored text is escaped in the reviewed dashboard tabs, and the process
does not expose storefront APIs.

No direct critical vulnerability or authorization bypass was found. The
application should nevertheless **not be treated as production-ready until the
first four priority items below are resolved or explicitly verified**. The
most important production risks are a process-local login limiter in a
serverless deployment, proxy-dependent HTTPS behavior that is neither
documented nor covered by a deployment test, non-atomic database/storage
changes, and required setup files that are absent from Git.

This is a source-code and local behavior review, not a penetration test of a
deployed hostname. It did not validate Vercel environment values, Supabase
policies/bucket settings, the storefront's corresponding behavior, or the
complete production database schema.

## Remediation status after implementation pass

The code changes in this workspace resolve SEC-01 through SEC-05, FUN-01
through FUN-05, and SEC-07: login throttling is durable and keyed by IP plus
identifier; proxy behavior is explicit; customer deletion is transactional;
catalogue/storage writes compensate on failure; inputs and database
constraints are bounded; password/session controls are versioned, expiring,
rotating and revocable; audit events are append-only with correlation IDs; list
reads are paginated; the dashboard uses a bounded summary RPC; and uploads are
decoded and re-encoded with pixel limits using the patched Sharp release.
SEC-06 (inline handlers/CSP) and the
deployment-only controls—private perimeter, least-privilege Supabase role,
real-project policy review, load/restore drills, monitoring and production
HTTPS verification—remain release gates.

## Priority findings

| ID | Severity | Area | Finding | Recommended action |
|---|---|---|---|---|
| SEC-01 | Medium | Authentication | The 20-attempt login limit uses `express-rate-limit`'s default in-memory store. Vercel can run more than one function instance and reset instances, so counters are not shared or durable. Credential stuffing can exceed the stated limit. | Use a shared Supabase/Redis rate-limit store. Apply both IP and normalized-identifier budgets, and alert on repeated failures. |
| SEC-02 | Medium, production-conditional | Proxy/TLS | `TRUST_PROXY` defaults off. Both same-origin CSRF comparison and `secure: 'auto'` depend on Express recognizing the original HTTPS protocol. Vercel supplies it in `X-Forwarded-Proto`; without a correct trust setting, login/writes can be rejected as cross-origin and the cookie may lack `Secure`. | Define and document the exact trusted proxy configuration for each deployment; add a production-like forwarded-HTTPS integration test that asserts login succeeds and `Set-Cookie` contains `Secure`. Do not blindly trust arbitrary forwarded headers on a directly exposed Node server. |
| FUN-01 | High integrity risk | Writes/uploads | Product, category, and project saves update/insert the database before completing storage and image-row changes. A later failure returns an error after part of the change is already live. Customer deletion likewise removes addresses before deleting the profile. | Make database-only sequences transactional through a database function. For storage workflows, stage uploads, use idempotency, and add explicit compensation/cleanup so an error cannot leave half-saved rows or orphaned objects. |
| REL-01 | High release risk | Repository | `backend/package.json` publishes `set-admin-password`, but `backend/scripts/` is untracked. `README.md` and runtime errors refer to `backend/.env.example`, which does not exist. A fresh clone cannot follow the documented setup or run the credential command. | Add the credential script and a secret-free `.env.example` to Git, verify from a clean clone, and keep real `.env` files ignored. |
| SEC-03 | Medium | Password storage | Password hashing calls Node `scrypt` without explicit cost parameters and stores only `scrypt$salt$hash`. Node's default cost is `N=2^14, r=8, p=1`; current OWASP guidance recommends a stronger scrypt configuration, and the stored format cannot record per-hash upgrades. | Introduce a versioned format that records algorithm and parameters. Benchmark and migrate to Argon2id or an OWASP-listed scrypt configuration, rehashing at the next successful login or password reset. |
| SEC-04 | Medium | Sessions | The rolling eight-hour cookie is an idle timeout only. An active or hijacked session can be renewed indefinitely; no absolute or renewal timeout is enforced. | Add a server-enforced absolute lifetime (for example one work shift), consider a shorter idle timeout, and rotate the session identifier periodically. |
| SEC-05 | Medium | Accountability | Successful logins, failed logins, status changes, deletes, visibility changes, and catalogue edits have no durable audit trail. Console error logs cover failures only. | Record structured security/admin events with actor ID, action, target, outcome, timestamp, and request correlation ID. Never log passwords, cookie values, or full sensitive payloads. |
| FUN-02 | Medium | Validation | The project save endpoint accepts missing and unbounded project fields and arbitrary due-date text. Categories have no server-side length ceilings for name/description; product description and order tracking are also unbounded apart from request-size/database limits. | Add a shared server-side schema for every write: required fields, trimmed strings, length ceilings, ID formats, and date semantics. Return field-specific 400 responses. |
| FUN-03 | Medium | Scalability | Orders and customers are full-table reads. The customer route loads every profile, order, address, and order item; the dashboard also starts six list requests together. Response size and query cost grow without bound. | Add server-side pagination, search/filter parameters, summary endpoints for dashboard counts, and measured indexes. Return details only when a drawer is opened. |
| FUN-04 | Low/Medium | Settings reliability | `isSectionVisible()` ignores the Supabase error and returns `true` whenever no data is present. A database failure can therefore be displayed as “visible,” masking an operational problem. | Distinguish “missing setting, use default” from “query failed”; throw on errors and let the UI display an unavailable state. |
| SEC-06 | Low/Medium | Browser security | CSP still permits `'unsafe-inline'` for scripts because the document and generated tab markup use inline handlers. The reviewed stored fields are escaped, but any future missed HTML/attribute boundary would have a direct script-execution path. | Replace inline handlers with delegated `addEventListener` wiring, move inline script/style into files or nonce them, then remove `'unsafe-inline'` from `script-src`. Add XSS regression cases for every tab, not only Upcoming Projects. |
| SEC-07 | Low | Upload hardening | Image checks verify declared MIME type and a short WebP/AVIF signature, but do not prove the complete file decodes safely. Public objects are stored as supplied. | Decode and re-encode images with a maintained library, impose dimension/pixel limits, and keep bucket responses locked to correct image content types with `nosniff`. |
| FUN-05 | Low | API semantics | Several delete operations do not select/count the deleted row and ignore storage removal errors, so deleting a nonexistent record or failing to clean an object can still return success. Local Node also lacks the JSON error handler that the Vercel adapter adds. | Return 404 when no row changed, surface/queue storage cleanup failures, and place one final JSON error handler in the shared application composition root. |

## Evidence for the main findings

### SEC-01 — rate limiting is not shared

- `backend/src/modules/auth/infrastructure/auth-rate-limit.js:13` constructs the
  limiter without a `store`, selecting the default memory store.
- `backend/src/modules/auth/infrastructure/auth-rate-limit.js:14-16` is the only
  login budget: 20 attempts per 15 minutes.
- `vercel.json` and root `server.js` show that this application targets Vercel.
- The official express-rate-limit documentation states that its default memory
  store is not synchronized across processes or servers:
  <https://express-rate-limit.mintlify.app/reference/stores>.
- Vercel documents that Express becomes a scaling Function and instances may be
  created, reused, and scaled down:
  <https://vercel.com/docs/functions>.

### SEC-02 — proxy configuration controls security behavior

- `backend/src/core/config/app-settings.js:30-35` disables proxy trust unless
  `TRUST_PROXY` is set.
- `backend/src/core/http/csrf.js:39-41` builds the allowed origin from
  `req.protocol` and `Host`.
- `backend/src/core/http/session.js:54-67` uses rolling sessions and
  `secure: 'auto'`.
- The local `.env` contains no `TRUST_PROXY` key. Production environment values
  were not available to this audit.
- Vercel documents that production protocol arrives in `X-Forwarded-Proto`:
  <https://vercel.com/docs/headers/request-headers>.
- Express documents that proxy trust controls forwarded protocol recognition
  and secure-cookie auto detection:
  <https://expressjs.com/en/resources/middleware/session/>.

### FUN-01 — multi-resource writes can partially commit

- Product database write: `backend/src/modules/products/controllers/admin-products.controller.js:168-182`.
- Product storage/image-row/main-image steps:
  `backend/src/modules/products/controllers/admin-products.controller.js:184-254`.
- Category row then object:
  `backend/src/modules/categories/controllers/admin-categories.controller.js:112-151`.
- Project row then object:
  `backend/src/modules/projects/controllers/admin-projects.controller.js:113-160`.
- Customer address deletion precedes profile deletion:
  `backend/src/modules/customers/controllers/admin-customers.controller.js:240-257`.

### REL-01 — clean-clone setup is incomplete

- `backend/package.json:12` points to `scripts/set-admin-password.js`.
- `git ls-files backend/scripts` returns no tracked file even though the script
  is present in the working tree.
- `README.md:39` and
  `backend/src/core/http/storefront-link.js:61` name
  `backend/.env.example`, but that file is absent.

### SEC-03 and SEC-04 — password/session hardening

- `backend/src/modules/auth/services/admin-password.service.js:31-33` and
  `:60-61` use scrypt without explicit parameters.
- Node documents the default cost as `N=16384`:
  <https://nodejs.org/api/crypto.html>.
- OWASP's current password storage recommendations:
  <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>.
- `backend/src/core/http/session.js:52-67` rolls the same eight-hour expiry with
  activity and stores no absolute creation deadline.
- OWASP recommends both idle and absolute session timeouts:
  <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>.

## Controls verified

The remediation pass completed the code-level fixes identified above. The
current implementation has these controls:

- All 33 declared API routes match `tools/api-surface.json`; unexpected
  storefront routes are absent.
- Every tested privileged route rejects signed-out callers.
- Admin login requires identifier, password hash, admin role, and non-blocked
  profile. Generic credential failure messages and a refusal hash reduce
  enumeration/timing differences.
- The session identifier regenerates at login, the browser cookie is
  `httpOnly` and `SameSite=Lax`, and only a SHA-256 digest of the session ID is
  stored in Supabase.
- Role assignment and suspension are re-read from the database on privileged
  requests. Admin accounts cannot be blocked or deleted through customer
  routes.
- CORS grants no foreign origin, Fetch Metadata/origin checks protect writes,
  and unknown API routes receive a fixed JSON 404.
- Security headers deny framing, external connections, objects, workers, and
  browser capabilities; all responses are marked `noindex`.
- The browser does not receive the Supabase service-role key.
- Status writes use closed vocabularies.
- WebP/AVIF uploads have per-file 10 MB limits, safe decode/re-encode, pixel and
  dimension limits, and signature checks.
- Login throttling is durable in Supabase and keyed by both client address and
  a keyed identifier digest; append-only audit events capture mutating API
  requests without storing credentials or request bodies.
- Password hashes use a versioned explicit scrypt configuration, sessions have
  idle and absolute limits plus periodic identifier rotation, and password
  changes invalidate earlier sessions.
- Customer deletion and other multi-step storage writes use database RPCs or
  compensating rollback snapshots to avoid orphaned records and objects.
- Dashboard and list endpoints use bounded pagination; the dashboard summary
  endpoint avoids unbounded parallel downloads.
- Reviewed customer, enquiry, quote, order, category, project, and dashboard
  stored text is escaped before `innerHTML` insertion.

## Residual architectural/deployment risk

The application uses a Supabase service-role key, which bypasses row-level
security, and the same project is also used by the storefront. A server-side
credential leak or code-execution flaw therefore has a very large blast
radius. This is not a confirmed leak in the reviewed code, but it is the
highest-impact residual risk. Use a separate least-privilege database role for
the console where feasible, rotate credentials as one coordinated operation,
and keep the console behind a private access layer.

## Verification record

All checks below passed on 29 August 2026:

- `npm run verify` — link resolution, module boundaries, secret scan, and 33/33
  API surface.
- `npm test` — 86 API/session assertions passed.
- `npm --prefix backend run test:browser` — 7 Playwright tests passed.
- `npm run build` — production frontend build completed successfully.
- `npm audit --omit=dev` — 0 known vulnerabilities in the root production lockfile.
- `npm --prefix backend audit --omit=dev` — 0 known backend production vulnerabilities.
- `npm --prefix backend audit` — 0 known backend production or development vulnerabilities.

The automated API suite uses a stubbed Supabase harness. It verifies application
logic but not real RLS, constraints, database functions, storage policies,
latency, or production credentials. Browser tests run against that same local
harness and do not simulate Vercel's forwarded HTTPS headers.

## Remaining release gates

1. Commit the new scripts, migrations, CI workflow, reports, and environment
   template; verify setup from a clean clone.
2. Apply and validate migrations 001–005 against the production Supabase
   project, including RLS, RPCs, storage policies, and backups.
3. Configure a least-privilege database credential, rotate exposed credentials
   if applicable, and place the console behind the approved private perimeter.
4. Replace inline handlers and inline scripts so `script-src` can remove
   `'unsafe-inline'`.
5. Complete production HTTPS/forwarded-header, load, recovery, monitoring, and
   real-credential smoke tests. Add server-side search/filtering before the
   catalog grows beyond the bounded page size.
