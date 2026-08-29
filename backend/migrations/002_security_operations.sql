-- =============================================================================
-- Durable login throttling and append-only administrator audit events
-- =============================================================================

create table if not exists public.admin_rate_limits (
    rate_key text primary key,
    hit_count integer not null check (hit_count >= 0),
    window_started_at timestamptz not null,
    updated_at timestamptz not null default timezone('utc', now())
);

alter table public.admin_rate_limits enable row level security;
revoke all on table public.admin_rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.admin_rate_limits to service_role;

create or replace function public.consume_admin_rate_limit(
    p_key text,
    p_window_ms integer
)
returns table(total_hits integer, reset_time timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := timezone('utc', now());
begin
    if p_key is null or char_length(p_key) < 1 or char_length(p_key) > 300 then
        raise exception 'invalid rate-limit key';
    end if;
    if p_window_ms < 1000 or p_window_ms > 86400000 then
        raise exception 'invalid rate-limit window';
    end if;

    insert into public.admin_rate_limits(rate_key, hit_count, window_started_at, updated_at)
    values (p_key, 1, v_now, v_now)
    on conflict (rate_key) do update set
        hit_count = case
            when admin_rate_limits.window_started_at + (p_window_ms * interval '1 millisecond') <= v_now then 1
            else admin_rate_limits.hit_count + 1
        end,
        window_started_at = case
            when admin_rate_limits.window_started_at + (p_window_ms * interval '1 millisecond') <= v_now then v_now
            else admin_rate_limits.window_started_at
        end,
        updated_at = v_now;

    return query
    select hit_count,
           window_started_at + (p_window_ms * interval '1 millisecond')
      from public.admin_rate_limits
     where rate_key = p_key;
end;
$$;

revoke all on function public.consume_admin_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.consume_admin_rate_limit(text, integer) to service_role;

create table if not exists public.admin_audit_events (
    id bigint generated always as identity primary key,
    occurred_at timestamptz not null default timezone('utc', now()),
    actor_profile_id bigint null,
    event_type text not null check (char_length(event_type) between 1 and 120),
    target_type text null check (target_type is null or char_length(target_type) <= 120),
    target_id text null check (target_id is null or char_length(target_id) <= 200),
    outcome text not null check (outcome in ('success', 'refused', 'failure')),
    http_status integer not null check (http_status between 100 and 599),
    correlation_id uuid not null,
    ip_hash text null check (ip_hash is null or char_length(ip_hash) = 64),
    identifier_hash text null check (identifier_hash is null or char_length(identifier_hash) = 64),
    metadata jsonb not null default '{}'::jsonb
);

create index if not exists admin_audit_events_occurred_at_idx
    on public.admin_audit_events (occurred_at desc);
create index if not exists admin_audit_events_actor_idx
    on public.admin_audit_events (actor_profile_id, occurred_at desc);

alter table public.admin_audit_events enable row level security;
revoke all on table public.admin_audit_events from anon, authenticated;
-- Runtime is append-only. Audit review/retention should use an owner-operated
-- process rather than giving the web application mutation rights over history.
grant insert on table public.admin_audit_events to service_role;
grant usage, select on sequence public.admin_audit_events_id_seq to service_role;

comment on table public.admin_audit_events is
    'Append-only security and administrator action trail. Never stores passwords, cookies, or request bodies.';

notify pgrst, 'reload schema';
