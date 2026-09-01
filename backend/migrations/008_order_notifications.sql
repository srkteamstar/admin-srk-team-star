-- =============================================================================
-- 008_order_notifications.sql — the facts a customer notification needs, and
--                                the record of having sent one
-- =============================================================================
--
-- Three new facts on `orders`, each one an administrator decision that did not
-- previously leave a trace:
--
--   confirmed_at          set once, by PATCH /api/orders/:id/confirm. An order
--                          can sit in Processing for days without anyone having
--                          told the customer it was seen — the webhook that
--                          moves it there is silent by design. This is the
--                          admin's own "yes, we have this" moment, deliberately
--                          separate from the fulfilment status so re-reading a
--                          status back and forth (see order-status.js) can
--                          never re-fire it.
--
--   cancellation_reason   required, by the same PATCH /api/orders/:id/status
--                          that has always carried `status`, the moment status
--                          BECOMES 'Cancelled' (not on every PATCH that finds it
--                          already there — see admin-orders.controller.js). A
--                          cancellation with no reason on file is one nobody can
--                          explain to the customer, or to themselves, later.
--
--   refund_completed_at   set once, by PATCH /api/orders/:id/refund, and only
--                          on an order that is Cancelled AND has a Paid payment
--                          row. This dashboard still never MOVES money — that
--                          happens in Razorpay, by hand, exactly as the
--                          "Cancelled, but paid for" warning in orders.js says —
--                          this column is only the admin's record that they did
--                          it, which is what lets the customer be told.
--
-- `order_notifications` is the log of every attempt to tell a customer about
-- one of those three, plus a shipment. Not a queue and not retried — one row
-- per attempt, kept so a support conversation ("did they know?") has an answer
-- and so a failed send is visible without an admin having to trust that it
-- silently worked. See modules/orders/services/order-notifications.service.js
-- for what fills it.
-- =============================================================================

alter table public.orders
    add column if not exists confirmed_at timestamptz,
    add column if not exists cancellation_reason text,
    add column if not exists refund_completed_at timestamptz;

-- BACKFILL BEFORE THE CONSTRAINT BELOW, AND NOT OPTIONAL.
--
-- NOT VALID only skips the one-time bulk check this ALTER TABLE would
-- otherwise run — it does NOT exempt an existing row from the constraint on
-- its NEXT write. Every order cancelled before this migration has
-- cancellation_reason still null, and PATCH /api/orders/:id/refund updates
-- exactly that kind of row (Cancelled, by definition) without touching this
-- column at all. Without this backfill, the first refund ever recorded
-- against a pre-existing cancelled order would 500 on a check_violation that
-- has nothing to do with the write being made. Idempotent: once every
-- Cancelled row has a reason, this matches zero rows on a re-run.
update public.orders
   set cancellation_reason = 'Cancelled before this system began recording a reason.'
 where status = 'Cancelled'
   and cancellation_reason is null;

-- NOT VALID, same as migration 005's orders_tracking_length_ck: enforced for
-- every new or changed row from here on. The backfill above is what makes
-- that safe rather than a trap for the next unrelated update.
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'orders_cancellation_reason_ck') then
        alter table public.orders add constraint orders_cancellation_reason_ck check (
            status <> 'Cancelled'
            or char_length(btrim(coalesce(cancellation_reason, ''))) between 1 and 500
        ) not valid;
    end if;
end;
$$;

create table if not exists public.order_notifications (
    id bigint generated always as identity primary key,
    order_id bigint not null references public.orders(id) on delete cascade,
    -- 'shipped' rather than the status string 'Shipped': this log outlives any
    -- one fulfilment vocabulary and must not have to change if that one does.
    event text not null check (event in ('confirmed', 'shipped', 'cancelled', 'refunded')),
    channel text not null check (channel in ('whatsapp', 'email', 'none')),
    recipient text,
    status text not null check (status in ('sent', 'failed', 'skipped')),
    error text,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists order_notifications_order_id_idx
    on public.order_notifications (order_id);

alter table public.order_notifications enable row level security;

revoke all on table public.order_notifications from anon, authenticated;
grant select, insert on table public.order_notifications to service_role;

comment on table public.order_notifications is
    'One row per attempt to notify a customer about their order (confirmed/shipped/cancelled/refunded), WhatsApp-first with email fallback. Not a queue; nothing here is retried automatically.';

notify pgrst, 'reload schema';

-- VERIFY
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'orders'
--    and column_name in ('confirmed_at', 'cancellation_reason', 'refund_completed_at');
-- Expected: all three.
--
-- select table_name from information_schema.tables
--  where table_schema = 'public' and table_name = 'order_notifications';
-- Expected: one order_notifications row.
