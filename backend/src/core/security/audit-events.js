/*
 * Durable, non-sensitive administrator activity records.
 */
const crypto = require('crypto');
const { supabase } = require('../database/supabase');

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
let auditStoreUnavailable = false;

function stableHash(value) {
    if (!value) return null;
    return crypto
        .createHmac('sha256', process.env.SESSION_SECRET)
        .update(String(value))
        .digest('hex');
}

function outcomeFor(status) {
    if (status >= 200 && status < 400) return 'success';
    if (status >= 400 && status < 500) return 'refused';
    return 'failure';
}

function eventFor(req) {
    if (req.path === '/api/admin/login') return 'admin.login';
    if (req.path === '/api/auth/logout') return 'admin.logout';

    const resource = req.path
        .replace(/^\/api\//, '')
        .split('/')
        .filter(Boolean)[0] || 'api';
    return `admin.${resource}.${req.method.toLowerCase()}`;
}

function safeChangedFields(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
    const blocked = /pass(word)?|secret|token|hash|key|credential|image|file|code/i;
    return Object.keys(body)
        .filter(key => !blocked.test(key))
        .slice(0, 50);
}

async function insertAuditEvent(req, status) {
    if (auditStoreUnavailable) return;
    const identifier = req.path === '/api/admin/login' && req.body
        ? String(req.body.identifier || '').trim().toLowerCase()
        : '';
    const targetType = req.path.replace(/^\/api\//, '').split('/').filter(Boolean)[0] || null;
    const targetId = req.params && req.params.id !== undefined ? String(req.params.id) : null;

    const record = {
        actor_profile_id: req.profile ? req.profile.id : (req.auditActorId || null),
        event_type: eventFor(req),
        target_type: targetType,
        target_id: targetId,
        outcome: outcomeFor(status),
        http_status: status,
        correlation_id: req.correlationId,
        ip_hash: stableHash(req.ip),
        identifier_hash: stableHash(identifier),
        metadata: {
            method: req.method,
            path: req.path,
            changed_fields: safeChangedFields(req.body)
        }
    };

    const { error } = await supabase.from('admin_audit_events').insert(record);
    if (error) throw error;
}

function requestContext(req, res, next) {
    req.correlationId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.correlationId);

    if (!MUTATING.has(req.method) || !req.path.startsWith('/api/')) return next();

    const originalEnd = res.end.bind(res);
    let ending = false;
    res.end = function auditedEnd(chunk, encoding, callback) {
        if (ending) return originalEnd(chunk, encoding, callback);
        ending = true;

        insertAuditEvent(req, res.statusCode)
            .catch(error => {
                if (!auditStoreUnavailable) {
                    auditStoreUnavailable = true;
                    console.warn('Administrator audit storage is unavailable; requests will continue without durable audit events until restart.', {
                        correlation_id: req.correlationId,
                        method: req.method,
                        path: req.path,
                        error: error && error.message ? error.message : String(error)
                    });
                }
            })
            .finally(() => originalEnd(chunk, encoding, callback));
        return res;
    };

    next();
}

module.exports = { requestContext, insertAuditEvent, stableHash };
