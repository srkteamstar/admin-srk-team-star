const crypto = require('crypto');

function credentialFingerprint(passwordHash) {
    if (!passwordHash) return '';
    return crypto.createHmac('sha256', process.env.SESSION_SECRET)
        .update(String(passwordHash))
        .digest('hex');
}

function sessionCredentialMatches(req, profile) {
    const stored = req.session && req.session.credentialFingerprint;
    const current = credentialFingerprint(profile && profile.password_hash);
    if (typeof stored !== 'string' || stored.length !== 64 || current.length !== 64) return false;
    return crypto.timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(current, 'hex'));
}

module.exports = { credentialFingerprint, sessionCredentialMatches };
