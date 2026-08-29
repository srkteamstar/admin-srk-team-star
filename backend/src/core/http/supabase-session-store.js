/*
 * core/http/supabase-session-store.js — shared administrator sessions
 * ============================================================================
 *
 * Vercel may serve two consecutive requests from different function
 * instances. An in-memory store therefore turns a successful login into a
 * coin toss: the cookie reaches every instance, but only the instance that
 * created it knows the session behind it.
 *
 * This store keeps the small server-side session record in the shared
 * Supabase database. The browser still receives only express-session's signed
 * identifier. Even that identifier is SHA-256 hashed before storage, so a
 * database read cannot be used as a ready-made administrator cookie.
 */
const crypto = require('crypto');
const session = require('express-session');

const DEFAULT_TTL_MS = 30 * 60 * 1000;

const sessionKey = (sid) => crypto.createHash('sha256').update(String(sid)).digest('hex');

function expiryFor(value, fallbackTtlMs) {
    const cookieExpiry = value && value.cookie && value.cookie.expires;
    if (cookieExpiry) {
        const parsed = new Date(cookieExpiry);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    return new Date(Date.now() + fallbackTtlMs);
}

function storeError(operation, error) {
    if (error instanceof Error) return error;
    const detail = error && (error.message || error.details || error.code);
    return new Error(`Admin session ${operation} failed${detail ? `: ${detail}` : '.'}`);
}

class SupabaseSessionStore extends session.Store {
    constructor(client, options = {}) {
        super();
        this.client = client;
        this.table = options.table || 'admin_sessions';
        this.fallbackTtlMs = options.fallbackTtlMs || DEFAULT_TTL_MS;
    }

    get(sid, callback) {
        this.client
            .from(this.table)
            .select('session_data, expires_at')
            .eq('session_key', sessionKey(sid))
            .maybeSingle()
            .then(async ({ data, error }) => {
                if (error) throw storeError('read', error);
                if (!data) return callback(null, null);

                if (new Date(data.expires_at).getTime() <= Date.now()) {
                    const { error: deleteError } = await this.client
                        .from(this.table)
                        .delete()
                        .eq('session_key', sessionKey(sid));
                    if (deleteError) throw storeError('expiry cleanup', deleteError);
                    return callback(null, null);
                }

                callback(null, data.session_data);
            })
            .catch(error => callback(storeError('read', error)));
    }

    set(sid, value, callback = () => {}) {
        const now = new Date();
        const record = {
            session_key: sessionKey(sid),
            session_data: JSON.parse(JSON.stringify(value)),
            expires_at: expiryFor(value, this.fallbackTtlMs).toISOString(),
            updated_at: now.toISOString()
        };

        this.client
            .from(this.table)
            .upsert(record, { onConflict: 'session_key' })
            .then(({ error }) => callback(error ? storeError('write', error) : null))
            .catch(error => callback(storeError('write', error)));
    }

    destroy(sid, callback = () => {}) {
        this.client
            .from(this.table)
            .delete()
            .eq('session_key', sessionKey(sid))
            .then(({ error }) => callback(error ? storeError('destroy', error) : null))
            .catch(error => callback(storeError('destroy', error)));
    }

    touch(sid, value, callback = () => {}) {
        this.client
            .from(this.table)
            .update({
                expires_at: expiryFor(value, this.fallbackTtlMs).toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('session_key', sessionKey(sid))
            .then(({ error }) => callback(error ? storeError('refresh', error) : null))
            .catch(error => callback(storeError('refresh', error)));
    }
}

module.exports = { SupabaseSessionStore, sessionKey };
