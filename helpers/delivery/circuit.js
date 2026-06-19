/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const IORedis = require("ioredis");
const { config, log } = require("../../settings");

// Redis-backed circuit breaker shared across all delivery processes.
// Keys:
//   circuit:failures:<encoded-callback>  — sorted set of failure timestamps (score = ms)
//   circuit:open:<encoded-callback>      — string "1", expires after openDurationMs

const redis = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

redis.on("error", (err) => log.error(`circuit breaker redis error: ${err.message}`));

function encodeKey(callback) {
    return encodeURIComponent(callback);
}

function failuresKey(callback) {
    return `circuit:failures:${encodeKey(callback)}`;
}

function openKey(callback) {
    return `circuit:open:${encodeKey(callback)}`;
}

async function isOpen(callback) {
    try {
        const val = await redis.get(openKey(callback));
        return val !== null;
    } catch (err) {
        log.error(`circuit.isOpen error for ${callback}: ${err.message}`);
        return false; // fail open — prefer delivery over silent drops
    }
}

async function recordSuccess(callback) {
    try {
        const fk = failuresKey(callback);
        const ok = openKey(callback);
        await redis.del(fk, ok);
    } catch (err) {
        log.error(`circuit.recordSuccess error for ${callback}: ${err.message}`);
    }
}

async function recordFailure(callback) {
    try {
        const fk = failuresKey(callback);
        const ok = openKey(callback);
        const now = Date.now();
        const windowMs = config.circuit.windowMs;
        const cutoff = now - windowMs;

        const pipe = redis.pipeline();
        // Add this failure timestamp
        pipe.zadd(fk, now, `${now}-${Math.random()}`);
        // Remove failures outside the window
        pipe.zremrangebyscore(fk, "-inf", cutoff);
        // Count remaining failures in window
        pipe.zcard(fk);
        // Keep the sorted set alive for the window duration
        pipe.pexpire(fk, windowMs);

        const results = await pipe.exec();
        const failureCount = results[2][1]; // zcard result

        if (failureCount >= config.circuit.failureThreshold) {
            await redis.pipeline()
                .set(ok, "1", "PX", config.circuit.openDurationMs)
                .del(fk)
                .exec();
            log.warn(`circuit opened for ${callback} (${failureCount} failures in window)`);
        }
    } catch (err) {
        log.error(`circuit.recordFailure error for ${callback}: ${err.message}`);
    }
}

async function getOpenCircuits() {
    try {
        const now = Date.now();
        const keys = await redis.keys("circuit:open:*");
        if (keys.length === 0) return [];

        const pipe = redis.pipeline();
        keys.forEach((k) => pipe.pttl(k));
        const ttls = await pipe.exec();

        return keys.map((k, i) => {
            const openForMs = ttls[i][1]; // pttl result
            const callback = decodeURIComponent(k.replace("circuit:open:", ""));
            return {
                callback,
                openUntilMs: now + openForMs,
                openForMs,
            };
        }).filter((c) => c.openForMs > 0);
    } catch (err) {
        log.error(`circuit.getOpenCircuits error: ${err.message}`);
        return [];
    }
}

module.exports = { isOpen, recordSuccess, recordFailure, getOpenCircuits };
