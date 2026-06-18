/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { createConnection } = require("./queue/connection");
const { log } = require("../settings");

const MAX_EVENTS = parseInt(process.env.HUB_SUBSCRIPTION_EVENTS_MAX || "50", 10);
const REDIS_KEY = "hub:ops:subscription-events";

const pending = new Map();
const localRecent = [];

let redis = null;

function getRedis() {
    if (redis === null) {
        redis = createConnection();
    }
    return redis;
}

function pendingKey(mqttTopic, callback) {
    return `${mqttTopic}\0${callback}`;
}

function trimLocal() {
    while (localRecent.length > MAX_EVENTS) {
        localRecent.shift();
    }
}

async function pushEvent(event) {
    trimLocal();
    localRecent.push(event);

    try {
        const client = getRedis();
        await client.lpush(REDIS_KEY, JSON.stringify(event));
        await client.ltrim(REDIS_KEY, 0, MAX_EVENTS - 1);
    } catch (e) {
        log.debug(`subscription event redis push failed: ${e.message}`);
    }
}

function beginSubscribe({ topic, mqttTopic, callback, leaseSeconds }) {
    const acceptedAtMs = Date.now();
    const ctx = {
        topic,
        mqttTopic,
        callback,
        leaseSeconds,
        acceptedAtMs,
    };
    pending.set(pendingKey(mqttTopic, callback), ctx);
    return ctx;
}

async function recordAccepted(ctx) {
    await pushEvent({
        type: "subscribe_accepted",
        at: new Date(ctx.acceptedAtMs).toISOString(),
        topic: ctx.topic,
        mqttTopic: ctx.mqttTopic,
        callback: ctx.callback,
        leaseSeconds: ctx.leaseSeconds,
    });
}

async function recordActivated(ctx, { publisherMs, intentMs }) {
    const activatedAtMs = Date.now();
    const activationDelayMs = activatedAtMs - ctx.acceptedAtMs;
    pending.delete(pendingKey(ctx.mqttTopic, ctx.callback));

    const event = {
        type: "subscribe_activated",
        at: new Date(activatedAtMs).toISOString(),
        topic: ctx.topic,
        mqttTopic: ctx.mqttTopic,
        callback: ctx.callback,
        leaseSeconds: ctx.leaseSeconds,
        acceptedAt: new Date(ctx.acceptedAtMs).toISOString(),
        activationDelayMs,
        publisherValidationMs: publisherMs,
        intentValidationMs: intentMs,
    };

    log.info(
        `subscription activated: mqttTopic="${ctx.mqttTopic}" callback="${ctx.callback}" ` +
            `lease=${ctx.leaseSeconds}s activationDelayMs=${activationDelayMs} ` +
            `publisherMs=${publisherMs} intentMs=${intentMs}`
    );

    await pushEvent(event);
    return event;
}

async function recordFailed(ctx, { phase, reason }) {
    pending.delete(pendingKey(ctx.mqttTopic, ctx.callback));
    await pushEvent({
        type: "subscribe_failed",
        at: new Date().toISOString(),
        topic: ctx.topic,
        mqttTopic: ctx.mqttTopic,
        callback: ctx.callback,
        leaseSeconds: ctx.leaseSeconds,
        acceptedAt: new Date(ctx.acceptedAtMs).toISOString(),
        failedAfterMs: Date.now() - ctx.acceptedAtMs,
        phase,
        reason,
    });
}

async function getRecent(limit = MAX_EVENTS) {
    const cap = Math.min(Math.max(limit, 1), MAX_EVENTS);

    try {
        const client = getRedis();
        const raw = await client.lrange(REDIS_KEY, 0, cap - 1);
        if (raw.length > 0) {
            return raw.map((line) => JSON.parse(line));
        }
    } catch (e) {
        log.debug(`subscription event redis read failed: ${e.message}`);
    }

    return [...localRecent].slice(-cap).reverse();
}

function getPendingCount() {
    return pending.size;
}

module.exports = {
    beginSubscribe,
    recordAccepted,
    recordActivated,
    recordFailed,
    getRecent,
    getPendingCount,
};
