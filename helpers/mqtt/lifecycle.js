/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const db = require("../db");
const subscriptionCache = require("../cache/subscriptions");
const topicActivity = require("./topic_activity");
const { mqttTopicKey } = require("../topic_key");
const { publishUnsubscribe } = require("./commands");
const { log } = require("../../settings");

async function maybeUnsubscribeTopic(topic) {
    const mqttTopic = mqttTopicKey(topic);

    if ((await subscriptionCache.getActive(mqttTopic)).length > 0) {
        return;
    }

    const dbSubs = await db.getSubscriptions(mqttTopic);
    if (dbSubs.length > 0) {
        log.debug(
            `cache empty but database has active subscription(s) for topic="${mqttTopic}"; refreshing cache`
        );
        await subscriptionCache.refreshTopic(mqttTopic);
        await topicActivity.markActive(mqttTopic);
        return;
    }

    if (!(await topicActivity.tryClaimUnsubscribe(mqttTopic))) {
        log.debug(`MQTT unsubscribe already claimed for topic="${mqttTopic}"; skipping`);
        return;
    }

    await topicActivity.markInactive(mqttTopic);
    log.info(`no active subscriptions for topic: ${mqttTopic}`);
    await publishUnsubscribe(mqttTopic);
}

module.exports = { maybeUnsubscribeTopic };
