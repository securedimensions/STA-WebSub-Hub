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

module.exports = { listFailedJobs, retryFailedJob, serializeJob };
