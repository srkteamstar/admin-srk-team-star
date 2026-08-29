/*
 * modules/projects/services/project-visibility.service.js
 * ============================================================================
 *
 * The whole-section switch, stored as one row in site_settings. Read by both
 * controllers, which is why it is a service rather than a private helper in
 * either of them.
 */
const { supabase } = require('../../../core/database/supabase');

const SECTION_VISIBILITY_KEY = 'upcoming_projects_section_visible';

// Missing row is treated as visible so the section never silently disappears
// if the settings row is deleted.
async function isSectionVisible() {
    const { data, error } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', SECTION_VISIBILITY_KEY)
        .maybeSingle();

    if (error) throw error;

    return data ? data.value === true : true;
}

module.exports = { SECTION_VISIBILITY_KEY, isSectionVisible };
