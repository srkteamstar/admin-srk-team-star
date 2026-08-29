const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireAdmin } = require('../../../core/security/guards');

/** @returns {import('express').Router} */
function adminDashboardController() {
    const router = express.Router();

    router.get('/api/dashboard/summary', requireAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        try {
            const { data, error } = await supabase.rpc('admin_dashboard_summary');
            if (error) throw error;
            res.status(200).json(data || {});
        } catch (error) {
            console.error('Fetch Dashboard Summary Error:', error);
            res.status(503).json({ error: 'Dashboard summary is temporarily unavailable.' });
        }
    });

    return router;
}

module.exports = { adminDashboardController };
