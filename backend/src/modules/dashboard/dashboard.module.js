const express = require('express');
const { adminDashboardController } = require('./controllers/admin-dashboard.controller');

/** @returns {import('express').Router} */
function dashboardModule() {
    const router = express.Router();
    router.use(adminDashboardController());
    return router;
}

module.exports = { dashboardModule };
