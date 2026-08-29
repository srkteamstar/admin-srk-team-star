const assert = require('assert');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'security-controls-test-secret-32-characters';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role';
const {
    hashAdminPassword,
    verifyAdminPassword,
    needsPasswordRehash,
    SCRYPT_V2
} = require('../src/modules/auth/services/admin-password.service');
const { SupabaseRateLimitStore } = require('../src/modules/auth/infrastructure/supabase-rate-limit-store');
const { ADMIN_IDLE_TIMEOUT_MS, ADMIN_ABSOLUTE_TIMEOUT_MS, ADMIN_ROTATION_INTERVAL_MS } = require('../src/core/http/session');
const { credentialFingerprint, sessionCredentialMatches } = require('../src/core/security/session-credentials');
const sharp = require('sharp');
const { normalizeImage, ImageValidationError } = require('../src/core/uploads/image-upload');

function sharedRateLimitClient() {
    const rows = new Map();
    return {
        rows,
        async rpc(name, args) {
            assert.strictEqual(name, 'consume_admin_rate_limit');
            const now = Date.now();
            let row = rows.get(args.p_key);
            if (!row || row.started + args.p_window_ms <= now) row = { hits: 0, started: now };
            row.hits += 1;
            rows.set(args.p_key, row);
            return {
                data: [{ total_hits: row.hits, reset_time: new Date(row.started + args.p_window_ms).toISOString() }],
                error: null
            };
        },
        from() {
            let key;
            const query = {
                delete() { return query; },
                eq(column, value) { key = value; return query; },
                then(resolve, reject) {
                    rows.delete(key);
                    return Promise.resolve({ error: null }).then(resolve, reject);
                }
            };
            return query;
        }
    };
}

(async () => {
    const password = 'A Correct Administrator Passphrase';
    const encoded = await hashAdminPassword(password);
    assert(encoded.startsWith(`scrypt-v2$${SCRYPT_V2.N}$${SCRYPT_V2.r}$${SCRYPT_V2.p}$`));
    assert.strictEqual(await verifyAdminPassword(password, encoded), true);
    assert.strictEqual(await verifyAdminPassword('wrong password value', encoded), false);
    assert.strictEqual(needsPasswordRehash(encoded), false);
    assert.strictEqual(needsPasswordRehash('scrypt$salt$hash'), true);

    const client = sharedRateLimitClient();
    const instanceA = new SupabaseRateLimitStore(client, 'test:');
    const instanceB = new SupabaseRateLimitStore(client, 'test:');
    instanceA.init({ windowMs: 60_000 });
    instanceB.init({ windowMs: 60_000 });
    assert.strictEqual((await instanceA.increment('actor')).totalHits, 1);
    assert.strictEqual((await instanceB.increment('actor')).totalHits, 2);
    await instanceB.resetKey('actor');
    assert.strictEqual((await instanceA.increment('actor')).totalHits, 1);

    const unavailable = new SupabaseRateLimitStore({
        async rpc() { return { data: null, error: { message: 'function is not installed' } }; },
        from() { throw new Error('fallback test should not touch the database'); }
    }, 'fallback:');
    unavailable.init({ windowMs: 60_000 });
    assert.strictEqual((await unavailable.increment('actor')).totalHits, 1);
    assert.strictEqual((await unavailable.increment('actor')).totalHits, 2);

    assert.strictEqual(ADMIN_IDLE_TIMEOUT_MS, 30 * 60 * 1000);
    assert.strictEqual(ADMIN_ABSOLUTE_TIMEOUT_MS, 8 * 60 * 60 * 1000);
    assert.strictEqual(ADMIN_ROTATION_INTERVAL_MS, 15 * 60 * 1000);
    const passwordHash = 'scrypt-v2$example';
    const fingerprint = credentialFingerprint(passwordHash);
    assert.strictEqual(sessionCredentialMatches(
        { session: { credentialFingerprint: fingerprint } },
        { password_hash: passwordHash }
    ), true);
    assert.strictEqual(sessionCredentialMatches(
        { session: { credentialFingerprint: fingerprint } },
        { password_hash: passwordHash + '-changed' }
    ), false);

    const sourceImage = await sharp({
        create: { width: 12, height: 8, channels: 4, background: '#d4af37' }
    }).webp().withMetadata({ comment: 'must not survive' }).toBuffer();
    const normalized = await normalizeImage({ buffer: sourceImage, mimetype: 'image/webp', size: sourceImage.length });
    const normalizedMetadata = await sharp(normalized.buffer).metadata();
    assert.strictEqual(normalizedMetadata.format, 'webp');
    assert.strictEqual(normalizedMetadata.width, 12);
    assert.strictEqual(normalizedMetadata.height, 8);
    assert.strictEqual(normalizedMetadata.exif, undefined);
    await assert.rejects(
        normalizeImage({ buffer: Buffer.from('RIFFxxxxWEBPnot-an-image'), mimetype: 'image/webp' }),
        ImageValidationError
    );

    console.log('  PASS  new administrator hashes encode and verify explicit scrypt parameters');
    console.log('  PASS  shared rate-limit state survives different application instances');
    console.log('  PASS  administrator sessions define idle and absolute lifetimes');
    console.log('  PASS  password changes invalidate existing administrator sessions');
    console.log('  PASS  uploaded images are decoded, stripped and re-encoded');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
