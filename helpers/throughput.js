/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { createConnection } = require("./queue/connection");

const WINDOW_MS = parseInt(process.env.HUB_METRICS_THROUGHPUT_WINDOW_MS || "10000", 10);
const WINDOW_SECONDS = Math.max(1, Math.ceil(WINDOW_MS / 1000));
const REDIS_KEY_TTL_SECONDS = WINDOW_SECONDS + 5;

const REDIS_PREFIX = {
    enqueued: "hub:throughput:enqueued",
    delivered: "hub:throughput:delivered",
};

class SlidingWindow {
    constructor() {
        this.events = [];
    }

    record(amount = 1) {
        const now = Date.now();
        for (let i = 0; i < amount; i++) {
            this.events.push(now);
        }
        this.prune(now);
    }

    prune(now = Date.now()) {
        const cutoff = now - WINDOW_MS;
        while (this.events.length > 0 && this.events[0] < cutoff) {
            this.events.shift();
        }
    }

    snapshot() {
        this.prune();
        const count = this.events.length;
        return {
            count,
            perSecond: count / WINDOW_SECONDS,
        };
    }
}

const local = {
    enqueued: new SlidingWindow(),
    delivered: new SlidingWindow(),
};

function recordLocal(kind, amount = 1) {
    local[kind]?.record(amount);
}

function emptySnapshot() {
    return {
        windowSeconds: WINDOW_SECONDS,
        enqueuedPerSecond: 0,
        deliveredPerSecond: 0,
        notificationsPerSecond: 0,
        enqueuedInWindow: 0,
        deliveredInWindow: 0,
    };
}

function withSnapshot(counts) {
    const enqueuedPerSecond = counts.enqueued.perSecond;
    const deliveredPerSecond = counts.delivered.perSecond;
    return {
        windowSeconds: WINDOW_SECONDS,
        enqueuedPerSecond,
        deliveredPerSecond,
        notificationsPerSecond: deliveredPerSecond,
        enqueuedInWindow: counts.enqueued.count,
        deliveredInWindow: counts.delivered.count,
    };
}

async function withRedis(fn) {
    const redis = createConnection();
    redis.on("error", () => {
        // throughput is best-effort; suppress reconnect noise
    });

    try {
        return await fn(redis);
    } catch (_e) {
        return null;
    } finally {
        try {
            redis.disconnect();
        } catch (_e) {
            // ignore
        }
    }
}

async function recordRedis(kind, amount = 1) {
    const prefix = REDIS_PREFIX[kind];
    if (!prefix) {
        return;
    }

    await withRedis(async (redis) => {
        const sec = Math.floor(Date.now() / 1000);
        const key = `${prefix}:${sec}`;
        const multi = redis.multi();
        for (let i = 0; i < amount; i++) {
            multi.incr(key);
        }
        multi.expire(key, REDIS_KEY_TTL_SECONDS);
        await multi.exec();
    });
}

function record(kind, amount = 1) {
    recordLocal(kind, amount);
    recordRedis(kind, amount).catch(() => {
        // throughput is best-effort; do not block hot paths
    });
}

async function readRedisWindow(prefix) {
    const result = await withRedis(async (redis) => {
        const now = Math.floor(Date.now() / 1000);
        const keys = [];
        for (let i = 0; i < WINDOW_SECONDS; i++) {
            keys.push(`${prefix}:${now - i}`);
        }
        const values = await redis.mget(keys);
        const count = values.reduce((sum, value) => sum + parseInt(value || "0", 10), 0);
        return {
            count,
            perSecond: count / WINDOW_SECONDS,
        };
    });

    return result || { count: 0, perSecond: 0 };
}

async function getGlobalSnapshot() {
    const [enqueued, delivered] = await Promise.all([
        readRedisWindow(REDIS_PREFIX.enqueued),
        readRedisWindow(REDIS_PREFIX.delivered),
    ]);

    return withSnapshot({ enqueued, delivered });
}

function getLocalSnapshot() {
    return withSnapshot({
        enqueued: local.enqueued.snapshot(),
        delivered: local.delivered.snapshot(),
    });
}

module.exports = {
    record,
    recordEnqueued: (amount = 1) => record("enqueued", amount),
    recordDelivered: (amount = 1) => record("delivered", amount),
    getGlobalSnapshot,
    getLocalSnapshot,
    emptySnapshot,
};
