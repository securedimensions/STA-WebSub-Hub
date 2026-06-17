/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { createPublisher, createSubscriber } = require("../redis/pubsub");
const subscriptionCache = require("./subscriptions");
const { log } = require("../../settings");

const CHANNEL = "cache:invalidate";

let publisher = null;

function getPublisher() {
    if (publisher === null) {
        publisher = createPublisher();
    }
    return publisher;
}

async function publishRefreshTopic(topic) {
    await getPublisher().publish(CHANNEL, JSON.stringify({ action: "refreshTopic", topic }));
}

async function publishReload() {
    await getPublisher().publish(CHANNEL, JSON.stringify({ action: "reload" }));
}

async function startInvalidationListener() {
    const sub = createSubscriber();
    await sub.subscribe(CHANNEL);

    sub.on("message", async (_channel, message) => {
        try {
            const evt = JSON.parse(message);
            if (!evt || typeof evt.action !== "string") {
                return;
            }
            if (evt.action === "reload") {
                await subscriptionCache.load();
                return;
            }
            if (evt.action === "refreshTopic" && typeof evt.topic === "string") {
                await subscriptionCache.refreshTopic(evt.topic);
            }
        } catch (e) {
            log.error(`invalid cache invalidation message: ${e.message}`);
        }
    });

    return sub;
}

module.exports = { publishRefreshTopic, publishReload, startInvalidationListener };

