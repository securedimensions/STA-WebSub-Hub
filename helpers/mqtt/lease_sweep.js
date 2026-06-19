/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const topicActivity = require("./topic_activity");
const { maybeUnsubscribeTopic } = require("./lifecycle");
const { log } = require("../../settings");

let sweepInFlight = null;

/**
 * Topics whose Redis lease TTL has expired but may still be MQTT-subscribed.
 */
async function listTopicsWithExpiredLease(stillSubscribedTopics = []) {
    const staleFromRedis = await topicActivity.listStaleActiveTopics();
    const candidates = new Set(staleFromRedis);

    for (const topic of stillSubscribedTopics) {
        candidates.add(topic);
    }

    const expired = [];
    for (const topic of candidates) {
        if (!(await topicActivity.isActive(topic))) {
            expired.push(topic);
        }
    }
    return expired;
}

async function sweepExpiredLeases(stillSubscribedTopics = []) {
    if (sweepInFlight !== null) {
        return sweepInFlight;
    }

    sweepInFlight = (async () => {
        try {
            const topics = await listTopicsWithExpiredLease(stillSubscribedTopics);
            for (const topic of topics) {
                await maybeUnsubscribeTopic(topic);
            }
            if (topics.length > 0) {
                log.info(`lease sweep: MQTT unsubscribe for ${topics.length} expired topic(s)`);
            }
        } catch (e) {
            log.error(`lease sweep failed: ${e.message}`);
        } finally {
            sweepInFlight = null;
        }
    })();

    return sweepInFlight;
}

function startLeaseSweep({ intervalMs, getStillSubscribedTopics }) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        return null;
    }

    const run = () => {
        const subscribed = getStillSubscribedTopics();
        sweepExpiredLeases(subscribed).catch(() => {});
    };

    run();
    return setInterval(run, intervalMs);
}

module.exports = {
    listTopicsWithExpiredLease,
    sweepExpiredLeases,
    startLeaseSweep,
};
