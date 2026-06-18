/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { Job } = require("bullmq");
const { getQueue } = require("./producer");

function serializeJob(job) {
    return {
        id: job.id,
        name: job.name,
        topic: job.data?.topic,
        notificationId: job.data?.notificationId,
        receivedAt: job.data?.receivedAt,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        finishedOn: job.finishedOn,
    };
}

async function listFailedJobs({ start = 0, limit = 20 } = {}) {
    const queue = getQueue();
    const end = start + Math.max(0, limit - 1);
    const jobs = await queue.getFailed(start, end);
    return jobs.map(serializeJob);
}

async function retryFailedJob(jobId) {
    const queue = getQueue();
    const job = await Job.fromId(queue, jobId);
    if (!job) {
        throw new Error(`failed job not found: ${jobId}`);
    }
    await job.retry();
    return serializeJob(job);
}

async function retryAllFailedJobs({ limit = Infinity, batchSize = 100 } = {}) {
    const queue = getQueue();
    let retried = 0;

    while (retried < limit) {
        const batchLimit = Math.min(batchSize, limit - retried);
        const jobs = await queue.getFailed(0, Math.max(0, batchLimit - 1));
        if (jobs.length === 0) {
            break;
        }

        for (const job of jobs) {
            await job.retry();
            retried += 1;
            if (retried >= limit) {
                break;
            }
        }
    }

    const remaining = await queue.getFailedCount();
    return { retried, remaining };
}

async function purgeFailedJobs({ limit = Infinity, batchSize = 1000 } = {}) {
    const queue = getQueue();
    let purged = 0;

    while (purged < limit) {
        const chunk = Math.min(batchSize, limit - purged);
        const removed = await queue.clean(0, chunk, "failed");
        if (removed.length === 0) {
            break;
        }
        purged += removed.length;
    }

    const remaining = await queue.getFailedCount();
    return { purged, remaining };
}

module.exports = {
    listFailedJobs,
    retryFailedJob,
    retryAllFailedJobs,
    purgeFailedJobs,
    serializeJob,
};
