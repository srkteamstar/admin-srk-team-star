/*
 * modules/quotes/controllers/admin-quotes.controller.js
 * ============================================================================
 *
 * The Quotations tab. GET re-sorts the embedded items because PostgREST
 * promises no order for an embedded resource and the dashboard numbers them
 * exactly as the customer did.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireAdmin } = require('../../../core/security/guards');
const { trimmed } = require('../../../shared/validation');
const { QUOTE_STATUSES } = require('../domain/quote-status');
const { quoteReference } = require('../domain/quote-reference');

/** @returns {import('express').Router} */
function adminQuotesController() {
    const router = express.Router();

    router.get('/api/quote-requests', requireAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        try {
            // One embedded read rather than two round trips — the items -> header
            // foreign key in 009 is what lets PostgREST nest them.
            const { data, error } = await supabase
                .from('quote_requests')
                .select('*, quote_request_items (*)')
                .order('created_at', { ascending: false });

            if (error) throw error;

            // PostgREST does not promise an order for an embedded resource, and the
            // dashboard numbers the items exactly as the customer did.
            const rows = (data || []).map(row => ({
                ...row,
                reference: quoteReference(row.id, row.created_at),
                quote_request_items: (row.quote_request_items || [])
                    .slice()
                    .sort((a, b) => a.position - b.position)
            }));

            res.status(200).json(rows);
        } catch (error) {
            console.error("Fetch Error (Quotes):", error);
            res.status(500).json({ error: "Failed to fetch quote requests." });
        }
    });

    router.patch('/api/quote-requests/:id/status', requireAdmin, async (req, res) => {
        const status = trimmed(req.body.status);

        // The table has a CHECK constraint on the same three values; rejecting here
        // turns what would be an opaque 500 into a straight answer.
        if (!QUOTE_STATUSES.includes(status)) {
            return res.status(400).json({ error: `Status must be one of: ${QUOTE_STATUSES.join(', ')}.` });
        }

        try {
            const { data, error } = await supabase
                .from('quote_requests')
                .update({ status })
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error("Update Error (Quotes):", error);
            res.status(500).json({ error: "Failed to update quote status." });
        }
    });

    router.delete('/api/quote-requests/:id', requireAdmin, async (req, res) => {
        try {
            // The items go with it — `on delete cascade` in 009.
            const { error } = await supabase.from('quote_requests').delete().eq('id', req.params.id);
            if (error) throw error;
            res.status(200).json({ success: true });
        } catch (error) {
            console.error("Delete Error (Quotes):", error);
            res.status(500).json({ error: "Failed to delete quote request." });
        }
    });

    return router;
}

module.exports = { adminQuotesController };
