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
const { upload, normalizeImage, ImageValidationError } = require('../../../core/uploads/image-upload');
const { readStorageSnapshot, restoreStorageSnapshot, removeStorageObject } = require('../../../core/uploads/storage-snapshots');
const { slugify } = require('../../../shared/text');
const { CATEGORY_BUCKET, fetchCategoryRows, withImageUrl } = require('../infrastructure/category.repository');
const { isPositiveId, boundedText } = require('../../../shared/validation');
const { paginationFor, setPaginationHeaders } = require('../../../core/http/pagination');

async function parentProblemFor(categoryId, parentId) {
    if (parentId === null) return null;
    const { data, error } = await supabase.from('categories').select('id, parent_id');
    if (error) throw error;

    const parentById = new Map((data || []).map(row => [String(row.id), row.parent_id]));
    if (!parentById.has(String(parentId))) return "That parent category no longer exists.";

    const seen = new Set();
    let cursor = String(parentId);
    while (cursor) {
        if (categoryId !== null && String(categoryId) === cursor) {
            return "A category parent relationship cannot contain a cycle.";
        }
        if (seen.has(cursor)) return "The selected parent already belongs to a category cycle.";
        seen.add(cursor);
        const next = parentById.get(cursor);
        cursor = next === null || next === undefined ? '' : String(next);
    }
    return null;
}

