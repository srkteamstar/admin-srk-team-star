/*
 * modules/categories/controllers/admin-categories.controller.js
 * ============================================================================
 *
 * The Categories tab: list, activate/deactivate, save (with the cover image)
 * and delete. Same storage convention as modules/projects - one cover per row,
 * stored as <row id>-cover in a public bucket.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireAdmin } = require('../../../core/security/guards');
const { upload, hasValidImageSignature } = require('../../../core/uploads/image-upload');
const { slugify } = require('../../../shared/text');
const { CATEGORY_BUCKET, fetchCategoryRows, withImageUrl } = require('../infrastructure/category.repository');

/** @returns {import('express').Router} */
function adminCategoriesController() {
    const router = express.Router();

    router.get('/api/categories', requireAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        try {
            const rows = await fetchCategoryRows();
            res.status(200).json(rows.map(withImageUrl));
        } catch (error) {
            console.error("Fetch Categories Error:", error);
            res.status(500).json({ error: "Failed to fetch categories." });
        }
    });

    // Public, read-only version for the storefront. Only active categories, and only
    // the fields a customer-facing card needs.
    //
    // `parent_id` rides along because the storefront's category structure is part of
    // what a customer sees, not internal bookkeeping: the All Products filter row
    // rolls sub-categories up into their parent's tab and offers them as that tab's
    // dropdown, which it cannot work out from a flat list. An inactive parent is
    // filtered out of the response, so a child whose parent_id points at a missing

    router.patch('/api/categories/:id/status', requireAdmin, async (req, res) => {
        if (typeof req.body.is_active !== 'boolean') {
            return res.status(400).json({ error: "is_active must be a boolean." });
        }

        try {
            const { data, error } = await supabase
                .from('categories')
                .update({ is_active: req.body.is_active, updated_at: new Date().toISOString() })
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error("Category Status Error:", error);
            res.status(500).json({ error: "Failed to update category status." });
        }
    });

    // Save Category (Insert/Update + cover upload, mirroring POST /api/projects)
    router.post('/api/categories', requireAdmin, (req, res, next) => {
        upload.single('image')(req, res, (err) => {
            if (err) {
                return res.status(400).json({ error: err.message || "Invalid file uploaded." });
            }
            next();
        });
    }, async (req, res) => {
        const { id, name, url_slug, description, parent_id, is_featured, is_active, remove_image } = req.body;

        if (req.file && !hasValidImageSignature(req.file)) {
            return res.status(400).json({ error: "The uploaded file is not a valid AVIF or WebP image." });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Category name is required." });
        }

        const slug = slugify(url_slug) || slugify(name);
        if (!slug) {
            return res.status(400).json({ error: "Could not build a URL slug from that name. Use letters or numbers." });
        }

        // Multipart bodies arrive as strings, so booleans and numbers are parsed here.
        // product_count is deliberately not among them: it is counted off the products
        // table on every read (see countProductsByCategory) instead of being stored.
        const parsedParent = parent_id === undefined || parent_id === '' || parent_id === 'null'
            ? null
            : parseInt(parent_id, 10);

        if (parsedParent !== null && Number.isNaN(parsedParent)) {
            return res.status(400).json({ error: "Invalid parent category." });
        }
        if (parsedParent !== null && id && id !== 'new' && String(parsedParent) === String(id)) {
            return res.status(400).json({ error: "A category cannot be its own parent." });
        }

        const categoryData = {
            name: name.trim(),
            url_slug: slug,
            description: description?.trim() || null,
            parent_id: parsedParent,
            is_featured: is_featured === 'true' || is_featured === true,
            is_active: is_active === undefined ? true : (is_active === 'true' || is_active === true),
            updated_at: new Date().toISOString()
        };

        try {
            let categoryId = id;

            if (categoryId && categoryId !== 'new') {
                const { error } = await supabase
                    .from('categories')
                    .update(categoryData)
                    .eq('id', categoryId);
                if (error) throw error;
            } else {
                const { data, error } = await supabase
                    .from('categories')
                    .insert([categoryData])
                    .select()
                    .single();
                if (error) throw error;
                categoryId = data.id;
            }

            const fileName = `${categoryId}-cover`;

            if (req.file) {
                const { error: uploadError } = await supabase
                    .storage
                    .from(CATEGORY_BUCKET)
                    .upload(fileName, req.file.buffer, {
                        contentType: req.file.mimetype,
                        upsert: true
                    });

                if (uploadError) throw uploadError;
            } else if (remove_image === 'true' || remove_image === true) {
                // A new file always wins over a removal, hence the else-if.
                const { error: removeError } = await supabase
                    .storage
                    .from(CATEGORY_BUCKET)
                    .remove([fileName]);

                if (removeError) throw removeError;
            }

            res.status(200).json({ success: true, id: categoryId });
        } catch (error) {
            console.error("Category Save Error:", error);

            // 23505 = unique_violation on categories_url_slug_key
            if (error.code === '23505') {
                return res.status(409).json({ error: `The URL slug "${slug}" is already used by another category.` });
            }
            res.status(500).json({ error: "Failed to save category or image." });
        }
    });

    router.delete('/api/categories/:id', requireAdmin, async (req, res) => {
        try {
            const categoryId = req.params.id;

            const { error: dbError } = await supabase.from('categories').delete().eq('id', categoryId);
            if (dbError) throw dbError;

            await supabase.storage.from(CATEGORY_BUCKET).remove([`${categoryId}-cover`]);

            res.status(200).json({ success: true });
        } catch (error) {
            console.error("Delete Category Error:", error);
            res.status(500).json({ error: "Failed to delete category." });
        }
    });

    return router;
}

module.exports = { adminCategoriesController };
