/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { request, Agent } = require("undici");
const { config } = require("../../settings");

const agent = new Agent({
    connections: 100,
    pipelining: 1,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
});

async function post(callbackUrl, payload, headers) {
    const response = await request(callbackUrl, {
        method: "POST",
        headers,
        body: payload,
        dispatcher: agent,
        headersTimeout: config.delivery.postTimeoutMs,
        bodyTimeout: config.delivery.postTimeoutMs,
        maxRedirections: 0,
    });

    return { status: response.statusCode };
}

module.exports = { post };
