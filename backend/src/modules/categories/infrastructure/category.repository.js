/*
 * modules/categories/infrastructure/category.repository.js
 * ============================================================================
 *
 * Reads a category together with its cover image and its LIVE product count.
 *
 * THE COUNT IS NOT THIS MODULE'S TO COMPUTE. product_count used to be a number
 * an administrator typed into the drawer, and it drifted the moment anybody
 * added a product; migration 006 dropped the column. The number now comes from
 * modules/products through its published read port, which is the doctrine's
 * rule for a synchronous cross-module call: a narrow, side-effect-free query
 * interface, never a sibling's internals.
 *
 * The view-then-table fallback is unchanged. categories_with_image knows
 * whether the storage object actually exists; the bare table does not, so that
 * branch guesses <id>-cover the way /api/projects does.
 */
const { supabase } = require('../../../core/database/supabase');
const { countProductsByCategory } = require('../../products/products.public');

const CATEGORY_BUCKET = 'category-images';

async function fetchCategoryRows(pagination) {
    let viewQuery = supabase
            .from('categories_with_image')
            .select('*', { count: 'exact' })
            .order('name', { ascending: true });
    if (pagination) viewQuery = viewQuery.range(pagination.from, pagination.to);
    const [fromView, counts] = await Promise.all([viewQuery, countProductsByCategory()]);

    // Set on the way out in both branches, so `product_count` on the response is
    // always the derived number and never whatever the column happens to hold.
    const withCount = category => ({
        ...category,
        product_count: counts.get(String(category.id)) || 0
    });

    if (!fromView.error) return {
        rows: (fromView.data || []).map(withCount),
        total: fromView.count === null || fromView.count === undefined ? (fromView.data || []).length : fromView.count
    };

    let tableQuery = supabase
        .from('categories')
        .select('*', { count: 'exact' })
        .order('name', { ascending: true });
    if (pagination) tableQuery = tableQuery.range(pagination.from, pagination.to);
    const fromTable = await tableQuery;

    if (fromTable.error) throw fromTable.error;

    const rows = (fromTable.data || []).map(category => withCount({
        ...category,
        image_path: `${category.id}-cover`,
        image_updated_at: category.updated_at
    }));
    return { rows, total: fromTable.count === null || fromTable.count === undefined ? rows.length : fromTable.count };
}

// ?v=<timestamp> so a replaced cover shows up immediately instead of being
// served from the browser cache.
function withImageUrl(category) {
    const baseUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${CATEGORY_BUCKET}/`;
    const version = new Date(category.image_updated_at || category.updated_at || Date.now()).getTime();

    return {
        ...category,
        image_url: category.image_path ? `${baseUrl}${category.image_path}?v=${version}` : null
    };
}

module.exports = { CATEGORY_BUCKET, fetchCategoryRows, withImageUrl };
