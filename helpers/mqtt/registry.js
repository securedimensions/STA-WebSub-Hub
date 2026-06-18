/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { log } = require("../../settings");
const { mqttTopicKey } = require("../topic_key");

/** topic key -> { source, qos, subscribedAt } */
const subscribed = new Map();

function recordSubscribe(topic, { source, err, granted }) {
    const key = mqttTopicKey(topic);
    if (err) {
        log.error(`MQTT subscribe failed (${source}): topic="${key}": ${err.message}`);
        return false;
    }

    const entry = Array.isArray(granted) ? granted[0] : granted;
    if (entry?.qos === 128) {
        log.error(`MQTT subscribe rejected by broker (${source}): topic="${key}"`);
        subscribed.delete(key);
        return false;
    }

    subscribed.set(key, {
        source,
        qos: entry?.qos,
        subscribedAt: new Date().toISOString(),
    });
    log.info(`MQTT subscribe ok (${source}): topic="${key}" qos=${entry?.qos ?? "?"}`);
    return true;
}

function recordUnsubscribe(topic, { source, err }) {
    const key = mqttTopicKey(topic);
    if (err) {
        log.error(`MQTT unsubscribe failed (${source}): topic="${key}": ${err.message}`);
        return false;
    }

    subscribed.delete(key);
    log.info(`MQTT unsubscribe ok (${source}): topic="${key}"`);
    return true;
}

function isSubscribed(topic) {
    return subscribed.has(mqttTopicKey(topic));
}

function snapshot() {
    const topics = [...subscribed.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([topic, meta]) => ({ topic, ...meta }));

    return {
        count: topics.length,
        topics,
    };
}

module.exports = {
    recordSubscribe,
    recordUnsubscribe,
    isSubscribed,
    snapshot,
};
