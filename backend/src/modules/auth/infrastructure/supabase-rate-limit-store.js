/*
 * Shared rate-limit state for serverless/multi-process deployments.
 */
class SupabaseRateLimitStore {
    constructor(client, prefix) {
        this.client = client;
        this.prefix = prefix;
        this.windowMs = 60 * 1000;
        this.localKeys = false;
        this.fallbackRows = new Map();
        this.sharedUnavailable = false;
        this.warningLogged = false;
    }

    init(options) {
        this.windowMs = options.windowMs;
    }

    async increment(key) {
        if (!this.sharedUnavailable) {
            try {
                const { data, error } = await this.client.rpc('consume_admin_rate_limit', {
                    p_key: `${this.prefix}${key}`,
                    p_window_ms: this.windowMs
                });
                if (error) throw error;

                const row = Array.isArray(data) ? data[0] : data;
                const totalHits = Number(row && row.total_hits);
                const resetTime = new Date(row && row.reset_time);
                if (!Number.isInteger(totalHits) || totalHits < 1 || Number.isNaN(resetTime.getTime())) {
                    throw new Error('The shared administrator rate-limit store returned an invalid result.');
                }
                return { totalHits, resetTime };
            } catch (error) {
                this.sharedUnavailable = true;
                if (!this.warningLogged) {
                    this.warningLogged = true;
                    console.warn('Shared administrator rate limiting is unavailable; using a process-local fallback until restart.', error && error.message ? error.message : error);
                }
            }
        }

        const fallbackKey = `${this.prefix}${key}`;
        const now = Date.now();
        let row = this.fallbackRows.get(fallbackKey);
        if (!row || row.resetAt <= now) row = { hits: 0, resetAt: now + this.windowMs };
        row.hits += 1;
        this.fallbackRows.set(fallbackKey, row);
        return { totalHits: row.hits, resetTime: new Date(row.resetAt) };
    }

    async decrement() {
        // Neither limiter skips successful nor failed requests, so express-rate-
        // limit never calls this. It remains part of the Store contract.
    }

    async resetKey(key) {
        this.fallbackRows.delete(`${this.prefix}${key}`);
        if (this.sharedUnavailable) return;
        const { error } = await this.client
            .from('admin_rate_limits')
            .delete()
            .eq('rate_key', `${this.prefix}${key}`);
        if (error) throw error;
    }
}

module.exports = { SupabaseRateLimitStore };
