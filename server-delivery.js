/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const subscriptionCache = require("./helpers/cache/subscriptions");
const { startInvalidationListener } = require("./helpers/cache/invalidation");
const { startWorker, stopWorker, getWorkerStats } = require("./helpers/queue/worker");
const circuit = require("./helpers/delivery/circuit");
const metrics = require("./helpers/metrics");
const { startOpsServer } = require("./helpers/ops/server");
const { log } = require("./settings");

metrics.setRole("delivery");

let opsServer = null;

async function main() {
    await subscriptionCache.load();
    await startInvalidationListener();
    startWorker();

    opsServer = startOpsServer({
        role: "delivery",
        getHealth: async () => ({
            ok: true,
            role: "delivery",
            checks: { worker: true },
        }),
        getMetrics: async () => ({
            role: "delivery",
            at: new Date().toISOString(),
            process: getWorkerStats(),
            circuitsOpen: circuit.getOpenCircuits(),
        }),
    });

    log.info("hub delivery process ready");
}

main().catch((err) => {
    log.error(`failed to start delivery process: ${err.message}`);
    process.exit(1);
});

async function shutdown(signal) {
    log.info(`delivery process received ${signal}`);
    if (opsServer) {
        opsServer.close();
        opsServer = null;
    }
    await stopWorker();
    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
