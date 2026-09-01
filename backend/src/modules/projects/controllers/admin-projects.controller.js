/*
 * modules/projects/controllers/admin-projects.controller.js
 * ============================================================================
 *
 * The Upcoming Projects tab: list, per-project visibility, the section switch,
 * save (which also carries the cover image) and delete.
 *
 * The save route wraps multer by hand rather than passing it as middleware, so
 * that a rejected file type answers 400 with the reason instead of falling
 * into the default error handler as a 500. Same pattern in categories and
 * products.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireAdmin } = require('../../../core/security/guards');
const { upload, normalizeImage, ImageValidationError } = require('../../../core/uploads/image-upload');
const { readStorageSnapshot, restoreStorageSnapshot, removeStorageObject } = require('../../../core/uploads/storage-snapshots');
const { SECTION_VISIBILITY_KEY, isSectionVisible } = require('../services/project-visibility.service');
const { isPositiveId, boundedText } = require('../../../shared/validation');
const { errorTag } = require('../../../shared/error-tag');
const { paginationFor, setPaginationHeaders } = require('../../../core/http/pagination');

/** @returns {import('express').Router} */
function adminProjectsController() {
    const router = express.Router();

    router.get('/api/projects', requireAdmin, async (req, res) => {
        // FIX: Force browsers to never cache this API response
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        try {
            const pagination = paginationFor(req, res);
            if (!pagination) return;
            const { data, count, error } = await supabase
                .from('upcoming_projects')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .range(pagination.from, pagination.to);

            if (error) throw error;

            const baseUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/project-images/`;
        
            // Safety fallback (data || []) ensures map doesn't crash if table is completely empty
            const enrichedData = (data || []).map(project => ({
                ...project,
                image_url: `${baseUrl}${project.id}-cover`
            }));

            setPaginationHeaders(res, pagination, count);
            res.status(200).json(enrichedData);
        } catch (error) {
            console.error("Fetch Projects Error:", errorTag(error));
            res.status(500).json({ error: "Failed to fetch projects." });
        }
    });

    // Flip a single project's public visibility without deleting it.
    router.patch('/api/projects/:id/visibility', requireAdmin, async (req, res) => {
        if (!isPositiveId(req.params.id)) {
            return res.status(400).json({ error: "Invalid project id." });
        }
        if (typeof req.body.is_visible !== 'boolean') {
            return res.status(400).json({ error: "is_visible must be a boolean." });
        }

        try {
            const { data, error } = await supabase
                .from('upcoming_projects')
                .update({ is_visible: req.body.is_visible })
                .eq('id', req.params.id)
                .select()
                .maybeSingle();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: "That project no longer exists." });
            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error("Project Visibility Error:", errorTag(error));
            res.status(500).json({ error: "Failed to update project visibility." });
        }
    });

    // Flip the whole Upcoming Projects section on/off for the public site.
    router.get('/api/settings/upcoming-projects-visibility', requireAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        try {
            res.status(200).json({ section_visible: await isSectionVisible() });
        } catch (error) {
            console.error("Section Visibility Read Error:", errorTag(error));
            res.status(503).json({ error: "Could not read section visibility." });
        }
    });

    router.patch('/api/settings/upcoming-projects-visibility', requireAdmin, async (req, res) => {
        if (typeof req.body.section_visible !== 'boolean') {
            return res.status(400).json({ error: "section_visible must be a boolean." });
        }

        try {
            const { error } = await supabase
                .from('site_settings')
                .upsert({ key: SECTION_VISIBILITY_KEY, value: req.body.section_visible });

            if (error) throw error;
            res.status(200).json({ success: true, section_visible: req.body.section_visible });
        } catch (error) {
            console.error("Section Visibility Error:", errorTag(error));
            res.status(500).json({ error: "Failed to update section visibility." });
        }
    });

    // Save Project (Handles Insert/Update AND Image Upload with Multer Validation Error Handler)
    router.post('/api/projects', requireAdmin, (req, res, next) => {
        upload.single('image')(req, res, (err) => {
            if (err) {
                return res.status(400).json({ error: err.message || "Invalid file uploaded." });
            }
            next();
        });
    }, async (req, res) => {
        const { id, project_category_title, project_name, project_description, due_date, remove_image } = req.body || {};

        try {
            if (req.file) req.file = await normalizeImage(req.file);
        } catch (error) {
            if (error instanceof ImageValidationError) return res.status(400).json({ error: error.message });
            throw error;
        }

        if (id !== 'new' && !isPositiveId(id)) {
            return res.status(400).json({ error: "Invalid project id." });
        }

        const category = boundedText('Project category', project_category_title, 160, { required: true });
        const name = boundedText('Project name', project_name, 200, { required: true });
        const description = boundedText('Project description', project_description, 5000, { required: true });
        const dueDate = boundedText('Due date', due_date, 80, { required: true });
        const problem = [category, name, description, dueDate].find(field => field.error);
        if (problem) return res.status(400).json({ error: problem.error });

        let projectId = id;
        let previousRow = null;
        let created = false;
        let committed = false;
        let storageSnapshot;
        let storageSnapshotReady = false;
        const storageRequested = Boolean(req.file) || remove_image === 'true' || remove_image === true;

        try {
        
            const projectData = {
                project_category_title: category.value,
                project_name: name.value,
                project_description: description.value,
                due_date: dueDate.value,
                updated_at: new Date().toISOString()
            };

            if (projectId && projectId !== 'new') {
                const { data: current, error: currentError } = await supabase
                    .from('upcoming_projects').select('*').eq('id', projectId).maybeSingle();
                if (currentError) throw currentError;
                if (!current) return res.status(404).json({ error: "That project no longer exists." });
                previousRow = current;

                const { data, error } = await supabase
                    .from('upcoming_projects')
                    .update(projectData)
                    .eq('id', projectId)
                    .select('id')
                    .maybeSingle();
                if (error) throw error;
                if (!data) return res.status(404).json({ error: "That project no longer exists." });
                committed = true;
            } else {
                const { data, error } = await supabase
                    .from('upcoming_projects')
                    .insert([projectData])
                    .select()
                    .single();
                if (error) throw error;
                projectId = data.id;
                created = true;
                committed = true;
            }

            const fileName = `${projectId}-cover`;

            if (storageRequested) {
                storageSnapshot = await readStorageSnapshot('project-images', fileName);
                storageSnapshotReady = true;
            }

            if (req.file) {
                const { error: uploadError } = await supabase
                    .storage
                    .from('project-images')
                    .upload(fileName, req.file.buffer, {
                        contentType: req.file.mimetype,
                        upsert: true
                    });

                if (uploadError) throw uploadError;
            } else if (remove_image === 'true' || remove_image === true) {
                // A new file always wins over a removal, hence the else-if.
                const { error: removeError } = await supabase
                    .storage
                    .from('project-images')
                    .remove([fileName]);

                if (removeError) throw removeError;
            }

            res.status(200).json({ success: true, id: projectId });
        } catch (error) {
            console.error("Project Save Error:", errorTag(error));
            if (committed) {
                try {
                    if (storageSnapshotReady) {
                        await restoreStorageSnapshot('project-images', `${projectId}-cover`, storageSnapshot);
                    }
                    if (created) {
                        const { error: rollbackError } = await supabase.from('upcoming_projects').delete().eq('id', projectId);
                        if (rollbackError) throw rollbackError;
                    } else if (previousRow) {
                        const { id: ignoredId, created_at: ignoredCreatedAt, ...restoreData } = previousRow;
                        const { error: rollbackError } = await supabase.from('upcoming_projects').update(restoreData).eq('id', projectId);
                        if (rollbackError) throw rollbackError;
                    }
                } catch (rollbackError) {
                    console.error('CRITICAL Project Save Rollback Error:', errorTag(rollbackError));
                }
            }
            res.status(500).json({ error: "Failed to save project or image." });
        }
    });

    router.delete('/api/projects/:id', requireAdmin, async (req, res) => {
        if (!isPositiveId(req.params.id)) {
            return res.status(400).json({ error: "Invalid project id." });
        }
        const projectId = req.params.id;
        const objectPath = `${projectId}-cover`;
        let snapshot;
        let storagePrepared = false;
        try {
            const { data: current, error: currentError } = await supabase
                .from('upcoming_projects').select('id').eq('id', projectId).maybeSingle();
            if (currentError) throw currentError;
            if (!current) return res.status(404).json({ error: "That project no longer exists." });

            snapshot = await removeStorageObject('project-images', objectPath);
            storagePrepared = true;

            const { data: deleted, error: dbError } = await supabase
                .from('upcoming_projects')
                .delete()
                .eq('id', projectId)
                .select('id')
                .maybeSingle();
            if (dbError) throw dbError;
            if (!deleted) {
                await restoreStorageSnapshot('project-images', objectPath, snapshot);
                return res.status(404).json({ error: "That project no longer exists." });
            }

            res.status(200).json({ success: true });
        } catch (error) {
            console.error("Delete Project Error:", errorTag(error));
            if (storagePrepared) {
                try {
                    await restoreStorageSnapshot('project-images', objectPath, snapshot);
                } catch (rollbackError) {
                    console.error('CRITICAL Project Delete Rollback Error:', errorTag(rollbackError));
                }
            }
            res.status(500).json({ error: "Failed to delete project." });
        }
    });

    return router;
}

module.exports = { adminProjectsController };
