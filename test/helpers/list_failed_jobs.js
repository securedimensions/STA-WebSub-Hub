/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

require("dotenv").config();

const { listFailedJobs, retryFailedJob } = require("../../helpers/queue/failed");

async function main() {
    const args = process.argv.slice(2);
    const retryId = args.find((a) => a.startsWith("--retry="))?.split("=")[1];
    const limit = parseInt(
        args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "20",
        10
    );
    const start = parseInt(
        args.find((a) => a.startsWith("--start="))?.split("=")[1] || "0",
        10
    );

    if (retryId) {
        const job = await retryFailedJob(retryId);
        console.log(JSON.stringify({ retried: job }, null, 2));
        return;
    }

    const jobs = await listFailedJobs({ start, limit });
    console.log(JSON.stringify({ start, limit, count: jobs.length, jobs }, null, 2));
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
