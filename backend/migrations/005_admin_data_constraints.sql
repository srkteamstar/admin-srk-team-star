-- =============================================================================
-- Database backstops for administrator write validation
-- =============================================================================
-- NOT VALID avoids making deployment fail on historical rows, while PostgreSQL
-- still enforces each constraint for every new or changed row. Operations can
-- clean legacy exceptions and VALIDATE these constraints before sign-off.

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'categories_admin_text_ck') then
        alter table public.categories add constraint categories_admin_text_ck check (
            char_length(btrim(name)) between 1 and 160
            and char_length(url_slug) between 1 and 200
            and char_length(coalesce(description, '')) <= 5000
        ) not valid;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'products_admin_text_ck') then
        alter table public.products add constraint products_admin_text_ck check (
            char_length(btrim(name)) between 1 and 160
            and char_length(url_slug) between 1 and 200
            and char_length(coalesce(description, '')) <= 5000
            and char_length(coalesce(featured_description, '')) <= 300
            and char_length(coalesce(price::text, '')) <= 60
            and char_length(coalesce(asset_folder, '')) <= 200
        ) not valid;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'projects_admin_text_ck') then
        alter table public.upcoming_projects add constraint projects_admin_text_ck check (
            char_length(btrim(project_category_title)) between 1 and 160
            and char_length(btrim(project_name)) between 1 and 200
            and char_length(btrim(project_description)) between 1 and 5000
            and char_length(btrim(due_date::text)) between 1 and 80
        ) not valid;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'orders_tracking_length_ck') then
        alter table public.orders add constraint orders_tracking_length_ck check (
            char_length(coalesce(tracking, '')) <= 200
        ) not valid;
    end if;
end;
$$;

create or replace function public.reject_category_parent_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_cursor bigint := new.parent_id;
    v_seen bigint[] := array[]::bigint[];
begin
    if v_cursor is null then return new; end if;
    if new.id is not null and v_cursor = new.id then
        raise exception using errcode = '23514', message = 'category parent cycle';
    end if;

    while v_cursor is not null loop
        if new.id is not null and v_cursor = new.id then
            raise exception using errcode = '23514', message = 'category parent cycle';
        end if;
        if v_cursor = any(v_seen) then
            raise exception using errcode = '23514', message = 'existing category parent cycle';
        end if;
        v_seen := array_append(v_seen, v_cursor);
        select parent_id into v_cursor from public.categories where id = v_cursor for share;
        if not found then
            raise exception using errcode = '23503', message = 'parent category does not exist';
        end if;
    end loop;
    return new;
end;
$$;

drop trigger if exists categories_reject_parent_cycle on public.categories;
create trigger categories_reject_parent_cycle
before insert or update of parent_id on public.categories
for each row execute function public.reject_category_parent_cycle();

revoke all on function public.reject_category_parent_cycle() from public, anon, authenticated;

notify pgrst, 'reload schema';
