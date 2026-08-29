-- =============================================================================
-- Time-based one-time-password MFA for administrator profiles
-- =============================================================================

alter table public.user_profiles
    add column if not exists admin_mfa_secret text,
    add column if not exists admin_mfa_last_step bigint;

create or replace function public.claim_admin_mfa_step(
    p_profile_id bigint,
    p_step bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_claimed boolean;
begin
    update public.user_profiles
       set admin_mfa_last_step = p_step,
           updated_at = timezone('utc', now())
     where id = p_profile_id
       and admin_mfa_secret is not null
       and (admin_mfa_last_step is null or admin_mfa_last_step < p_step)
    returning true into v_claimed;

    return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_admin_mfa_step(bigint, bigint) from public, anon, authenticated;
grant execute on function public.claim_admin_mfa_step(bigint, bigint) to service_role;

notify pgrst, 'reload schema';
