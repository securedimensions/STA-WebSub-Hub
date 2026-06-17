/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const querystring = require("querystring");
const db = require("../db");
const { log } = require("../../settings");

const byTopic = new Map();

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
            const topic = querystring.unescape(row.topic);
            upsertInMemory(topic, row);
        }
    });
    log.info(`subscription cache loaded (${rows.length} subscriptions)`);
}

async function refreshTopic(topic) {
    const subs = await db.getSubscriptions(topic);
    await withWriteLock(async () => {
        if (subs.length === 0) {
            byTopic.delete(topic);
            return;
        }
        byTopic.set(topic, subs);
    });
}

function snapshot(topic) {
    return [...(byTopic.get(topic) || [])];
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
    const subs = snapshot(topic);
    const seconds = Math.round(Date.now() / 1000);
    const active = subs.filter((sub) => isActiveSub(sub, seconds));

    if (active.length < subs.length) {
        await withWriteLock(async () => {
            const current = byTopic.get(topic);
            if (current === undefined) {
                return;
            }
            const compacted = current.filter((sub) => isActiveSub(sub, seconds));
            if (compacted.length === 0) {
                byTopic.delete(topic);
            } else {
                byTopic.set(topic, compacted);
            }
        });
    }

    return active;
}

async function updateStatus(topic, callback, status) {
    await withWriteLock(async () => {
        const subs = byTopic.get(topic);
        if (subs === undefined) {
            return;
        }
        const sub = subs.find((s) => s.callback === callback);
        if (sub !== undefined) {
            sub.status = status;
        }
        byTopic.set(topic, [...subs]);
    });
}

async function remove(topic, callback) {
    await withWriteLock(async () => {
        const subs = byTopic.get(topic);
        if (subs === undefined) {
            return;
        }
        const filtered = subs.filter((s) => s.callback !== callback);
        if (filtered.length === 0) {
            byTopic.delete(topic);
        } else {
            byTopic.set(topic, filtered);
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
};
