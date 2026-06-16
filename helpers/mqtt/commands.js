/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { createPublisher, createSubscriber } = require("../redis/pubsub");
const { log } = require("../../settings");

const CHANNEL = "mqtt:commands";

let publisher = null;

function getPublisher() {
    if (publisher === null) {
        publisher = createPublisher();
    }
    return publisher;
}

async function publishSubscribe(topic) {
    await getPublisher().publish(CHANNEL, JSON.stringify({ action: "subscribe", topic }));
}

async function publishUnsubscribe(topic) {
    await getPublisher().publish(CHANNEL, JSON.stringify({ action: "unsubscribe", topic }));
}

async function startMqttCommandListener(onCommand) {
    const sub = createSubscriber();
    await sub.subscribe(CHANNEL);

    sub.on("message", async (_channel, message) => {
        try {
            const cmd = JSON.parse(message);
            if (!cmd || typeof cmd.action !== "string" || typeof cmd.topic !== "string") {
                return;
            }
            await onCommand(cmd);
        } catch (e) {
            log.error(`invalid mqtt command message: ${e.message}`);
        }
    });

    return sub;
}

module.exports = {
    publishSubscribe,
    publishUnsubscribe,
    startMqttCommandListener,
};

