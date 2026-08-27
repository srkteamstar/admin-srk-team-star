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
const { upload } = require('../../../core/uploads/image-upload');
const { SECTION_VISIBILITY_KEY, isSectionVisible } = require('../services/project-visibility.service');

/** @returns {import('express').Router} */
function adminProjectsController() {
    const router = express.Router();

    router.get('/api/projects', requireAdmin, async (req, res) => {
        // FIX: Force browsers to never cache this API response
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        try {
            const { data, error } = await supabase
                .from('upcoming_projects')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const baseUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/project-images/`;
        
            // Safety fallback (data || []) ensures map doesn't crash if table is completely empty
            const enrichedData = (data || []).map(project => ({
                ...project,
                image_url: `${baseUrl}${project.id}-cover`
            }));

            res.status(200).json(enrichedData);
        } catch (error) {
            console.error("Fetch Projects Error:", error);
            res.status(500).json({ error: "Failed to fetch projects." });
        }
    });

    // Flip a single project's public visibility without deleting it.
    router.patch('/api/projects/:id/visibility', requireAdmin, async (req, res) => {
        if (typeof req.body.is_visible !== 'boolean') {
            return res.status(400).json({ error: "is_visible must be a boolean." });
        }

        try {
            const { data, error } = await supabase
                .from('upcoming_projects')
                .update({ is_visible: req.body.is_visible })
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error("Project Visibility Error:", error);
            res.status(500).json({ error: "Failed to update project visibility." });
        }
    });

    // Flip the whole Upcoming Projects section on/off for the public site.
    router.get('/api/settings/upcoming-projects-visibility', requireAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ section_visible: await isSectionVisible() });
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
            console.error("Section Visibility Error:", error);
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
        const { id, project_category_title, project_name, project_description, due_date, remove_image } = req.body;

        try {
            let projectId = id;
        
            const projectData = {
                project_category_title: project_category_title || null, 
                project_name: project_name,
                project_description: project_description,
                due_date: due_date,
                updated_at: new Date().toISOString()
            };

            if (projectId && projectId !== 'new') {
                const { error } = await supabase
                    .from('upcoming_projects')
                    .update(projectData)
                    .eq('id', projectId);
                if (error) throw error;
            } else {
                const { data, error } = await supabase
                    .from('upcoming_projects')
                    .insert([projectData])
                    .select()
                    .single();
                if (error) throw error;
                projectId = data.id;
            }

            const fileName = `${projectId}-cover`;

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
            console.error("Project Save Error:", error);
            res.status(500).json({ error: "Failed to save project or image." });
        }
    });

    router.delete('/api/projects/:id', requireAdmin, async (req, res) => {
        try {
            const projectId = req.params.id;

            const { error: dbError } = await supabase.from('upcoming_projects').delete().eq('id', projectId);
            if (dbError) throw dbError;

            await supabase.storage.from('project-images').remove([`${projectId}-cover`]);

            res.status(200).json({ success: true });
        } catch (error) {
            console.error("Delete Project Error:", error);
            res.status(500).json({ error: "Failed to delete project." });
        }
    });

    return router;
}

module.exports = { adminProjectsController };
