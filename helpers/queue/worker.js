/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { Worker } = require("bullmq");
const { createConnection } = require("./connection");
const { config, log } = require("../../settings");
const { processNotification } = require("../delivery/fan_out");

let worker = null;
let statsTimer = null;
let completed = 0;
let failed = 0;

function startWorkerStatsLogger() {
    const intervalMs = parseInt(process.env.HUB_STATS_INTERVAL_MS || "0", 10);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        return;
    }

    statsTimer = setInterval(() => {
        log.info(`delivery stats: completed=${completed} failed=${failed}`);
    }, intervalMs);
}

function startWorker() {
    if (worker !== null) {
        return worker;
    }

    worker = new Worker(
        config.queue.name,
        async (job) => {
            await processNotification(job.data);
        },
        {
            connection: createConnection(),
            concurrency: config.delivery.workerConcurrency,
        }
    );

    worker.on("failed", (job, err) => {
        failed += 1;
        log.error(`delivery job ${job?.id} failed: ${err.message}`);
    });

    worker.on("completed", () => {
        completed += 1;
    });

    worker.on("error", (err) => {
        log.error(`delivery worker error: ${err.message}`);
    });

    startWorkerStatsLogger();
    log.info(`delivery worker started (concurrency ${config.delivery.workerConcurrency})`);
    return worker;
}

async function stopWorker() {
    if (worker !== null) {
        if (statsTimer) {
            clearInterval(statsTimer);
            statsTimer = null;
        }
        await worker.close();
        worker = null;
    }
}

module.exports = { startWorker, stopWorker };
