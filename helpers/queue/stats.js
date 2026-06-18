/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { getQueue } = require("./producer");
const { config } = require("../../settings");

async function getQueueStats() {
    const queue = getQueue();
    const [waiting, active, failed, delayed, completedRetained] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.getCompletedCount(),
    ]);

    return {
        waiting,
        active,
        failed,
        delayed,
        // BullMQ retains only the newest N completed jobs in Redis (not a lifetime total).
        completedRetained,
        completedRetentionMax: config.queue.removeOnCompleteCount,
    };
}

module.exports = { getQueueStats };
