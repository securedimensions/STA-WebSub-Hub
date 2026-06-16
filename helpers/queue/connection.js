/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const IORedis = require("ioredis");
const { config } = require("../../settings");

function createConnection() {
    return new IORedis(config.redis.url, {
        maxRetriesPerRequest: null,
    });
}

module.exports = { createConnection };
