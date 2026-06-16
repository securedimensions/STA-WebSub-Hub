/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const subscriptionCache = require("./helpers/cache/subscriptions");
const { startInvalidationListener } = require("./helpers/cache/invalidation");
const { startWorker, stopWorker } = require("./helpers/queue/worker");
const { log } = require("./settings");

async function main() {
    await subscriptionCache.load();
    await startInvalidationListener();
    startWorker();
    log.info("hub delivery process ready");
}

main().catch((err) => {
    log.error(`failed to start delivery process: ${err.message}`);
    process.exit(1);
});

async function shutdown(signal) {
    log.info(`delivery process received ${signal}`);
    await stopWorker();
    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
