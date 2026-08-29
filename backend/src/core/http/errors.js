/*
 * core/http/errors.js — one safe error response in every deployment
 * ============================================================================
 *
 * Body parsers and async Express handlers can fail before a controller has a
 * chance to answer. Keeping this in the shared composition root makes local
 * Node, tests and Vercel return the same JSON without exposing a stack or a
 * filesystem path.
 */

function finalErrorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    const status = Number.isInteger(error && error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;

    const correlationId = req.correlationId || null;
    console.error('Unhandled request error', {
        correlation_id: correlationId,
        method: req.method,
        path: req.path,
        status,
        error: error && error.message ? error.message : String(error)
    });

    if (status === 400) {
        return res.status(400).json({
            error: 'The request body is not valid.',
            ...(correlationId ? { correlation_id: correlationId } : {})
        });
    }

    return res.status(status).json({
        error: 'Internal server error.',
        ...(correlationId ? { correlation_id: correlationId } : {})
    });
}

module.exports = { finalErrorHandler };
