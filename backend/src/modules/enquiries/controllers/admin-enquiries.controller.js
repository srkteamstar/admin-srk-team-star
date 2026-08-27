/*
 * modules/enquiries/controllers/admin-enquiries.controller.js
 * ============================================================================
 *
 * The Technical Support tab's three routes. All behind requireAdmin, which is
 * core's to enforce and this module's only to ask for.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireAdmin } = require('../../../core/security/guards');
const { trimmed } = require('../../../shared/validation');
const { ENQUIRY_STATUSES } = require('../domain/enquiry-status');

/** @returns {import('express').Router} */
function adminEnquiriesController() {
    const router = express.Router();

    router.get('/api/enquiries', requireAdmin, async (req, res) => {
        // Prevent caching to guarantee fresh data on refresh
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    
        try {
            const { data, error } = await supabase
                .from('enquiries')
                .select(`*, form_types (type_name)`)
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.status(200).json(data || []);
        } catch (error) {
            console.error("Fetch Error:", error);
            res.status(500).json({ error: "Failed to fetch enquiries." });
        }
    });

    // The three values enquiries.js paints buttons and badge colours for. The
    // quote and order equivalents of this route have always validated against
    // their own lists; this one wrote req.body.status straight through, so any
    // string at all — of any length, from a session that had merely been
    // hijacked or an XSS on the dashboard — became the status of a real support
    // ticket, and the tab would then render it as an unknown state forever.
    // Admin-only is a reason to trust the *person*, not the request body.
    const ENQUIRY_STATUSES = ['Open', 'In Progress', 'Resolved'];

    router.patch('/api/enquiries/:id/status', requireAdmin, async (req, res) => {
        const status = trimmed(req.body.status);

        if (!ENQUIRY_STATUSES.includes(status)) {
            return res.status(400).json({ error: `Status must be one of: ${ENQUIRY_STATUSES.join(', ')}.` });
        }

        try {
            const { data, error } = await supabase
                .from('enquiries')
                .update({ status })
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error("Update Error:", error);
            res.status(500).json({ error: "Failed to update status." });
        }
    });

    router.delete('/api/enquiries/:id', requireAdmin, async (req, res) => {
        try {
            const { error } = await supabase.from('enquiries').delete().eq('id', req.params.id);
            if (error) throw error;
            res.status(200).json({ success: true });
        } catch (error) {
            console.error("Delete Error:", error);
            res.status(500).json({ error: "Failed to delete ticket." });
        }
    });

    return router;
}

module.exports = { adminEnquiriesController };
