/*
 * modules/projects/projects.module.js — the module registration file
 * ============================================================================
 *
 * WHAT THIS MODULE OWNS
 *   the upcoming_projects table, the site_settings row that hides the whole
 *   section, and the project-images storage bucket
 *
 *   GET    /api/projects                                  admin
 *   GET    /api/projects/public                           anonymous
 *   PATCH  /api/projects/:id/visibility                   admin
 *   GET    /api/settings/upcoming-projects-visibility     admin
 *   PATCH  /api/settings/upcoming-projects-visibility     admin
 *   POST   /api/projects                                  admin, multipart
 *   DELETE /api/projects/:id                              admin
 *
 * One cover image per row, stored as <row id>-cover in a public bucket — the
 * same convention modules/categories uses.
 */
const express = require('express');
const { adminProjectsController } = require('./controllers/admin-projects.controller');

/** @returns {import('express').Router} */
function projectsModule() {
    const router = express.Router();
    router.use(adminProjectsController());
    return router;
}

module.exports = { projectsModule };
