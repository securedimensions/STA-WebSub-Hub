/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const db = require("../db");
const subscriptionCache = require("../cache/subscriptions");
const topicActivity = require("./topic_activity");
const { publishUnsubscribe } = require("./commands");
const { log } = require("../../settings");

async function maybeUnsubscribeTopic(topic) {
    if ((await subscriptionCache.getActive(topic)).length > 0) {
        return;
    }

    const dbSubs = await db.getSubscriptions(topic);
    if (dbSubs.length > 0) {
        log.debug(
            `cache empty but database has active subscription(s) for topic="${topic}"; refreshing cache`
        );
        await subscriptionCache.refreshTopic(topic);
        await topicActivity.markActive(topic);
        return;
    }

    if (!(await topicActivity.tryClaimUnsubscribe(topic))) {
        log.debug(`MQTT unsubscribe already claimed for topic="${topic}"; skipping`);
        return;
    }

    await topicActivity.markInactive(topic);
    log.info(`no active subscriptions for topic: ${topic}`);
    await publishUnsubscribe("" + topic);
}

module.exports = { maybeUnsubscribeTopic };
