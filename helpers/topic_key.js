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
 * Hub-relative topic from a full hub.topic URL (path after STA_ROOT_URL + query).
 */
function hubRelativeTopicFromUrl(fullTopicUrl) {
    const topicUrl = typeof fullTopicUrl === "string" ? new URL(fullTopicUrl) : fullTopicUrl;
    const prefix = staPathPrefix();
    let path = topicUrl.pathname.replace(/^\/+/, "");

    if (prefix !== "") {
        const prefixed = `${prefix}/`;
        if (path === prefix) {
            path = "";
        } else if (path.startsWith(prefixed)) {
            path = path.slice(prefixed.length);
        }
    }

    path = path.replace(/^\/+/, "");
    return path + (topicUrl.search || "");
}

/**
 * Map a hub-relative topic (from hub.topic URL parsing) to the MQTT topic
 * string the STA broker publishes (e.g. v1.1/Observations). The HTTP path
 * segment of STA_ROOT_URL (e.g. staplustest) is never part of the MQTT topic.
 */
function mqttTopicKey(topic) {
    return hubRelativeTopicKey(topic);
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
    hubRelativeTopicFromUrl,
    mqttTopicKey,
    hubRelativeTopicKey,
    escapeTopicForDb,
    topicDbLookupKeys,
    topicFromDb,
};
