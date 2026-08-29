/*
 * modules/products/controllers/admin-products.controller.js
 * ============================================================================
 *
 * The Products tab. The save route is the largest handler in the application
 * and is left whole: it writes the row, then up to four images into the
 * product-images bucket, then the product_images rows that point at them, and
 * the ordering between those three is the only thing that keeps a half-saved
 * product from showing a picture it does not have.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireAdmin } = require('../../../core/security/guards');
const { upload, normalizeImage, ImageValidationError } = require('../../../core/uploads/image-upload');
const { readStorageSnapshot, restoreStorageSnapshot } = require('../../../core/uploads/storage-snapshots');
const { slugify } = require('../../../shared/text');
const { isMissingRelation, isMissingColumn, isPermissionDenied } = require('../../../core/database/postgrest-errors');
const { PRODUCT_BUCKET, fetchProductRows, withProductImages } = require('../infrastructure/product.repository');
const { PRODUCT_MAX_IMAGES, PRODUCT_IMAGE_SLOTS } = require('../domain/product-images');
const { sendProductError } = require('../services/product-errors.service');
const { isPositiveId, boundedText } = require('../../../shared/validation');
const { paginationFor, setPaginationHeaders } = require('../../../core/http/pagination');

/** @returns {import('express').Router} */
function adminProductsController() {
    const router = express.Router();

    router.get('/api/products', requireAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        try {
            const pagination = paginationFor(req, res);
            if (!pagination) return;
            const { rows, total } = await fetchProductRows(pagination);
            setPaginationHeaders(res, pagination, total);
            res.status(200).json(rows.map(withProductImages));
        } catch (error) {
            console.error("Fetch Products Error:", error);
            sendProductError(res, error, "Failed to fetch products.");
        }
    });

    // Public, read-only version for the storefront. Only active products, and only
    // the fields a customer-facing card needs — no timestamps, no internal ids

    router.patch('/api/products/:id/status', requireAdmin, async (req, res) => {
        if (!isPositiveId(req.params.id)) {
            return res.status(400).json({ error: "Invalid product id." });
        }
        if (typeof req.body.is_active !== 'boolean') {
            return res.status(400).json({ error: "is_active must be a boolean." });
        }

        try {
            const { data, error } = await supabase
                .from('products')
                .update({ is_active: req.body.is_active, updated_at: new Date().toISOString() })
                .eq('id', req.params.id)
                .select()
                .maybeSingle();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: "That product no longer exists." });
            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error("Product Status Error:", error);
            sendProductError(res, error, "Failed to update product status.");
        }
    });

    // Save Product (Insert/Update + up to four grouped images)
    //
    // Files arrive as image_1 … image_4 and only for slots the admin actually
    // touched, so an edit that changes nothing but the name uploads nothing.
    // `remove_slots` is a comma list of slots to clear, and `main_slot` says which
    // one is the main image.
    router.post('/api/products', requireAdmin, (req, res, next) => {
        const imageFields = PRODUCT_IMAGE_SLOTS.map(slot => ({ name: `image_${slot}`, maxCount: 1 }));

        upload.fields(imageFields)(req, res, (err) => {
            if (err) {
                return res.status(400).json({ error: err.message || "Invalid file uploaded." });
            }
            next();
        });
    }, async (req, res) => {
        // multer only populates req.body for multipart/form-data. Any other content
        // type (or no body at all) would otherwise crash the destructure and return a
        // 500 with a stack trace, so it falls through to the 400 below instead.
        const {
            id, name, url_slug, description, featured_description, price, category_id, asset_folder,
            is_featured, is_best_seller, is_new_arrival, is_active,
            main_slot, remove_slots
        } = req.body || {};

        try {
            for (const [field, files] of Object.entries(req.files || {})) {
                req.files[field] = await Promise.all(files.map(file => normalizeImage(file)));
            }
        } catch (error) {
            if (error instanceof ImageValidationError) return res.status(400).json({ error: error.message });
            throw error;
        }
        const uploadedImages = Object.values(req.files || {}).flat();

        if (id !== 'new' && !isPositiveId(id)) {
            return res.status(400).json({ error: "Invalid product id." });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Product name is required." });
        }
        if (name.trim().length > 160) {
            return res.status(400).json({ error: "Product name is too long (max 160 characters)." });
        }

        const checkedDescription = boundedText('Product description', description, 5000);
        if (checkedDescription.error) return res.status(400).json({ error: checkedDescription.error });
        if (typeof url_slug === 'string' && url_slug.length > 200) {
            return res.status(400).json({ error: "Product URL slug is too long (maximum 200 characters)." });
        }

        const slug = slugify(url_slug) || slugify(name);
        if (!slug) {
            return res.status(400).json({ error: "Could not build a URL slug from that name. Use letters or numbers." });
        }

        // Multipart bodies arrive as strings, so numbers and booleans are parsed here.
        const parsedCategory = category_id === undefined || category_id === '' || category_id === 'null'
            ? null
            : parseInt(category_id, 10);

        if (parsedCategory !== null && (Number.isNaN(parsedCategory) || !isPositiveId(parsedCategory))) {
            return res.status(400).json({ error: "Invalid category." });
        }

        // Price is deliberately free text — the storefront cards already render the
        // unit inline ('₹ 1,200 / box'), and "On request" has to stay expressible.
        const trimmedPrice = (price || '').toString().trim();
        if (trimmedPrice.length > 60) {
            return res.status(400).json({ error: "Price is too long (max 60 characters)." });
        }

        // asset_folder is joined onto assets/products/ by the storefront, so traversal
        // segments and backslashes are rejected. Nested folders stay legal
        // ('Cutting Machine/Rubber Support').
        // Hero copy, not the catalogue blurb — the slide has room for about two lines.
        const featuredCopy = (featured_description || '').toString().trim();
        if (featuredCopy.length > 300) {
            return res.status(400).json({ error: "Featured description is too long (max 300 characters)." });
        }

        const folder = (asset_folder || '').toString().trim().replace(/^[\/]+|[\/]+$/g, '');
        if (folder && (folder.includes('..') || folder.includes('\\') || folder.length > 200)) {
            return res.status(400).json({ error: "Asset folder must be a plain path like 'Frame Master' or 'Cutting Machine/Rubber Support'." });
        }

        // Slots are validated here as well as by the check constraint in 004, so a
        // malformed form gets a readable 400 instead of a database error.
        const parsedMainSlot = main_slot === undefined || main_slot === '' ? null : parseInt(main_slot, 10);
        if (parsedMainSlot !== null && !PRODUCT_IMAGE_SLOTS.includes(parsedMainSlot)) {
            return res.status(400).json({ error: `Main image slot must be between 1 and ${PRODUCT_MAX_IMAGES}.` });
        }

        const slotsToRemove = (remove_slots || '')
            .toString()
            .split(',')
            .map(value => parseInt(value.trim(), 10))
            .filter(value => PRODUCT_IMAGE_SLOTS.includes(value));

        const flag = value => value === 'true' || value === true;

        const productData = {
            name: name.trim(),
            url_slug: slug,
            description: checkedDescription.value,
            featured_description: featuredCopy || null,
            price: trimmedPrice || null,
            category_id: parsedCategory,
            asset_folder: folder || null,
            is_featured: flag(is_featured),
            is_best_seller: flag(is_best_seller),
            is_new_arrival: flag(is_new_arrival),
            is_active: is_active === undefined ? true : flag(is_active),
            updated_at: new Date().toISOString()
        };

        let productId = id;
        let previousProduct = null;
        let previousImages = [];
        let created = false;
        let committed = false;
        const storageSnapshots = new Map();

        try {

            if (productId && productId !== 'new') {
                const [currentProduct, currentImages] = await Promise.all([
                    supabase.from('products').select('*').eq('id', productId).maybeSingle(),
                    supabase.from('product_images').select('*').eq('product_id', productId)
                ]);
                if (currentProduct.error) throw currentProduct.error;
                if (currentImages.error) throw currentImages.error;
                if (!currentProduct.data) return res.status(404).json({ error: "That product no longer exists." });
                previousProduct = currentProduct.data;
                previousImages = currentImages.data || [];

                const { data, error } = await supabase
                    .from('products')
                    .update(productData)
                    .eq('id', productId)
                    .select('id')
                    .maybeSingle();
                if (error) throw error;
                if (!data) return res.status(404).json({ error: "That product no longer exists." });
                committed = true;
            } else {
                const { data, error } = await supabase
                    .from('products')
                    .insert([productData])
                    .select()
                    .single();
                if (error) throw error;
                productId = data.id;
                created = true;
                committed = true;
            }

            // ---- images ---------------------------------------------------------
            const uploadedSlots = PRODUCT_IMAGE_SLOTS.filter(slot => {
                return Boolean(req.files && req.files[`image_${slot}`] && req.files[`image_${slot}`][0]);
            });
            const affectedSlots = [...new Set([...slotsToRemove, ...uploadedSlots])];
            for (const slot of affectedSlots) {
                const path = `${productId}/${slot}`;
                storageSnapshots.set(path, await readStorageSnapshot(PRODUCT_BUCKET, path));
            }

            // Removals run first so that clearing slot 2 and uploading a new slot 2
            // in the same save ends with the new file, not a deleted one.
            if (slotsToRemove.length) {
                const { error: removeError } = await supabase
                    .storage
                    .from(PRODUCT_BUCKET)
                    .remove(slotsToRemove.map(slot => `${productId}/${slot}`));
                if (removeError) throw removeError;

                const { error: clearError } = await supabase
                    .from('product_images')
                    .delete()
                    .eq('product_id', productId)
                    .in('slot', slotsToRemove);

                if (clearError) throw clearError;
            }

            for (const slot of PRODUCT_IMAGE_SLOTS) {
                const file = req.files && req.files[`image_${slot}`] && req.files[`image_${slot}`][0];
                if (!file) continue;

                const { error: uploadError } = await supabase
                    .storage
                    .from(PRODUCT_BUCKET)
                    .upload(`${productId}/${slot}`, file.buffer, {
                        contentType: file.mimetype,
                        upsert: true
                    });

                if (uploadError) throw uploadError;

                // is_main is intentionally not written here — the block below owns
                // that decision, so an upload never silently steals the main flag.
                const { error: rowError } = await supabase
                    .from('product_images')
                    .upsert(
                        { product_id: productId, slot, updated_at: new Date().toISOString() },
                        { onConflict: 'product_id,slot' }
                    );

                if (rowError) throw rowError;
            }

            // Exactly one main image. The database guarantees *at most* one via the
            // partial unique index and clears the previous one by trigger; this
            // decides which it is, and promotes the lowest surviving slot when the
            // requested main was just removed.
            const { data: remaining, error: remainingError } = await supabase
                .from('product_images')
                .select('slot, is_main')
                .eq('product_id', productId)
                .order('slot', { ascending: true });

            if (remainingError) throw remainingError;

            const survivingSlots = (remaining || []).map(row => row.slot);
            if (survivingSlots.length) {
                const currentMain = (remaining.find(row => row.is_main) || {}).slot;
                const target = survivingSlots.includes(parsedMainSlot)
                    ? parsedMainSlot
                    : (survivingSlots.includes(currentMain) ? currentMain : survivingSlots[0]);

                const { error: mainError } = await supabase
                    .from('product_images')
                    .update({ is_main: true })
                    .eq('product_id', productId)
                    .eq('slot', target);

                if (mainError) throw mainError;
            }

            res.status(200).json({ success: true, id: productId });
        } catch (error) {
            console.error("Product Save Error:", error);

            if (committed) {
                const rollbackFailures = [];
                for (const [path, snapshot] of storageSnapshots) {
                    try {
                        await restoreStorageSnapshot(PRODUCT_BUCKET, path, snapshot);
                    } catch (rollbackError) {
                        rollbackFailures.push(rollbackError);
                    }
                }
                try {
                    if (created) {
                        const { error: rollbackError } = await supabase.from('products').delete().eq('id', productId);
                        if (rollbackError) throw rollbackError;
                    } else if (previousProduct) {
                        const { id: ignoredId, created_at: ignoredCreatedAt, ...restoreData } = previousProduct;
                        const restoredProduct = await supabase.from('products').update(restoreData).eq('id', productId);
                        if (restoredProduct.error) throw restoredProduct.error;

                        const clearedImages = await supabase.from('product_images').delete().eq('product_id', productId);
                        if (clearedImages.error) throw clearedImages.error;
                        if (previousImages.length) {
                            const rows = previousImages.map(image => ({
                                product_id: productId,
                                slot: image.slot,
                                is_main: image.is_main === true,
                                updated_at: image.updated_at
                            }));
                            const restoredImages = await supabase.from('product_images').upsert(rows, { onConflict: 'product_id,slot' });
                            if (restoredImages.error) throw restoredImages.error;
                        }
                    }
                } catch (rollbackError) {
                    rollbackFailures.push(rollbackError);
                }
                if (rollbackFailures.length) {
                    console.error('CRITICAL Product Save Rollback Error:', rollbackFailures);
                }
            }

            // 23505 = unique_violation on products_url_slug_key
            if (error.code === '23505') {
                return res.status(409).json({ error: `The URL slug "${slug}" is already used by another product.` });
            }
            // 23503 = foreign_key_violation — the category was deleted mid-edit.
            if (error.code === '23503') {
                return res.status(400).json({ error: "That category no longer exists. Pick another one." });
            }
            sendProductError(res, error, "Failed to save product or image.");
        }
    });

    router.delete('/api/products/:id', requireAdmin, async (req, res) => {
        if (!isPositiveId(req.params.id)) {
            return res.status(400).json({ error: "Invalid product id." });
        }
        const productId = req.params.id;
        const storageSnapshots = new Map();
        let storageRemoved = false;
        try {
            const { data: current, error: currentError } = await supabase
                .from('products').select('id').eq('id', productId).maybeSingle();
            if (currentError) throw currentError;
            if (!current) return res.status(404).json({ error: "That product no longer exists." });

            // The product_images rows cascade with the product, but Postgres cannot
            // reach into storage — the objects under `<id>/` have to be listed and
            // removed here or they linger in the bucket forever.
            const { data: objects, error: listError } = await supabase
                .storage
                .from(PRODUCT_BUCKET)
                .list(String(productId));
            if (listError) throw listError;

            const paths = (objects || []).map(object => `${productId}/${object.name}`);

            // `<id>-cover` is the pre-004 flat name; removing it too keeps a bucket
            // that predates the grouped layout from accumulating orphans.
            paths.push(`${productId}-cover`);

            for (const path of paths) {
                storageSnapshots.set(path, await readStorageSnapshot(PRODUCT_BUCKET, path));
            }

            const { error: removeError } = await supabase.storage.from(PRODUCT_BUCKET).remove(paths);
            if (removeError) throw removeError;
            storageRemoved = true;

            const { data: deleted, error: dbError } = await supabase
                .from('products')
                .delete()
                .eq('id', productId)
                .select('id')
                .maybeSingle();
            if (dbError) throw dbError;
            if (!deleted) {
                for (const [path, snapshot] of storageSnapshots) {
                    await restoreStorageSnapshot(PRODUCT_BUCKET, path, snapshot);
                }
                storageRemoved = false;
                return res.status(404).json({ error: "That product no longer exists." });
            }

            res.status(200).json({ success: true });
        } catch (error) {
            console.error("Delete Product Error:", error);
            if (storageRemoved) {
                const failures = [];
                for (const [path, snapshot] of storageSnapshots) {
                    try {
                        await restoreStorageSnapshot(PRODUCT_BUCKET, path, snapshot);
                    } catch (rollbackError) {
                        failures.push(rollbackError);
                    }
                }
                if (failures.length) console.error('CRITICAL Product Delete Rollback Error:', failures);
            }
            sendProductError(res, error, "Failed to delete product.");
        }
    });

    return router;
}

module.exports = { adminProductsController };
