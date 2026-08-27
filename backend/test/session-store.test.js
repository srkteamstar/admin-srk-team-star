const assert = require('assert');
const { SupabaseSessionStore, sessionKey } = require('../src/core/http/supabase-session-store');

const rows = new Map();

function fakeClient() {
    return {
        from() {
            const state = { operation: 'select', key: null, payload: null };
            const query = {
                select() { state.operation = 'select'; return query; },
                upsert(payload) { state.operation = 'upsert'; state.payload = payload; return query; },
                update(payload) { state.operation = 'update'; state.payload = payload; return query; },
                delete() { state.operation = 'delete'; return query; },
                eq(column, value) { if (column === 'session_key') state.key = value; return query; },
                maybeSingle() { return query.then(); },
                then(resolve, reject) {
                    return Promise.resolve().then(() => {
                        if (state.operation === 'select') {
                            return { data: rows.get(state.key) || null, error: null };
                        }
                        if (state.operation === 'upsert') {
                            rows.set(state.payload.session_key, { ...state.payload });
                            return { data: null, error: null };
                        }
                        if (state.operation === 'update') {
                            const current = rows.get(state.key);
                            if (current) rows.set(state.key, { ...current, ...state.payload });
                            return { data: null, error: null };
                        }
                        if (state.operation === 'delete') {
                            rows.delete(state.key);
                            return { data: null, error: null };
                        }
                        return { data: null, error: null };
                    }).then(resolve, reject);
                }
            };
            return query;
        }
    };
}

const call = (store, method, ...args) => new Promise((resolve, reject) => {
    store[method](...args, (error, value) => error ? reject(error) : resolve(value));
});

(async () => {
    const client = fakeClient();
    const instanceA = new SupabaseSessionStore(client);
    const instanceB = new SupabaseSessionStore(client);
    const sid = 'browser-visible-session-id';
    const value = {
        cookie: { expires: new Date(Date.now() + 60_000).toISOString() },
        customerId: 100,
        scope: 'admin'
    };

    await call(instanceA, 'set', sid, value);
    assert(!rows.has(sid), 'raw session identifiers must not be stored');
    assert(rows.has(sessionKey(sid)), 'a hashed session key should be stored');

    const restored = await call(instanceB, 'get', sid);
    assert.strictEqual(restored.customerId, 100);
    assert.strictEqual(restored.scope, 'admin');

    await call(instanceB, 'destroy', sid);
    assert.strictEqual(await call(instanceA, 'get', sid), null);

    console.log('  PASS  shared session survives a different application instance');
    console.log('  PASS  database never stores the browser session identifier');
    console.log('  PASS  logout destroys the shared session');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
