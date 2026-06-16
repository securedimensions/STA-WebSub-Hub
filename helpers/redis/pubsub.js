/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { createConnection } = require("../queue/connection");

function createPublisher() {
    return createConnection();
}

function createSubscriber() {
    return createConnection();
}

module.exports = { createPublisher, createSubscriber };

