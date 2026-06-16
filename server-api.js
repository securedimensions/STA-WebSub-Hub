/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const app = require("./app");
const { config, log } = require("./settings");

const server = app
    .listen(config.hub.port, function () {
        log.info(`Hub is up with URL ${config.hub.url}`);
        log.info(`Hub API listening on port ${config.hub.port}`);
    })
    .on("error", function (err) {
        log.error(`Failed to start Hub:\n${err}`);
        process.exit(1);
    });

function shutdown(signal) {
    log.info(`api process received ${signal}`);
    server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

