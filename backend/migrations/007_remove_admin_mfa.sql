-- Remove the retired authenticator-code subsystem.
-- Run after 006_admin_mfa.sql on databases where that migration was applied.

drop function if exists public.claim_admin_mfa_step(bigint, bigint);

alter table public.user_profiles
    drop column if exists admin_mfa_secret,
    drop column if exists admin_mfa_last_step;
