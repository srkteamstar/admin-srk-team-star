# Production operations runbook

This console is a privileged internal origin. Code-level controls are tested
locally; the following steps must be completed against the named staging and
production projects by an operator with access to those systems.

## First deployment

1. Install from the lockfiles (`npm ci` at the root and `npm --prefix backend ci`).
2. Apply migrations `001_create_admin_sessions.sql` through
   `005_admin_data_constraints.sql` in order to the console's Supabase project.
   If the retired `006_admin_mfa.sql` was previously applied, run
   `007_remove_admin_mfa.sql` to remove its unused columns and function.
3. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`,
   `STOREFRONT_URL`, and `TRUST_PROXY=1` in the deployment secret manager.
4. Set each administrator's password with `set-admin-password`. Never pass
   secrets in shell history or commit `.env` files.
5. Put the hostname behind the approved identity-aware proxy/VPN. Permit only
   the operator group; do not expose the origin directly.

## Rotation and incidents

- Rotate the Supabase credential and `SESSION_SECRET` together with the
  storefront credential according to the incident plan. Changing
  `SESSION_SECRET` invalidates all browser sessions; changing a password also
  invalidates that administrator's sessions automatically.
- Review `admin_audit_events` for destructive actions and repeated login
  failures. The application stores hashes of IP/identifier values, never raw
  passwords, cookies, keys, or request bodies.
- On suspected compromise, disable the administrator role in Supabase, rotate
  secrets, revoke the proxy session, and preserve the audit table for review.

## Database and storage recovery

- Enable daily backups and point-in-time recovery in Supabase before launch.
- Perform a restore drill on a non-production project at least quarterly.
- Verify storage bucket policies: browser reads are limited to intended public
  image objects; writes and deletes require the server credential.
- Reconcile orphaned image objects against `products`, `categories`, and
  `upcoming_projects` after a failed deployment or restore.

## Release evidence

Attach the CI run, staging HTTPS/cookie/CSRF/rate-limit test, Supabase grant/RLS
review, backup-restore result, load test, and named security/operations
approvals to the exact release commit before production sign-off.
