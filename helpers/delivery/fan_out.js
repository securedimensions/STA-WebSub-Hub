/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const db = require("../db");
const subscriptionCache = require("../cache/subscriptions");
const { maybeUnsubscribeTopic } = require("../mqtt/lifecycle");
const { buildWebSubHeaders } = require("./signature");
const httpClient = require("./http_client");
const circuit = require("./circuit");
const limiter = require("./limiter");
const metrics = require("../metrics");
const { config, log } = require("../../settings");

async function deliverToSubscriber({ notificationId, topic, payload, subscription }) {
    if (circuit.isOpen(subscription.callback)) {
        metrics.inc("postsSkippedCircuit");
        throw new Error(`circuit open for callback ${subscription.callback}`);
    }

    await limiter.withCallbackLimit(subscription.callback, async () => {
        const headers = buildWebSubHeaders(topic, payload, subscription.secret, notificationId);

        for (let attempt = 1; attempt <= config.delivery.maxAttempts; attempt += 1) {
            try {
                log.debug(
                    `delivering ${notificationId} to ${subscription.callback} (attempt ${attempt})`
                );
                const response = await httpClient.post(subscription.callback, payload, headers);

                if (response.status >= 200 && response.status <= 299) {
                    circuit.recordSuccess(subscription.callback);
                    metrics.inc("postsSucceeded");
                    return;
                }

                if (response.status === 410) {
                    log.info("subscription gone for topic: " + topic);
                    await db.deleteSubscription(topic, subscription.callback);
                    await subscriptionCache.remove(topic, subscription.callback);
                    await maybeUnsubscribeTopic(topic);
                    circuit.recordSuccess(subscription.callback);
                    metrics.inc("postsSucceeded");
                    return;
                }

                // Treat 5xx and 429 as transient; other 4xx are permanent errors.
                const transient = response.status >= 500 || response.status === 429;
                if (!transient) {
                    circuit.recordFailure(subscription.callback);
                    metrics.inc("postsFailed");
                    throw new Error(`delivery failed with status ${response.status}`);
                }

                if (attempt === config.delivery.maxAttempts) {
                    circuit.recordFailure(subscription.callback);
                    metrics.inc("postsFailed");
                    throw new Error(`delivery failed after retries with status ${response.status}`);
                }
            } catch (e) {
                // Network errors / timeouts are transient, retry up to maxAttempts
                if (attempt === config.delivery.maxAttempts) {
                    circuit.recordFailure(subscription.callback);
                    metrics.inc("postsFailed");
                    throw e;
                }
            }

            const delay = config.delivery.backoffBaseMs * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
        }
    });
}

async function processNotification(data) {
    const { notificationId, topic, payload } = data;

    const subs = await subscriptionCache.getActive(topic);

    log.debug(`no of subscriptions for ${topic}: ${subs.length}`);

    if (subs.length === 0) {
        log.debug(`no cached subscriptions for topic="${topic}"; skipping delivery`);
        await maybeUnsubscribeTopic(topic);
        return;
    }

    const results = await Promise.allSettled(
        subs.map(async (subscription) => {
            await deliverToSubscriber({ notificationId, topic, payload, subscription });
        })
    );

    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
        throw new Error(`partial delivery: ${failures.length}/${subs.length}`);
    }
}

module.exports = { processNotification };
