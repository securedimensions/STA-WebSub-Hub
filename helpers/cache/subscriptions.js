/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const db = require("../db");
const { topicFromDb, normalizeTopicKey } = require("../topic_key");
const { log } = require("../../settings");

const byTopic = new Map();

let onTopicBecameInactive = null;

function setOnTopicBecameInactive(handler) {
    onTopicBecameInactive = handler;
}

function cacheKey(topic) {
    return normalizeTopicKey(topic);
}

// Serialize cache mutations so concurrent delivery jobs and invalidation
// events cannot interleave writes on the same topic entry.
let writeLock = Promise.resolve();

function withWriteLock(fn) {
    const run = writeLock.then(() => fn());
    writeLock = run.catch(() => {});
    return run;
}

function upsertInMemory(topic, row) {
    const subscription = {
        id: row.id,
        topic_id: row.topic_id,
        callback: row.callback,
        secret: row.secret,
        duration: row.duration,
        status: row.status,
    };

    const existing = byTopic.get(topic) || [];
    const index = existing.findIndex((s) => s.callback === subscription.callback);
    if (index === -1) {
        existing.push(subscription);
    } else {
        existing[index] = subscription;
    }
    byTopic.set(topic, [...existing]);
}

async function load() {
    const rows = await db.loadAllSubscriptions();
    await withWriteLock(async () => {
        byTopic.clear();
        for (const row of rows) {
            const topic = topicFromDb(row.topic);
            upsertInMemory(topic, row);
        }
    });
    log.info(`subscription cache loaded (${rows.length} subscriptions)`);
}

async function refreshTopic(topic) {
    const key = cacheKey(topic);
    const subs = await db.getSubscriptions(key);
    await withWriteLock(async () => {
        if (subs.length === 0) {
            byTopic.delete(key);
            return;
        }
        byTopic.set(key, subs);
    });
}

function snapshot(topic) {
    return [...(byTopic.get(cacheKey(topic)) || [])];
}

function getAll(topic) {
    return snapshot(topic);
}

function isActiveSub(sub, seconds) {
    if (sub.status === db.subscription_state.DISABLED) {
        return false;
    }
    if (typeof sub.duration === "number" && seconds > sub.duration) {
        return false;
    }
    return true;
}

async function getActive(topic) {
    const key = cacheKey(topic);
    const subs = snapshot(key);
    const seconds = Math.round(Date.now() / 1000);
    const active = subs.filter((sub) => isActiveSub(sub, seconds));

    if (active.length < subs.length) {
        await withWriteLock(async () => {
            const current = byTopic.get(key);
            if (current === undefined) {
                return;
            }
            const compacted = current.filter((sub) => isActiveSub(sub, seconds));
            if (compacted.length === 0) {
                byTopic.delete(key);
                if (current.length > 0 && onTopicBecameInactive !== null) {
                    onTopicBecameInactive(key).catch((err) => {
                        log.error(`topic inactive handler failed for ${key}: ${err.message}`);
                    });
                }
            } else {
                byTopic.set(key, compacted);
            }
        });
    }

    return active;
}

async function updateStatus(topic, callback, status) {
    const key = cacheKey(topic);
    await withWriteLock(async () => {
        const subs = byTopic.get(key);
        if (subs === undefined) {
            return;
        }
        const sub = subs.find((s) => s.callback === callback);
        if (sub !== undefined) {
            sub.status = status;
        }
        byTopic.set(key, [...subs]);
    });
}

async function remove(topic, callback) {
    const key = cacheKey(topic);
    await withWriteLock(async () => {
        const subs = byTopic.get(key);
        if (subs === undefined) {
            return;
        }
        const filtered = subs.filter((s) => s.callback !== callback);
        if (filtered.length === 0) {
            byTopic.delete(key);
        } else {
            byTopic.set(key, filtered);
        }
    });
}

module.exports = {
    load,
    refreshTopic,
    getAll,
    getActive,
    updateStatus,
    remove,
    setOnTopicBecameInactive,
};
