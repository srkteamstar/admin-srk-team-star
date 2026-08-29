# Production sign-off checklist — SRK Team Star administration console

**Prepared:** 29 August 2026
**Source audit:** `SECURITY_AND_FUNCTIONALITY_AUDIT_2026-08-29.md`

Production sign-off should remain **blocked** until every P0 item is complete.
Every P1 item must either be complete or have written acceptance by the person
responsible for production security and operations. P2 items may be scheduled
after launch only when the associated risk is recorded.

## P0 — release blockers

### 1. Make a fresh checkout complete and runnable

- [ ] Add `backend/scripts/set-admin-password.js` to Git. It exists locally but
      is currently untracked, while `backend/package.json` depends on it.
- [x] Add a secret-free `backend/.env.example` containing at least
      `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`,
      `STOREFRONT_URL`, and documented `TRUST_PROXY` guidance.
- [x] Ensure both audit documents and any intended migrations are tracked.
- [x] Run installation, configuration, password setup, build, and tests from a
      clean clone rather than the current working directory.

**Sign-off evidence:** a clean-clone CI job completes setup, `npm run verify`,
`npm test`, the browser suite, and the deployment build without relying on
untracked files.

### 2. Verify HTTPS and trusted-proxy behavior in the real deployment

- [ ] Determine the exact trusted proxy topology for Vercel/production.
- [x] Configure `TRUST_PROXY` narrowly enough that client-supplied forwarded
      headers cannot be trusted on any direct-access path.
- [ ] Verify an HTTPS login succeeds through the production proxy.
- [ ] Verify `srk_admin_sid` contains `Secure`, `HttpOnly`, and `SameSite=Lax`.
- [ ] Verify same-origin POST/PATCH/DELETE requests work while foreign-origin
      and same-site cross-origin requests receive 403.
- [ ] Redirect or reject all plain HTTP traffic and confirm HSTS is present.

**Sign-off evidence:** captured production-like integration-test results for
login, cookie attributes, CSRF rejection, HTTP redirect, and security headers.

### 3. Replace process-local login throttling

- [x] Replace the default in-memory `express-rate-limit` store with a shared,
      durable Supabase or Redis-backed store.
- [x] Apply limits by both client IP and normalized administrator identifier.
- [x] Confirm limits remain effective across cold starts and concurrent
      serverless instances.
- [ ] Add monitoring/alerts for repeated failures and limiter-store failures.
- [x] Keep credential-failure responses identical to prevent enumeration.

**Sign-off evidence:** an integration test distributes attempts across multiple
instances and proves the configured global limit is still enforced.

### 4. Prevent partially completed writes

- [x] Make customer address/profile deletion one database transaction.
- [x] Make product image-row and main-image changes compensating and restore
      the prior database/storage state when any step fails.
- [x] Add staging, idempotency, and compensating cleanup to product, category,
      and project database-plus-storage workflows.
- [x] Treat storage list/upload/remove errors as real failures; do not silently
      report success while objects are orphaned.
- [x] Return 404 when update/delete targets do not exist.
- [ ] Add retry tests proving the same request cannot create duplicate rows or
      corrupt image state.

**Sign-off evidence:** fault-injection tests fail each database/storage step in
turn and leave data in the documented pre-operation or completed state—never a
half-saved state.

### 5. Protect the administration origin and database blast radius

- [ ] Put the console behind an approved private-access layer such as identity-
      aware access, VPN, or a tightly controlled network perimeter.
- [ ] Replace the shared Supabase service-role credential with a separate,
      least-privilege console credential wherever the current schema permits.
- [x] Confirm the browser bundle and responses never expose database secrets.
- [x] Document coordinated secret rotation for the admin and storefront
      deployments, and rotate any bootstrap credentials before launch.
- [ ] Restrict production access to the minimum named operators.

**Sign-off evidence:** access-control test, database
grant review, secret scan, and a tested credential-rotation runbook.

## P1 — required before general production use

### 6. Complete server-side validation for every write

- [x] Validate IDs, required fields, string lengths, booleans, dates, prices,
      tracking values, slugs, parent relationships, and image metadata.
- [x] Reject category parent cycles, not only direct self-parenting.
- [x] Add explicit project name/description/date constraints.
- [x] Bound category descriptions, product descriptions, and order tracking.
- [x] Return field-specific 400/409/404 responses rather than generic 500s.
- [ ] Mirror important application validation with database constraints.

**Sign-off evidence:** negative API tests cover missing, malformed, oversized,
cyclic, nonexistent, duplicate, and boundary-value inputs for every write route.

### 7. Strengthen administrator passwords and sessions

- [x] Introduce a versioned password-hash format that records algorithm and
      work-factor parameters.
- [x] Benchmark and adopt an OWASP-listed scrypt configuration.
- [x] Rehash existing passwords at reset or after successful authentication.
- [x] Add a server-enforced absolute session lifetime in addition to idle expiry.
- [x] Shorten the idle period to the approved admin-console value.
- [x] Rotate session IDs periodically and invalidate sessions after password
      changes, role revocation, suspension, and security incidents.
- [ ] Test expiry and revocation across multiple server instances.

**Sign-off evidence:** password-format migration tests and session tests for
idle timeout, absolute timeout, renewal, logout, demotion, suspension, and reset.

### 8. Add durable administrator audit logging

