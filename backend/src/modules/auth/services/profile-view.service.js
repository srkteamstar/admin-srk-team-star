/*
 * modules/auth/services/profile-view.service.js - entity to response DTO
 * ============================================================================
 *
 * THE DTO BOUNDARY, and the one place in this application where the doctrine's
 * "never return an entity from a controller" rule is doing visible work.
 *
 * A user_profiles row carries internal fields such as role_id, is_blocked and
 * blocked_at. publicProfile() is what stops those reaching a browser: every
 * storefront route that answers with an
 * account answers with THIS shape, so there is one place to check rather than
 * five. adminIdentity() is its counterpart for the dashboard and is equally
 * narrow - a name, an email and the role.
 */
const { roleNameById } = require('../../../core/security/guards');
const { addressForUser } = require('../infrastructure/profile.repository');

async function publicProfile(profile) {
    if (!profile) return null;

    const [address, role] = await Promise.all([
        addressForUser(profile.id),
        roleNameById(profile.role_id)
    ]);

    return {
        id: profile.id,
        email: profile.email || '',
        name: profile.full_name || '',
        phone: profile.phone_number || '',
        company: profile.company || '',
        created_at: profile.created_at,
        role: role,
        address_line: address ? address.full_address || '' : '',
        city: address ? address.city || '' : '',
        state: address ? address.state || '' : '',
        postal_code: address ? address.zip_code || '' : '',
        country: address ? address.country || '' : ''
    };
}

// What the dashboard is told about the person holding an admin session, and
// deliberately far less than publicProfile() returns.
//
// publicProfile() flattens in the shipping address and does a second query to
// fetch it, because a customer's saved address is part of what the account
// overlay renders. An admin row has no address, no order history and no
// storefront identity at all — the dashboard shows a name in a dropdown and
// nothing else — so this is a name, an email and the role, synchronously, off
// the row already in hand.
//
// It is also the boundary: whatever gets added to publicProfile later does not
// silently start being published to this surface too.
function adminIdentity(profile) {
    if (!profile) return null;

    return {
        id: profile.id,
        name: profile.full_name || '',
        email: profile.email || '',
        role: 'admin'
    };
}


// Both identifiers reach the same account, so sign-in accepts either without

module.exports = { publicProfile, adminIdentity };
