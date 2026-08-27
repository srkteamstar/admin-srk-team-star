/*
 * modules/orders/controllers/admin-orders.controller.js
 * ============================================================================
 *
 *   GET   /api/orders              admin
 *   PATCH /api/orders/:id/status   admin - status and tracking only
 *
 * FINANCIAL RECORDS, NOT A CATALOGUE. There is no POST and no DELETE here.
 * The only thing an administrator changes is where the order actually is,
 * which is deliberately separate from payments.status: an order can be Paid
 * and still sit in Processing for days.
 *
 * tracking is written only when the key is present at all, so a status-only
 * update (the common case, marking Delivered) never clobbers a tracking number
 * entered on an earlier Shipped update.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireAdmin } = require('../../../core/security/guards');
const { trimmed } = require('../../../shared/validation');
const { ORDER_STATUSES } = require('../../../shared/contracts/order-status');
const { fetchOrderRows } = require('../infrastructure/order.repository');

/** @returns {import('express').Router} */
function adminOrdersController() {
    const router = express.Router();

    router.get('/api/orders', requireAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        try {
            const rows = await fetchOrderRows();
            res.status(200).json(rows);
        } catch (error) {
            console.error("Fetch Orders Error:", error);
            res.status(500).json({ error: "Failed to fetch orders." });
        }
    });

    router.patch('/api/orders/:id/status', requireAdmin, async (req, res) => {
        const status = trimmed(req.body.status);

        if (!ORDER_STATUSES.includes(status)) {
            return res.status(400).json({ error: `Status must be one of: ${ORDER_STATUSES.join(', ')}.` });
        }

        // tracking is only written when the key is present at all, so a status-only
        // update (the common case — marking Delivered) never clobbers a tracking
        // number entered on an earlier Shipped update.
        const updateData = { status };
        if (Object.prototype.hasOwnProperty.call(req.body, 'tracking')) {
            updateData.tracking = trimmed(req.body.tracking) || null;
        }

        try {
            const { data, error } = await supabase
                .from('orders')
                .update(updateData)
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error("Update Order Error:", error);
            res.status(500).json({ error: "Failed to update order." });
        }
    });

    return router;
}

module.exports = { adminOrdersController };