- [x] Record successful and failed login events.
- [x] Record product/category/project saves, deletes, visibility changes,
      customer blocks/deletes, order status changes, and enquiry/quote changes.
- [x] Include actor ID, action, target, result, timestamp, correlation ID, and a
      safe summary of changed fields.
- [x] Never record passwords, session IDs, service keys, or full sensitive
      request bodies.
- [ ] Protect logs from alteration and define retention, access, and review.
- [ ] Alert on unusual destructive activity and repeated authentication failure.

**Sign-off evidence:** operations can trace a test change from request through
audit event, identify the actor, and demonstrate access/retention controls.

### 9. Make data retrieval safe at production volume

- [x] Add bounded pagination to customers, orders, enquiries, quotes, products,
      categories, and projects; server-side search/filter parameters remain a
      follow-up for larger catalogues.
- [ ] Stop loading every customer's full order/address/item history in the list
      response; fetch drawer details on demand.
- [x] Add summary/count endpoints for the dashboard instead of six full-list
      downloads.
- [ ] Confirm indexes support production filters and sort orders.
- [ ] Define expected data volume and test at or above that level.

**Sign-off evidence:** load-test results meet agreed latency, memory, function
duration, database-query, and response-size budgets at peak expected volume.

### 10. Standardize error handling and operational health

- [x] Put the final JSON error handler in the shared Express composition root so
      local Node and Vercel behave identically.
- [x] Ensure malformed JSON/multipart bodies return safe JSON without stack or
      filesystem-path disclosure.
- [x] Make readiness return a generic public failure while detailed dependency
      errors go only to protected logs.
- [x] Make the upcoming-project visibility read throw on database failure rather
      than silently reporting the section as visible.
- [x] Add correlation IDs to errors and logs.
- [ ] Configure external liveness/readiness monitoring and alerting.

**Sign-off evidence:** malformed-request and dependency-failure tests return the
documented status/JSON shape in local and deployed environments; monitoring
detects a controlled readiness failure.

### 11. Validate the real Supabase security and recovery configuration

- [ ] Review grants, RLS, constraints, functions, and storage policies in the
      production project—not only the stubbed test harness.
- [ ] Confirm `admin_sessions` is inaccessible to anonymous/authenticated roles.
- [ ] Confirm image buckets permit only intended server writes and safe public
      reads.
- [ ] Enable and test database backups and point-in-time recovery where available.
- [ ] Define retention/cleanup for expired sessions and orphaned storage objects.
- [ ] Test recovery of an accidentally deleted product/category/project and its
      images.

**Sign-off evidence:** dated database/security review, restore drill result, and
automated policy tests using anon, authenticated, and console credentials.

## P2 — hardening; fix or formally accept before sign-off

### 12. Remove inline-script dependence

- [ ] Replace inline `onclick`, `onchange`, `onerror`, and inline application
      script with event listeners and same-origin files.
- [ ] Remove `'unsafe-inline'` from `script-src`; use external styles or a nonce
      strategy for unavoidable inline style.
- [ ] Add stored-XSS regression tests for every tab and every HTML, attribute,
      URL, and JavaScript-string context.

### 13. Re-encode uploaded images

- [x] Decode and re-encode AVIF/WebP uploads rather than accepting files based
      only on their initial signature.
- [x] Enforce pixel/dimension limits as well as byte-size limits.
- [ ] Verify bucket responses use the intended content type and `nosniff`.
- [ ] Add malformed, polyglot, decompression-bomb, oversized, and multi-file
      upload tests.

### 14. Complete usability and recovery testing

- [ ] Test every create/edit/delete/toggle/status workflow against a real staging
      database and storage project.
- [ ] Test expired sessions during unsaved edits and provide a clear recovery
      experience.
- [ ] Test keyboard navigation, focus management, screen-reader names, contrast,
      responsive tables/drawers, and destructive confirmations.
- [ ] Test slow network, offline/retry, API 401/403/404/409/429/500, and storage
      failure states.
- [ ] Verify the storefront reflects admin changes through the shared database
      without exposing admin APIs or sharing sessions.

## Final release gates

Production sign-off requires all of the following:

- [ ] Every P0 item is complete.
- [ ] Every P1 item is complete or has named, written risk acceptance with an
      owner and deadline.
- [ ] `npm run verify` passes.
- [ ] `npm test` passes.
- [ ] `npm --prefix backend run test:browser` passes.
- [ ] Production and development dependency audits show no unaccepted known
      vulnerabilities.
- [ ] Clean-clone build and staging deployment pass.
- [ ] Production-like HTTPS/proxy, cookie, CSRF, and rate-limit tests pass.
- [ ] Real Supabase authorization/storage policy tests pass.
- [ ] Load, failure-injection, backup, and restore tests pass.
- [ ] Monitoring, alerting, audit logging, incident response, rollback, and secret
      rotation are documented and exercised.
- [ ] Security, engineering, operations, and business owners record approval of
      the exact release revision.

## Current baseline

At the time this checklist was prepared:

- Structural verification passed with 33 declared routes matching 33 routes in
  the API contract.
- 86 API/session assertions passed.
- 7 browser tests passed.
- Root and backend npm audits reported zero known vulnerabilities.
- Those tests use a stubbed/local environment and do not satisfy the deployment,
  real-database, multi-instance, load, or recovery gates above.
