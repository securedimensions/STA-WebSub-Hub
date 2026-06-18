/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { createConnection } = require("../queue/connection");
const db = require("../db");
const { normalizeTopicKey, topicFromDb } = require("../topic_key");
const { log } = require("../../settings");

const ACTIVE_KEY = "hub:mqtt:active-topics";
const UNSUB_CLAIM_PREFIX = "hub:mqtt:unsub-claim:";
const UNSUB_CLAIM_TTL_SEC = 86400;

let redis = null;

function getRedis() {
    if (redis === null) {
        redis = createConnection();
    }
    return redis;
}

function key(topic) {
    return normalizeTopicKey(topic);
}

function unsubClaimKey(topic) {
    return UNSUB_CLAIM_PREFIX + key(topic);
}

async function markActive(topic) {
    await getRedis().sadd(ACTIVE_KEY, key(topic));
    await getRedis().del(unsubClaimKey(topic));
}

async function markInactive(topic) {
    await getRedis().srem(ACTIVE_KEY, key(topic));
}

async function isActive(topic) {
    return (await getRedis().sismember(ACTIVE_KEY, key(topic))) === 1;
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

async function syncActiveFromDb() {
    const rows = await db.loadAllSubscriptions();
    const topics = [...new Set(rows.map((row) => key(topicFromDb(row.topic))))];
    const client = getRedis();

    await client.del(ACTIVE_KEY);
    if (topics.length > 0) {
        await client.sadd(ACTIVE_KEY, ...topics);
    }

    log.info(`synced ${topics.length} active MQTT topic(s) from database`);
    return topics;
}

module.exports = {
    markActive,
    markInactive,
    isActive,
    tryClaimUnsubscribe,
    syncActiveFromDb,
};
