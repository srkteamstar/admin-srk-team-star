/*
 * modules/customers/services/customer-write-refusal.service.js
 * ============================================================================
 *
 * The two targets BOTH writes in this module refuse, in one function so the
 * pair cannot drift: the caller's own row, and any row holding the admin role.
 *
 * An administrator who blocks themselves has locked the dashboard with the key
 * inside, and making another administrator inert is not something a route
 * should be able to do when granting the role is a hand edit in the Supabase
 * table editor.
 */
const { supabase } = require('../../../core/database/supabase');
const { roleNameById } = require('../../../core/security/guards');

async function customerWriteRefusal(req, targetId) {
    if (!targetId) {
        return { status: 400, error: "No customer id given." };
    }

    // Compared as strings: req.params is text, the column is a bigint, and
    // `==` across those two is the kind of thing that quietly starts
    // returning false after a schema change.
    if (String(req.profile.id) === String(targetId)) {
        return { status: 400, error: "You cannot block or delete the account you are signed in with." };
    }

    const { data, error } = await supabase
        .from('user_profiles')
        .select('id, full_name, email, role_id, is_blocked')
        .eq('id', targetId)
        .maybeSingle();

    if (error) throw error;
    if (!data) return { status: 404, error: "That customer no longer exists." };

    const role = await roleNameById(data.role_id);
    if (role === 'admin') {
        return {
            status: 403,
            error: "Administrator accounts cannot be blocked or deleted from here. Change the role in Supabase first."
        };
    }

    return { profile: data };
}

module.exports = { customerWriteRefusal };
