-- =============================================================================
-- Database transactions for administrator operations with multiple rows
-- =============================================================================

create or replace function public.delete_admin_customer(
    p_actor_id bigint,
    p_target_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text;
    v_order_count integer;
begin
    if p_actor_id = p_target_id then
        return jsonb_build_object('result', 'self');
    end if;

    select lower(r.role_name)
      into v_role
      from public.user_profiles p
      left join public.roles r on r.id = p.role_id
     where p.id = p_target_id
     for update of p;

    if not found then
        return jsonb_build_object('result', 'not_found');
    end if;
    if v_role = 'admin' then
        return jsonb_build_object('result', 'administrator');
    end if;

    select count(*)::integer
      into v_order_count
      from public.orders
     where user_id = p_target_id;

    if v_order_count > 0 then
        return jsonb_build_object('result', 'has_orders', 'order_count', v_order_count);
    end if;

    delete from public.shipping_addresses where user_id = p_target_id;
    delete from public.user_profiles where id = p_target_id;

    return jsonb_build_object('result', 'deleted', 'id', p_target_id);
end;
$$;

revoke all on function public.delete_admin_customer(bigint, bigint) from public, anon, authenticated;
grant execute on function public.delete_admin_customer(bigint, bigint) to service_role;

notify pgrst, 'reload schema';
