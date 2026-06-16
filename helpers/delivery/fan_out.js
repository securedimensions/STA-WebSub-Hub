/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const db = require("../db");
const subscriptionCache = require("../cache/subscriptions");
const { publishUnsubscribe } = require("../mqtt/commands");
const { buildWebSubHeaders } = require("./signature");
const httpClient = require("./http_client");
const { log } = require("../../settings");

async function removeExpiredSubscriptions(topic) {
    const subs = subscriptionCache.getAll(topic);
    const seconds = Math.round(Date.now() / 1000);

    for (const sub of subs) {
        if (typeof sub.duration === "number" && seconds > sub.duration) {
            log.info(`subscription is expired: ${topic} -> ${sub.callback}`);
            await db.deleteSubscription(topic, sub.callback);
            subscriptionCache.remove(topic, sub.callback);
        }
    }
}

async function maybeUnsubscribeTopic(topic) {
    if (subscriptionCache.getActive(topic).length === 0) {
        log.info(`no active subscriptions for topic: ${topic}`);
        await publishUnsubscribe("" + topic);
    }
}

async function deliverToSubscriber({ notificationId, topic, payload, subscription }) {
    if (subscription.status === db.subscription_state.DISABLED) {
        log.warn(`subscription is disabled - not publishing payload to: ${topic} -> ${subscription.callback}`);
        return;
    }

    log.debug(`delivering ${notificationId} to ${subscription.callback}`);
    const headers = buildWebSubHeaders(topic, payload, subscription.secret, notificationId);
    const response = await httpClient.post(subscription.callback, payload, headers);

    log.debug(`publishing status code for ${topic} -> ${subscription.callback}: ${response.status}`);

    if (response.status >= 200 && response.status <= 299) {
        if (subscription.status === db.subscription_state.INACTIVE) {
            log.info(`status changed to ACTIVE for: ${topic} -> ${subscription.callback}`);
            await db.activateSubscription(subscription.callback);
            subscriptionCache.updateStatus(topic, subscription.callback, db.subscription_state.ACTIVE);
        }
        return;
    }

    if (response.status === 410) {
        log.info("subscription gone for topic: " + topic);
        await db.deleteSubscription(topic, subscription.callback);
        subscriptionCache.remove(topic, subscription.callback);
        await maybeUnsubscribeTopic(topic);
        return;
    }

    throw new Error(`delivery failed with status ${response.status}`);
}

async function handleDeliveryError(topic, subscription, reason) {
    log.error(`publishing error for ${topic} -> ${subscription.callback}: ${reason.message}`);

    if ([db.subscription_state.ACTIVE, db.subscription_state.UPDATED].includes(subscription.status)) {
        log.info(`status changed to INACTIVE for: ${topic} -> ${subscription.callback}`);
        await db.deactivateSubscription(subscription.callback);
        subscriptionCache.updateStatus(topic, subscription.callback, db.subscription_state.INACTIVE);
    } else if (subscription.status === db.subscription_state.INACTIVE) {
        log.info(`status changed to DISABLED for: ${topic} -> ${subscription.callback}`);
        await db.disableSubscription(subscription.callback);
        subscriptionCache.updateStatus(topic, subscription.callback, db.subscription_state.DISABLED);
    }
}

async function processNotification(data) {
    const { notificationId, topic, payload } = data;

    await removeExpiredSubscriptions(topic);
    let subs = subscriptionCache.getActive(topic);

    log.debug(`no of subscriptions for ${topic}: ${subs.length}`);

    if (subs.length === 0) {
        await maybeUnsubscribeTopic(topic);
        return;
    }

    const results = await Promise.allSettled(
        subs.map(async (subscription) => {
            try {
                await deliverToSubscriber({ notificationId, topic, payload, subscription });
            } catch (reason) {
                await handleDeliveryError(topic, subscription, reason);
                throw reason;
            }
        })
    );

    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
        throw new Error(`partial delivery: ${failures.length}/${subs.length}`);
    }
}

module.exports = { processNotification };
