/*
 * modules/orders/controllers/admin-orders.controller.js
 * ============================================================================
 *
 *   GET   /api/orders              admin
 *   PATCH /api/orders/:id/status   admin - status, tracking and cancellation reason
 *   PATCH /api/orders/:id/confirm  admin - the one-time "we have this order" notice
 *   PATCH /api/orders/:id/refund   admin - records a refund done by hand in Razorpay
 *
 * FINANCIAL RECORDS, NOT A CATALOGUE. There is still no POST and no DELETE
 * here. Every write below moves or annotates where an order already is; none
 * of them creates or removes one. Fulfilment status stays deliberately
 * separate from payments.status: an order can be Paid and still sit in
 * Processing for days.
 *
 * tracking is written only when the key is present at all, so a status-only
 * update (the common case, marking Delivered) never clobbers a tracking number
 * entered on an earlier Shipped update. A tracking value that actually CHANGES
 * is what fires the shipping notification — see order-notifications.service.js
 * — independent of whatever status happens to be in the same request.
 *
 * EVERY NOTIFICATION SEND BELOW IS AWAITED, NEVER FIRED-AND-FORGOTTEN, and
 * every one is wrapped so its failure cannot fail the write that triggered
 * it — an admin who marked an order Shipped must see that succeed even on
 * the day WhatsApp and email are both down. See order-notifications.service.js
 * for why "awaited" is load-bearing on this deployment target.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireAdmin } = require('../../../core/security/guards');
const { trimmed, isPositiveId, boundedText } = require('../../../shared/validation');
const { ORDER_STATUSES } = require('../../../shared/contracts/order-status');
const { fetchOrderRows } = require('../infrastructure/order.repository');
const { paginationFor, setPaginationHeaders } = require('../../../core/http/pagination');
const {
    notifyOrderConfirmed, notifyOrderShipped, notifyOrderCancelled, notifyRefundCompleted
} = require('../services/order-notifications.service');

/** @returns {import('express').Router} */
function adminOrdersController() {
    const router = express.Router();

    router.get('/api/orders', requireAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        try {
            const pagination = paginationFor(req, res);
            if (!pagination) return;
            const { rows, total } = await fetchOrderRows(pagination);
            setPaginationHeaders(res, pagination, total);
            res.status(200).json(rows);
        } catch (error) {
            console.error("Fetch Orders Error:", error);
            res.status(500).json({ error: "Failed to fetch orders." });
        }
    });

    router.patch('/api/orders/:id/status', requireAdmin, async (req, res) => {
        if (!isPositiveId(req.params.id)) {
            return res.status(400).json({ error: "Invalid order id." });
        }
        const status = trimmed(req.body.status);

        if (!ORDER_STATUSES.includes(status)) {
            return res.status(400).json({ error: `Status must be one of: ${ORDER_STATUSES.join(', ')}.` });
        }

        // tracking is only written when the key is present at all, so a status-only
        // update (the common case — marking Delivered) never clobbers a tracking
        // number entered on an earlier Shipped update.
        const updateData = { status };
        if (Object.prototype.hasOwnProperty.call(req.body, 'tracking')) {
            const tracking = boundedText('Tracking reference', req.body.tracking, 200);
            if (tracking.error) return res.status(400).json({ error: tracking.error });
            updateData.tracking = tracking.value;
        }

        try {
            // Read before writing, deliberately: the notifications below need to
            // know what changed, not just what an order looks like now, and a
            // cancellation reason must be demanded only the moment status BECOMES
            // 'Cancelled' — an order already sitting there (a tracking-only save
            // while it stays Cancelled) must not be re-blocked for one.
            const { data: before, error: beforeError } = await supabase
                .from('orders').select('*').eq('id', req.params.id).maybeSingle();
            if (beforeError) throw beforeError;
            if (!before) return res.status(404).json({ error: "That order no longer exists." });

            const enteringCancelled = status === 'Cancelled' && before.status !== 'Cancelled';
            if (enteringCancelled) {
                const reason = boundedText('Cancellation reason', req.body.cancellationReason, 500, { required: true });
                if (reason.error) return res.status(400).json({ error: reason.error });
                updateData.cancellation_reason = reason.value;
            }

            const { data, error } = await supabase
                .from('orders')
                .update(updateData)
                .eq('id', req.params.id)
                .select()
                .maybeSingle();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: "That order no longer exists." });

            try {
                const trackingChanged = Object.prototype.hasOwnProperty.call(updateData, 'tracking')
                    && updateData.tracking && updateData.tracking !== before.tracking;
                if (trackingChanged) await notifyOrderShipped(data);
                if (enteringCancelled) await notifyOrderCancelled(data, updateData.cancellation_reason);
            } catch (notifyError) {
                console.error("Order notification failed:", notifyError);
            }

            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error("Update Order Error:", error);
            res.status(500).json({ error: "Failed to update order." });
        }
    });

    // The admin's own "we have this order" moment — deliberately a separate,
    // explicit action rather than tied to a fulfilment status. Most orders are
    // already sitting in Processing (the storefront's payment webhook puts them
    // there) by the time an admin opens the drawer, so hanging this off a status
    // transition would mean it almost never fires. confirmed_at guards it to
    // exactly once regardless of how many times an order round-trips through
    // statuses afterward.
    router.patch('/api/orders/:id/confirm', requireAdmin, async (req, res) => {
        if (!isPositiveId(req.params.id)) {
            return res.status(400).json({ error: "Invalid order id." });
        }

        try {
            const { data: order, error: orderError } = await supabase
                .from('orders').select('*').eq('id', req.params.id).maybeSingle();
            if (orderError) throw orderError;
            if (!order) return res.status(404).json({ error: "That order no longer exists." });

            if (order.confirmed_at) {
                return res.status(200).json({ success: true, data: order, alreadyConfirmed: true });
            }

            const { data, error } = await supabase
                .from('orders')
                .update({ confirmed_at: new Date().toISOString() })
                .eq('id', req.params.id)
                .select()
                .maybeSingle();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: "That order no longer exists." });

            try {
                await notifyOrderConfirmed(data);
            } catch (notifyError) {
                console.error("Order confirmation notification failed:", notifyError);
            }

            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error("Confirm Order Error:", error);
            res.status(500).json({ error: "Failed to confirm order." });
        }
    });

    // Records a refund an admin already completed BY HAND in Razorpay — this
    // route moves no money and calls no gateway, exactly as the "Cancelled, but
    // paid for" warning in the dashboard's order drawer says nothing here does.
    // Gated on the order actually being Cancelled with a Paid payment on file,
    // so this cannot be used to announce a refund that was never owed.
    router.patch('/api/orders/:id/refund', requireAdmin, async (req, res) => {
        if (!isPositiveId(req.params.id)) {
            return res.status(400).json({ error: "Invalid order id." });
        }

        try {
            const { data: order, error: orderError } = await supabase
                .from('orders').select('*').eq('id', req.params.id).maybeSingle();
            if (orderError) throw orderError;
            if (!order) return res.status(404).json({ error: "That order no longer exists." });
            if (order.status !== 'Cancelled') {
                return res.status(400).json({ error: "Only a cancelled order can be marked refunded." });
            }
            if (order.refund_completed_at) {
                return res.status(200).json({ success: true, data: order, alreadyRefunded: true });
            }

            const { data: payment, error: paymentError } = await supabase
                .from('payments').select('*').eq('order_id', req.params.id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (paymentError) throw paymentError;
            if (!payment || payment.status !== 'Paid') {
                return res.status(400).json({ error: "This order has no captured payment to refund." });
            }

            const { data, error } = await supabase
                .from('orders')
                .update({ refund_completed_at: new Date().toISOString() })
                .eq('id', req.params.id)
                .select()
                .maybeSingle();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: "That order no longer exists." });

            try {
                await notifyRefundCompleted(data, payment);
            } catch (notifyError) {
                console.error("Refund notification failed:", notifyError);
            }

            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error("Mark Refund Complete Error:", error);
            res.status(500).json({ error: "Failed to record refund." });
        }
    });

    return router;
}

module.exports = { adminOrdersController };
