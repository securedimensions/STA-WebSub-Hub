/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { createConnection } = require("../queue/connection");
const db = require("../db");
const { topicFromDb, mqttTopicKey } = require("../topic_key");
const { log } = require("../../settings");

const ACTIVE_KEY = "hub:mqtt:active-topics";
const ACTIVE_TTL_PREFIX = "hub:mqtt:lease:";
const UNSUB_CLAIM_PREFIX = "hub:mqtt:unsub-claim:";
const UNSUB_CLAIM_TTL_SEC = 86400;
const INDEFINITE_LEASE_TTL_SEC = 365 * 86400;

let redis = null;

function getRedis() {
    if (redis === null) {
        redis = createConnection();
    }
    return redis;
}

function key(topic) {
    return mqttTopicKey(topic);
}

function ttlKey(topic) {
    return ACTIVE_TTL_PREFIX + key(topic);
}

function unsubClaimKey(topic) {
    return UNSUB_CLAIM_PREFIX + key(topic);
}

async function markActive(topic, leaseSeconds) {
    const k = key(topic);
    const ttl =
        leaseSeconds === null || leaseSeconds === undefined
            ? INDEFINITE_LEASE_TTL_SEC
            : Math.max(Math.floor(leaseSeconds), 1);
    const client = getRedis();
    await client.set(ttlKey(topic), "1", "EX", ttl);
    await client.sadd(ACTIVE_KEY, k);
    await client.del(unsubClaimKey(topic));
}

async function markInactive(topic) {
    const k = key(topic);
    const client = getRedis();
    await client.del(ttlKey(topic));
    await client.srem(ACTIVE_KEY, k);
}

async function isActive(topic) {
    return (await getRedis().exists(ttlKey(topic))) === 1;
}

async function listActiveTopics() {
    const topics = await getRedis().smembers(ACTIVE_KEY);
    const active = [];
    for (const topic of topics) {
        if ((await getRedis().exists(ACTIVE_TTL_PREFIX + topic)) === 1) {
            active.push(topic);
        }
    }
    return active;
}

async function tryClaimUnsubscribe(topic) {
    const result = await getRedis().set(
        unsubClaimKey(topic),
        "1",
        "NX",
        "EX",
        UNSUB_CLAIM_TTL_SEC
    );
    return result === "OK";
}

function remainingLeaseSeconds(row, now) {
    if (row.duration === null || row.duration === undefined) {
        return INDEFINITE_LEASE_TTL_SEC;
    }
    return row.duration - now;
}

async function syncActiveFromDb() {
    const now = Math.round(Date.now() / 1000);
    const rows = await db.loadAllSubscriptions();
    const ttlByTopic = new Map();

    for (const row of rows) {
        const mqtt = key(topicFromDb(row.topic));
        const remaining = remainingLeaseSeconds(row, now);
        if (remaining <= 0) {
            continue;
        }
        const prev = ttlByTopic.get(mqtt);
        if (prev === undefined || remaining > prev) {
            ttlByTopic.set(mqtt, remaining);
        }
    }

    const client = getRedis();
    const existing = await client.smembers(ACTIVE_KEY);

    for (const topic of existing) {
        if (!ttlByTopic.has(topic)) {
            await markInactive(topic);
        }
    }

    for (const [topic, ttl] of ttlByTopic) {
        await client.set(ttlKey(topic), "1", "EX", ttl);
        await client.sadd(ACTIVE_KEY, topic);
    }

    log.info(`synced ${ttlByTopic.size} active MQTT topic(s) from database`);
    return [...ttlByTopic.keys()];
}

module.exports = {
    markActive,
    markInactive,
    isActive,
    listActiveTopics,
    tryClaimUnsubscribe,
    syncActiveFromDb,
};
