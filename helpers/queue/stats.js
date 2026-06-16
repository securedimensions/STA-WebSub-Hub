/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { getQueue } = require("./producer");

async function getQueueStats() {
    const queue = getQueue();
    const [waiting, active, failed, delayed, completed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.getCompletedCount(),
    ]);

    return { waiting, active, failed, delayed, completed };
}

module.exports = { getQueueStats };
