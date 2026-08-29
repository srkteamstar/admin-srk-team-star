const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;

function readPositiveInteger(value, fallback) {
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function paginationFor(req, res) {
    const page = readPositiveInteger(req.query.page, 1);
    const requestedLimit = readPositiveInteger(req.query.limit, DEFAULT_PAGE_SIZE);
    if (page === null || requestedLimit === null || requestedLimit > MAX_PAGE_SIZE) {
        res.status(400).json({
            error: `page and limit must be positive integers; limit cannot exceed ${MAX_PAGE_SIZE}.`
        });
        return null;
    }
    const from = (page - 1) * requestedLimit;
    return { page, limit: requestedLimit, from, to: from + requestedLimit - 1 };
}

function setPaginationHeaders(res, pagination, total) {
    const safeTotal = Number.isFinite(Number(total)) ? Number(total) : 0;
    res.setHeader('X-Total-Count', String(safeTotal));
    res.setHeader('X-Page', String(pagination.page));
    res.setHeader('X-Page-Size', String(pagination.limit));
    res.setHeader('X-Total-Pages', String(Math.max(1, Math.ceil(safeTotal / pagination.limit))));
}

module.exports = {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    paginationFor,
    setPaginationHeaders
};
