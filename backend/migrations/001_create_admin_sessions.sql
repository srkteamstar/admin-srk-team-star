-- =============================================================================
-- 001_create_admin_sessions.sql — durable sessions for the admin deployment
-- =============================================================================
--
-- Consecutive Vercel requests can execute in separate function instances, so
-- their session record cannot live in process memory. The browser's random
-- session id is SHA-256 hashed by the application before it becomes
-- session_key; session_data contains only the administrator profile id, the
-- admin scope and cookie expiry metadata.
-- =============================================================================

create table if not exists public.admin_sessions (
    session_key text primary key check (char_length(session_key) = 64),
    session_data jsonb not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_sessions_expires_at_idx
    on public.admin_sessions (expires_at);

alter table public.admin_sessions enable row level security;

revoke all on table public.admin_sessions from anon, authenticated;
grant select, insert, update, delete on table public.admin_sessions to service_role;

comment on table public.admin_sessions is
    'Server-only administrator sessions shared by the admin deployment instances.';

notify pgrst, 'reload schema';

-- VERIFY
-- select table_name
--   from information_schema.tables
--  where table_schema = 'public' and table_name = 'admin_sessions';
-- Expected: one admin_sessions row.
