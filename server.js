/*
 * Vercel's Express entry point.
 *
 * The normal Node deployment still starts through backend/server.js. Vercel
 * looks for a root entry point that imports Express and exports the app rather
 * than holding a port open, so this file is a deliberately thin adapter over
 * the same composition root.
 */
// Vercel injects production environment variables before this module loads.
// Local development starts through backend/server.js, which loads backend/.env.
// Keeping that file out of this adapter also keeps it out of Vercel's traced
// function bundle when somebody runs a local prebuild.

// Vercel's Express detector requires the recognized entry point to import the
// framework directly. Application construction remains in backend/src/main.
const express = require('express');
const { createApp } = require('./backend/src/main');

if (typeof express !== 'function') {
    throw new Error('Express did not load.');
}

const app = createApp();

module.exports = app;
