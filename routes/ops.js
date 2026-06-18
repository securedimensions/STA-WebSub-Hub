/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const express = require("express");
const { pool } = require("../helpers/db");
const { getQueueStats } = require("../helpers/queue/stats");
const { listFailedJobs, retryFailedJob, retryAllFailedJobs, purgeFailedJobs } = require("../helpers/queue/failed");
const metrics = require("../helpers/metrics");
const throughput = require("../helpers/throughput");
const subscriptionEvents = require("../helpers/subscription_events");
const { createConnection } = require("../helpers/queue/connection");

const router = express.Router();

async function pingDb() {
    const client = await pool.connect();
    try {
        await client.query("SELECT 1");
        return true;
    } finally {
        client.release();
    }
}

async function pingRedis() {
    const redis = createConnection();
    try {
        await redis.ping();
        return true;
    } finally {
        redis.disconnect();
    }
}

router.get("/health", async (req, res) => {
    const [db, redis] = await Promise.all([
        pingDb().catch(() => false),
        pingRedis().catch(() => false),
    ]);
    const ok = db && redis;
    res.status(ok ? 200 : 503).json({
        ok,
        role: "api",
        checks: { db, redis },
    });
});

router.get("/metrics", async (req, res) => {
    const [queue, throughputStats, recentSubscriptions] = await Promise.all([
        getQueueStats(),
        throughput.getGlobalSnapshot(),
        subscriptionEvents.getRecent(20),
    ]);
    res.json({
        role: "api",
        at: new Date().toISOString(),
        queue,
        throughput: throughputStats,
        subscriptionLifecycle: {
            pendingIntentValidation: subscriptionEvents.getPendingCount(),
            recent: recentSubscriptions,
        },
        process: metrics.snapshot(),
    });
});

router.get("/failed", async (req, res) => {
    const limit = parseInt(req.query.limit || "20", 10);
    const start = parseInt(req.query.start || "0", 10);
    const jobs = await listFailedJobs({ start, limit });
    res.json({ start, limit, jobs });
});

router.post("/failed/retry-all", async (req, res) => {
    const limit = parseInt(req.query.limit || "0", 10);
    const batchSize = parseInt(req.query.batch || "100", 10);
    const result = await retryAllFailedJobs({
        limit: limit > 0 ? limit : Infinity,
        batchSize: batchSize > 0 ? batchSize : 100,
    });
    res.status(202).json(result);
});

router.post("/failed/purge", async (req, res) => {
    if (req.query.confirm !== "true") {
        return res.status(400).json({
            error: "destructive operation; add ?confirm=true to purge failed jobs",
        });
    }
    const limit = parseInt(req.query.limit || "0", 10);
    const batchSize = parseInt(req.query.batch || "1000", 10);
    const result = await purgeFailedJobs({
        limit: limit > 0 ? limit : Infinity,
        batchSize: batchSize > 0 ? batchSize : 1000,
    });
    res.json(result);
});

router.post("/failed/:id/retry", async (req, res) => {
    const job = await retryFailedJob(req.params.id);
    res.status(202).json({ retried: job });
});

module.exports = router;
