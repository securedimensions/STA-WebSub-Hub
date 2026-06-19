/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const assert = require("assert");
const IORedis = require("ioredis");
const { listTopicsWithExpiredLease } = require("../helpers/mqtt/lease_sweep");
const topicActivity = require("../helpers/mqtt/topic_activity");

async function redisAvailable() {
    const client = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
        maxRetriesPerRequest: 1,
        connectTimeout: 500,
        lazyConnect: true,
    });
    client.on("error", () => {});

    try {
        await client.connect();
        await client.ping();
        return true;
    } catch (_e) {
        return false;
    } finally {
        try {
            await client.quit();
        } catch (_e) {
            // ignore
        }
    }
}

describe("lease_sweep", function () {
    const topic = "v1.1/Observations";

    before(async function () {
        this.timeout(3000);
        if (!(await redisAvailable())) {
            this.skip();
        }
    });

    beforeEach(async function () {
        this.timeout(5000);
        await topicActivity.markInactive(topic);
    });

    afterEach(async function () {
        this.timeout(5000);
        await topicActivity.markInactive(topic);
    });

    it("lists registry topics whose lease TTL has expired", async function () {
        this.timeout(5000);
        await topicActivity.markActive(topic, 1);
        await new Promise((r) => setTimeout(r, 1100));

        const expired = await listTopicsWithExpiredLease([topic]);
        assert.ok(expired.includes(topic));
    });

    it("does not list topics with a live lease", async function () {
        await topicActivity.markActive(topic, 60);

        const expired = await listTopicsWithExpiredLease([topic]);
        assert.strictEqual(expired.includes(topic), false);
    });
});
