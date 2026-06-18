/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

require("dotenv").config();

const {
    listFailedJobs,
    retryFailedJob,
    retryAllFailedJobs,
    purgeFailedJobs,
} = require("../../helpers/queue/failed");

function readIntArg(args, name, fallback) {
    const raw = args.find((a) => a.startsWith(`${name}=`))?.split("=")[1];
    if (raw === undefined) {
        return fallback;
    }
    const value = parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`invalid ${name}: ${raw}`);
    }
    return value;
}

function hasFlag(args, flag) {
    return args.includes(flag);
}

async function main() {
    const args = process.argv.slice(2);
    const retryId = args.find((a) => a.startsWith("--retry="))?.split("=")[1];
    const limit = readIntArg(args, "--limit", 0);
    const start = readIntArg(args, "--start", 0);
    const batchSize = readIntArg(args, "--batch", 100);
    const effectiveLimit = limit > 0 ? limit : Infinity;

    if (retryId) {
        const job = await retryFailedJob(retryId);
        console.log(JSON.stringify({ retried: job }, null, 2));
        return;
    }

    if (hasFlag(args, "--retry-all")) {
        const result = await retryAllFailedJobs({
            limit: effectiveLimit,
            batchSize,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (hasFlag(args, "--purge")) {
        if (!hasFlag(args, "--yes")) {
            throw new Error("refusing to purge without --yes (destructive; jobs are not redelivered)");
        }
        const result = await purgeFailedJobs({
            limit: effectiveLimit,
            batchSize: Math.max(batchSize, 1000),
        });
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    const jobs = await listFailedJobs({ start, limit: limit || 20 });
    console.log(JSON.stringify({ start, limit: limit || 20, count: jobs.length, jobs }, null, 2));
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
