-- =============================================================================
-- Bounded read model for the administration dashboard
-- =============================================================================
--
-- The dashboard previously downloaded every order, product, customer, enquiry,
-- quote and category merely to render seven counts and five recent orders.
-- Keep that aggregation beside the data, return a fixed-size document, and
-- leave the full records to their owning tabs.

create or replace function public.admin_dashboard_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with order_totals as (
        select
            count(*)::integer as total,
            count(*) filter (where status = 'Pending Payment')::integer as pending_payment,
            count(*) filter (where status = 'Processing')::integer as processing,
            count(*) filter (where status = 'Shipped')::integer as shipped,
            count(*) filter (where status = 'Delivered')::integer as delivered,
            coalesce(sum(net_amount) filter (where status = 'Shipped'), 0) as shipped_revenue
        from public.orders
    ), recent as (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', item.id,
            'order_number', item.order_number,
            'status', item.status,
            'net_amount', item.net_amount,
            'created_at', item.created_at,
            'customer', case when item.customer_id is null then null else jsonb_build_object(
                'id', item.customer_id,
                'full_name', item.customer_name,
                'email', item.customer_email
            ) end
        ) order by item.created_at desc), '[]'::jsonb) as rows
        from (
            select o.id, o.order_number, coalesce(o.status, 'Processing') as status,
                   o.net_amount, o.created_at, p.id as customer_id,
                   p.full_name as customer_name, p.email as customer_email
              from public.orders o
              left join public.user_profiles p on p.id = o.user_id
             order by o.created_at desc
             limit 5
        ) item
    )
    select jsonb_build_object(
        'orders', jsonb_build_object(
            'total', ot.total,
            'pending_payment', ot.pending_payment,
            'processing', ot.processing,
            'shipped', ot.shipped,
            'delivered', ot.delivered,
            'shipped_revenue', ot.shipped_revenue,
            'recent', r.rows
        ),
        'active_products', (select count(*)::integer from public.products where is_active is distinct from false),
        'categories', (select count(*)::integer from public.categories),
        'customers', (select count(*)::integer from public.user_profiles),
        'open_enquiries', (select count(*)::integer from public.enquiries where status is distinct from 'Resolved'),
        'open_quotes', (select count(*)::integer from public.quote_requests where status is distinct from 'Resolved')
    )
    from order_totals ot cross join recent r;
$$;

revoke all on function public.admin_dashboard_summary() from public, anon, authenticated;
grant execute on function public.admin_dashboard_summary() to service_role;

create or replace function public.admin_category_product_counts()
returns table(category_id bigint, product_count bigint)
language sql
stable
security definer
set search_path = public
as $$
    select p.category_id::bigint, count(*)::bigint
      from public.products p
     where p.category_id is not null
     group by p.category_id;
$$;

revoke all on function public.admin_category_product_counts() from public, anon, authenticated;
grant execute on function public.admin_category_product_counts() to service_role;

notify pgrst, 'reload schema';
