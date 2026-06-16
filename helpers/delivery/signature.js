/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const crypto = require("crypto");
const { config } = require("../../settings");

function buildWebSubHeaders(topic, payload, secret, notificationId) {
    const topic_url = config.sta.root_url + topic;
    const headers = {
        "Content-Type": "application/json",
        Link: [config.hub.url + ';rel="hub"', topic_url + ';rel="self"'],
        "X-Hub-Notification-Id": notificationId,
    };

    if (secret !== null) {
        const hmac = crypto
            .createHmac(config.hub.sha_algorithm, secret)
            .update(payload)
            .digest("hex");
        headers["X-Hub-Signature"] = config.hub.sha_algorithm + "=" + hmac;
    }

    return headers;
}

module.exports = { buildWebSubHeaders };
