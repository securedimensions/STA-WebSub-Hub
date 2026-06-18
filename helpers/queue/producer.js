/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const crypto = require("crypto");
const { Queue } = require("bullmq");
const { createConnection } = require("./connection");
const metrics = require("../metrics");
const throughput = require("../throughput");
const { config, log } = require("../../settings");

let queue = null;

function getQueue() {
    if (queue === null) {
        queue = new Queue(config.queue.name, { connection: createConnection() });
    }
    return queue;
}

async function enqueueNotification(topic, payload) {
    const notificationQueue = getQueue();
    const waiting = await notificationQueue.getWaitingCount();

    if (waiting >= config.queue.maxWaiting) {
        log.error(`queue waiting limit exceeded: ${waiting}`);
        metrics.inc("enqueueRejected");
        throw new Error("queue full");
    }

    await notificationQueue.add(
        "deliver",
        {
            notificationId: crypto.randomUUID(),
            topic,
            payload,
            receivedAt: Date.now(),
        },
        {
            attempts: config.delivery.jobMaxAttempts,
            removeOnComplete: { count: config.queue.removeOnCompleteCount },
            removeOnFail: false,
        }
    );

    metrics.inc("enqueued");
    throughput.recordEnqueued();
}

module.exports = { enqueueNotification, getQueue };
