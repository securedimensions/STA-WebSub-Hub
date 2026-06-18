/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const querystring = require("querystring");

/** Canonical in-memory / MQTT topic key (slashes, not %2F). */
function normalizeTopicKey(topic) {
    return querystring.unescape(String(topic).trim());
}

/** Value written to topics.topic — escaped legacy form. */
function escapeTopicForDb(topic) {
    return querystring.escape(normalizeTopicKey(topic));
}

/** DB lookup keys for rows stored escaped or unescaped (legacy). */
function topicDbLookupKeys(topic) {
    const canonical = normalizeTopicKey(topic);
    return [...new Set([escapeTopicForDb(canonical), canonical])];
}

/** Normalize topic read from the database for cache / MQTT use. */
function topicFromDb(rowTopic) {
    return normalizeTopicKey(rowTopic);
}

module.exports = {
    normalizeTopicKey,
    escapeTopicForDb,
    topicDbLookupKeys,
    topicFromDb,
};