/** @returns {import('express').Router} */
function adminCategoriesController() {
    const router = express.Router();

    router.get('/api/categories', requireAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        try {
            const pagination = paginationFor(req, res);
            if (!pagination) return;
            const { rows, total } = await fetchCategoryRows(pagination);
            setPaginationHeaders(res, pagination, total);
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
        if (!isPositiveId(req.params.id)) {
            return res.status(400).json({ error: "Invalid category id." });
        }
        if (typeof req.body.is_active !== 'boolean') {
            return res.status(400).json({ error: "is_active must be a boolean." });
        }

        try {
            const { data, error } = await supabase
                .from('categories')
                .update({ is_active: req.body.is_active, updated_at: new Date().toISOString() })
                .eq('id', req.params.id)
                .select()
                .maybeSingle();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: "That category no longer exists." });
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
        const { id, name, url_slug, description, parent_id, is_featured, is_active, remove_image } = req.body || {};

        try {
            if (req.file) req.file = await normalizeImage(req.file);
        } catch (error) {
            if (error instanceof ImageValidationError) return res.status(400).json({ error: error.message });
            throw error;
        }

        if (id !== 'new' && !isPositiveId(id)) return res.status(400).json({ error: "Invalid category id." });
        const checkedName = boundedText('Category name', name, 160, { required: true });
        const checkedDescription = boundedText('Category description', description, 5000);
        if (checkedName.error || checkedDescription.error) {
            return res.status(400).json({ error: checkedName.error || checkedDescription.error });
        }
        if (typeof url_slug === 'string' && url_slug.length > 200) {
            return res.status(400).json({ error: "Category URL slug is too long (maximum 200 characters)." });
        }

        const slug = slugify(url_slug) || slugify(checkedName.value);
        if (!slug) {
            return res.status(400).json({ error: "Could not build a URL slug from that name. Use letters or numbers." });
        }

        // Multipart bodies arrive as strings, so booleans and numbers are parsed here.
        // product_count is deliberately not among them: it is counted off the products
        // table on every read (see countProductsByCategory) instead of being stored.
        const parsedParent = parent_id === undefined || parent_id === '' || parent_id === 'null'
            ? null
            : parseInt(parent_id, 10);

        if (parsedParent !== null && (Number.isNaN(parsedParent) || !isPositiveId(parsedParent))) {
            return res.status(400).json({ error: "Invalid parent category." });
        }
        if (parsedParent !== null && id && id !== 'new' && String(parsedParent) === String(id)) {
            return res.status(400).json({ error: "A category cannot be its own parent." });
        }

        const categoryData = {
            name: checkedName.value,
            url_slug: slug,
            description: checkedDescription.value,
            parent_id: parsedParent,
            is_featured: is_featured === 'true' || is_featured === true,
            is_active: is_active === undefined ? true : (is_active === 'true' || is_active === true),
            updated_at: new Date().toISOString()
        };

        let categoryId = id;
        let previousRow = null;
        let created = false;
        let committed = false;
        let storageSnapshot;
        let storageSnapshotReady = false;
        const storageRequested = Boolean(req.file) || remove_image === 'true' || remove_image === true;

        try {
            const parentProblem = await parentProblemFor(categoryId === 'new' ? null : categoryId, parsedParent);
            if (parentProblem) return res.status(400).json({ error: parentProblem });

            if (categoryId && categoryId !== 'new') {
                const { data: current, error: currentError } = await supabase
                    .from('categories').select('*').eq('id', categoryId).maybeSingle();
                if (currentError) throw currentError;
                if (!current) return res.status(404).json({ error: "That category no longer exists." });
                previousRow = current;

                const { data, error } = await supabase
                    .from('categories')
                    .update(categoryData)
                    .eq('id', categoryId)
                    .select('id')
                    .maybeSingle();
                if (error) throw error;
                if (!data) return res.status(404).json({ error: "That category no longer exists." });
                committed = true;
            } else {
                const { data, error } = await supabase
                    .from('categories')
                    .insert([categoryData])
                    .select()
                    .single();
                if (error) throw error;
                categoryId = data.id;
                created = true;
                committed = true;
            }

            const fileName = `${categoryId}-cover`;

            if (storageRequested) {
                storageSnapshot = await readStorageSnapshot(CATEGORY_BUCKET, fileName);
                storageSnapshotReady = true;
            }

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

            if (committed) {
                try {
                    if (storageSnapshotReady) {
                        await restoreStorageSnapshot(CATEGORY_BUCKET, `${categoryId}-cover`, storageSnapshot);
                    }
                    if (created) {
                        const { error: rollbackError } = await supabase.from('categories').delete().eq('id', categoryId);
                        if (rollbackError) throw rollbackError;
                    } else if (previousRow) {
                        const { id: ignoredId, created_at: ignoredCreatedAt, ...restoreData } = previousRow;
                        const { error: rollbackError } = await supabase.from('categories').update(restoreData).eq('id', categoryId);
                        if (rollbackError) throw rollbackError;
                    }
                } catch (rollbackError) {
                    console.error('CRITICAL Category Save Rollback Error:', rollbackError);
                }
            }

            // 23505 = unique_violation on categories_url_slug_key
            if (error.code === '23505') {
                return res.status(409).json({ error: `The URL slug "${slug}" is already used by another category.` });
            }
            res.status(500).json({ error: "Failed to save category or image." });
        }
    });

    router.delete('/api/categories/:id', requireAdmin, async (req, res) => {
        if (!isPositiveId(req.params.id)) {
            return res.status(400).json({ error: "Invalid category id." });
        }
        const categoryId = req.params.id;
        const objectPath = `${categoryId}-cover`;
        let snapshot;
        let storagePrepared = false;
        try {
            const { data: current, error: currentError } = await supabase
                .from('categories').select('id').eq('id', categoryId).maybeSingle();
            if (currentError) throw currentError;
            if (!current) return res.status(404).json({ error: "That category no longer exists." });

            snapshot = await removeStorageObject(CATEGORY_BUCKET, objectPath);
            storagePrepared = true;

            const { data: deleted, error: dbError } = await supabase
                .from('categories')
                .delete()
                .eq('id', categoryId)
                .select('id')
                .maybeSingle();
            if (dbError) throw dbError;
            if (!deleted) {
                await restoreStorageSnapshot(CATEGORY_BUCKET, objectPath, snapshot);
                return res.status(404).json({ error: "That category no longer exists." });
            }

            res.status(200).json({ success: true });
        } catch (error) {
            console.error("Delete Category Error:", error);
            if (storagePrepared) {
                try {
                    await restoreStorageSnapshot(CATEGORY_BUCKET, objectPath, snapshot);
                } catch (rollbackError) {
                    console.error('CRITICAL Category Delete Rollback Error:', rollbackError);
                }
            }
            res.status(500).json({ error: "Failed to delete category." });
        }
    });

    return router;
}

module.exports = { adminCategoriesController };
