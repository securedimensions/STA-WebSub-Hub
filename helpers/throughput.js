/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { createConnection } = require("./queue/connection");

const WINDOW_MS = parseInt(process.env.HUB_METRICS_THROUGHPUT_WINDOW_MS || "10000", 10);
const WINDOW_SECONDS = Math.max(1, Math.ceil(WINDOW_MS / 1000));
const REDIS_KEY_TTL_SECONDS = WINDOW_SECONDS + 5;
const FLUSH_INTERVAL_MS = parseInt(process.env.HUB_THROUGHPUT_FLUSH_MS || "1000", 10);

const REDIS_PREFIX = {
    enqueued: "hub:throughput:enqueued",
    jobsCompleted: "hub:throughput:jobs-completed",
};

class SlidingWindow {
    constructor() {
        this.count = 0;
        this.windowStartMs = Date.now();
    }

    record(amount = 1) {
        this.rotateIfNeeded();
        this.count += amount;
    }

    rotateIfNeeded(now = Date.now()) {
        if (now - this.windowStartMs >= WINDOW_MS) {
            this.count = 0;
            this.windowStartMs = now;
        }
    }

    snapshot(now = Date.now()) {
        this.rotateIfNeeded(now);
        return {
            count: this.count,
            perSecond: this.count / WINDOW_SECONDS,
        };
    }
}

const local = {
    enqueued: new SlidingWindow(),
    jobsCompleted: new SlidingWindow(),
};

const pendingRedis = new Map();
let redis = null;
let flushTimer = null;
let flushInFlight = null;

function getRedis() {
    if (redis === null) {
        redis = createConnection();
        redis.on("error", () => {
            // throughput is best-effort; suppress reconnect noise
        });
    }
    return redis;
}

function recordLocal(kind, amount = 1) {
    local[kind]?.record(amount);
}

function scheduleFlush() {
    if (flushTimer !== null) {
        return;
    }
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushPending().catch(() => {});
    }, FLUSH_INTERVAL_MS);
}

async function flushPending() {
    if (flushInFlight !== null) {
        return flushInFlight;
    }

    if (pendingRedis.size === 0) {
        return;
    }

    const batch = new Map(pendingRedis);
    pendingRedis.clear();

    flushInFlight = (async () => {
        try {
            const client = getRedis();
            const sec = Math.floor(Date.now() / 1000);
            const multi = client.multi();

            for (const [kind, amount] of batch) {
                const prefix = REDIS_PREFIX[kind];
                if (!prefix || amount <= 0) {
                    continue;
                }
                const key = `${prefix}:${sec}`;
                multi.incrby(key, amount);
                multi.expire(key, REDIS_KEY_TTL_SECONDS);
            }

            await multi.exec();
        } catch (_e) {
            // best-effort
        } finally {
            flushInFlight = null;
        }
    })();

    return flushInFlight;
}

function record(kind, amount = 1) {
    recordLocal(kind, amount);
    pendingRedis.set(kind, (pendingRedis.get(kind) || 0) + amount);
    scheduleFlush();
}

function withSnapshot(counts) {
    const enqueuedPerSecond = counts.enqueued.perSecond;
    const jobsCompletedPerSecond = counts.jobsCompleted.perSecond;

    return {
        windowSeconds: WINDOW_SECONDS,
        enqueuedPerSecond,
        jobsCompletedPerSecond,
        enqueuedInWindow: counts.enqueued.count,
        jobsCompletedInWindow: counts.jobsCompleted.count,
        // Backward-compatible names (notifications = one queue job completed)
        deliveredPerSecond: jobsCompletedPerSecond,
        notificationsPerSecond: jobsCompletedPerSecond,
        deliveredInWindow: counts.jobsCompleted.count,
    };
}

function emptySnapshot() {
    return withSnapshot({
        enqueued: { count: 0, perSecond: 0 },
        jobsCompleted: { count: 0, perSecond: 0 },
    });
}

async function readRedisWindow(prefix) {
    try {
        const client = getRedis();
        const now = Math.floor(Date.now() / 1000);
        const keys = [];
        for (let i = 0; i < WINDOW_SECONDS; i++) {
            keys.push(`${prefix}:${now - i}`);
        }
        const values = await client.mget(keys);
        const count = values.reduce((sum, value) => sum + parseInt(value || "0", 10), 0);
        return {
            count,
            perSecond: count / WINDOW_SECONDS,
        };
    } catch (_e) {
        return { count: 0, perSecond: 0 };
    }
}

async function getGlobalSnapshot() {
    if (flushInFlight !== null) {
        await flushInFlight;
    } else {
        await flushPending();
    }

    const [enqueued, jobsCompleted] = await Promise.all([
        readRedisWindow(REDIS_PREFIX.enqueued),
        readRedisWindow(REDIS_PREFIX.jobsCompleted),
    ]);

    return withSnapshot({ enqueued, jobsCompleted });
}

function getLocalSnapshot() {
    return withSnapshot({
        enqueued: local.enqueued.snapshot(),
        jobsCompleted: local.jobsCompleted.snapshot(),
    });
}

module.exports = {
    record,
    recordEnqueued: (amount = 1) => record("enqueued", amount),
    recordJobCompleted: (amount = 1) => record("jobsCompleted", amount),
    getGlobalSnapshot,
    getLocalSnapshot,
    emptySnapshot,
};
