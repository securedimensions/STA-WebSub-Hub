/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const express = require("express");
const { pool } = require("../helpers/db");
const { getQueueStats } = require("../helpers/queue/stats");
const { listFailedJobs, retryFailedJob } = require("../helpers/queue/failed");
const metrics = require("../helpers/metrics");
const throughput = require("../helpers/throughput");
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
    const [queue, throughputStats] = await Promise.all([
        getQueueStats(),
        throughput.getGlobalSnapshot(),
    ]);
    res.json({
        role: "api",
        at: new Date().toISOString(),
        queue,
        throughput: throughputStats,
        process: metrics.snapshot(),
    });
});

router.get("/failed", async (req, res) => {
    const limit = parseInt(req.query.limit || "20", 10);
    const start = parseInt(req.query.start || "0", 10);
    const jobs = await listFailedJobs({ start, limit });
    res.json({ start, limit, jobs });
});

router.post("/failed/:id/retry", async (req, res) => {
    const job = await retryFailedJob(req.params.id);
    res.status(202).json({ retried: job });
});

module.exports = router;
