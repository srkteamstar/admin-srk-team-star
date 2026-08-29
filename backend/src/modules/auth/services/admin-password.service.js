/*
 * modules/auth/services/admin-password.service.js
 * ============================================================================
 *
 * Administrator passwords are stored only as one-way scrypt hashes using the
 * shared user_profiles.password_hash column. The format intentionally matches
 * the storefront credential contract: scrypt$salt$hash. New values use hex;
 * verification also accepts base64url for compatibility with older values.
 */
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
// OWASP's memory/CPU-equivalent scrypt option using 16 MiB and five lanes.
// Explicit parameters make the work factor reviewable and portable instead of
// inheriting a runtime default that the stored hash cannot describe.
const SCRYPT_V2 = Object.freeze({ N: 1 << 14, r: 8, p: 5, maxmem: 64 * 1024 * 1024 });
const V2_PREFIX = 'scrypt-v2';

function passwordProblem(password) {
    if (typeof password !== 'string' || !password) return 'Enter your administrator password.';
    if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password.length > MAX_PASSWORD_LENGTH) return `Use no more than ${MAX_PASSWORD_LENGTH} characters.`;
    return null;
}

async function hashAdminPassword(password) {
    const problem = passwordProblem(password);
    if (problem) throw new TypeError(problem);

    const salt = crypto.randomBytes(SALT_BYTES);
    const key = await scrypt(password, salt, KEY_BYTES, SCRYPT_V2);
    return `${V2_PREFIX}$${SCRYPT_V2.N}$${SCRYPT_V2.r}$${SCRYPT_V2.p}$${salt.toString('hex')}$${Buffer.from(key).toString('hex')}`;
}

function decodePart(value, expectedBytes) {
    if (new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`, 'i').test(value)) {
        return Buffer.from(value, 'hex');
    }
    return Buffer.from(value, 'base64url');
}

async function verifyAdminPassword(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;

    const parts = storedHash.split('$');
    const legacy = parts.length === 3 && parts[0] === 'scrypt';
    const versioned = parts.length === 6 && parts[0] === V2_PREFIX;
    if (!legacy && !versioned) return false;

    const saltPart = legacy ? parts[1] : parts[4];
    const hashPart = legacy ? parts[2] : parts[5];
    let options;
    if (versioned) {
        const N = Number(parts[1]);
        const r = Number(parts[2]);
        const p = Number(parts[3]);
        if (N !== SCRYPT_V2.N || r !== SCRYPT_V2.r || p !== SCRYPT_V2.p) return false;
        options = SCRYPT_V2;
    }

    let salt;
    let expected;
    try {
        salt = decodePart(saltPart, SALT_BYTES);
        expected = decodePart(hashPart, KEY_BYTES);
    } catch (error) {
        return false;
    }

    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;

    const actual = Buffer.from(await scrypt(password, salt, KEY_BYTES, options));
    return crypto.timingSafeEqual(actual, expected);
}

const needsPasswordRehash = storedHash => typeof storedHash === 'string' && !storedHash.startsWith(`${V2_PREFIX}$`);

module.exports = {
    MIN_PASSWORD_LENGTH,
    MAX_PASSWORD_LENGTH,
    passwordProblem,
    hashAdminPassword,
    verifyAdminPassword,
    needsPasswordRehash,
    SCRYPT_V2
};
