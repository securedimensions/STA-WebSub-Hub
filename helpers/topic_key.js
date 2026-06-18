/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const querystring = require("querystring");
const { config } = require("../settings");

/** Canonical in-memory / MQTT topic key (slashes, not %2F). */
function normalizeTopicKey(topic) {
    return querystring.unescape(String(topic).trim());
}

function staPathPrefix() {
    const root = new URL(config.sta.root_url);
    return root.pathname.replace(/^\/+|\/+$/g, "");
}

/**
 * Map a hub-relative topic (from hub.topic URL parsing) to the MQTT topic
 * string the STA broker publishes (e.g. Observations → v1.1/Observations).
 */
function mqttTopicKey(topic) {
    const canonical = normalizeTopicKey(topic).replace(/^\/+/, "");
    const prefix = staPathPrefix();
    if (prefix === "") {
        return canonical;
    }
    if (canonical === prefix || canonical.startsWith(`${prefix}/`)) {
        return canonical;
    }
    return `${prefix}/${canonical}`;
}

/** Strip the STA root path prefix from an MQTT topic when present. */
function hubRelativeTopicKey(topic) {
    const canonical = normalizeTopicKey(topic).replace(/^\/+/, "");
    const prefix = staPathPrefix();
    if (prefix === "") {
        return canonical;
    }
    const prefixed = `${prefix}/`;
    if (canonical.startsWith(prefixed)) {
        const relative = canonical.slice(prefixed.length);
        return relative === "" ? canonical : relative;
    }
    return canonical;
}

/** Value written to topics.topic — escaped legacy form. */
function escapeTopicForDb(topic) {
    return querystring.escape(normalizeTopicKey(topic));
}

/** DB lookup keys for rows stored escaped or unescaped (legacy). */
function topicDbLookupKeys(topic) {
    const canonical = normalizeTopicKey(topic).replace(/^\/+/, "");
    const hub = hubRelativeTopicKey(canonical);
    const mqtt = mqttTopicKey(canonical);
    const keys = new Set();
    for (const value of [canonical, hub, mqtt]) {
        keys.add(value);
        keys.add(escapeTopicForDb(value));
    }
    return [...keys];
}

/** Normalize topic read from the database for cache / MQTT use. */
function topicFromDb(rowTopic) {
    return mqttTopicKey(normalizeTopicKey(rowTopic));
}

module.exports = {
    normalizeTopicKey,
    mqttTopicKey,
    hubRelativeTopicKey,
    escapeTopicForDb,
    topicDbLookupKeys,
    topicFromDb,
};
