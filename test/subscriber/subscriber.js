/*
MIT License

Copyright (c) 2024 Secure Dimensions

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

"use strict";

require("dotenv").config();
const express = require('express');
const crypto = require('crypto');

const log = require('loglevel');
log.setLevel(process.env.SUBSCRIBER_LOG_LEVEL || log.levels.DEBUG);

const subscriber_port = process.env.SUBSCRIBER_PORT || 8081;
const subscriber_secret = process.env.SUBSCRIBER_SECRET || "secret";

const subscriber = express();

// Parse raw POST bodies once for all notification routes (WebSub HMAC is over raw bytes).
subscriber.use(express.raw({ type: "*/*", limit: "10mb" }));

function resolveSecret(req) {
    // Test topics encode the subscription secret in the callback path: hub.secret=<value>
    const path = decodeURIComponent(req.path);
    const fromPath = path.match(/hub\.secret=([^/]+)/);
    if (fromPath) {
        return fromPath[1];
    }
    return subscriber_secret;
}

function payloadBuffer(body) {
    if (Buffer.isBuffer(body)) {
        return body;
    }
    if (typeof body === "string") {
        return Buffer.from(body, "utf8");
    }
    return Buffer.alloc(0);
}

function verifyHubSignature(req) {
    const x_hub_signature = req.header("X-Hub-Signature");
    if (!x_hub_signature) {
        return { ok: false, reason: "missing" };
    }

    const separator = x_hub_signature.indexOf("=");
    if (separator === -1) {
        return { ok: false, reason: "malformed-header", header: x_hub_signature };
    }

    const algorithm = x_hub_signature.slice(0, separator).toLowerCase();
    const providedDigest = x_hub_signature.slice(separator + 1);
    const secret = resolveSecret(req);
    const body = payloadBuffer(req.body);
    const expectedDigest = crypto.createHmac(algorithm, secret).update(body).digest("hex");

    const provided = Buffer.from(providedDigest, "utf8");
    const expected = Buffer.from(expectedDigest, "utf8");
    const digestMatches =
        provided.length === expected.length &&
        crypto.timingSafeEqual(provided, expected);

    return {
        ok: digestMatches,
        reason: digestMatches ? "valid" : "mismatch",
        algorithm,
        secret,
        bodyBytes: body.length,
        providedDigest,
        expectedDigest,
    };
}

// All subscriptions and unsubscriptions are accepted
subscriber.get('/accepted/*', function (req, res) {
    log.info(req.originalUrl);
    // accepted validation of intent => Return the challenge
    return res.status(200).contentType('text/plain').send(req.query['hub.challenge']);
});

// All subscriptions and unsubscriptions are accepted 
subscriber.get('/gone/*', function (req, res) {
    log.info(req.originalUrl);
    // accepted validation of intent => Return the challenge
    return res.status(200).contentType('text/plain').send(req.query['hub.challenge']);
});

// All subscriptions and unsubscriptions are rejected
subscriber.get('/rejected/*', function (req, res) {
    log.info(req.originalUrl);
    // reject validation of intent => Return 404
    return res.status(404).send();
});

subscriber.post('*', function (req, res) {
    log.debug('==============');
    log.debug('callback: ' + req.originalUrl);
    log.debug(`headers:`);
    log.debug(req.headers);
    log.debug('message:');
    log.debug(payloadBuffer(req.body).toString('utf8'));

    const verification = verifyHubSignature(req);
    if (verification.ok) {
        log.info(
            `X-Hub-Signature valid (algorithm=${verification.algorithm}, secret=${verification.secret}, bodyBytes=${verification.bodyBytes})`
        );
    } else if (verification.reason === "missing") {
        log.info("message with no X-Hub-Signature");
    } else {
        log.info(
            `X-Hub-Signature invalid! reason=${verification.reason} algorithm=${verification.algorithm} secret=${verification.secret} bodyBytes=${verification.bodyBytes}`
        );
        log.debug(`provided=${verification.providedDigest}`);
        log.debug(`expected=${verification.expectedDigest}`);
    }
    log.debug('==============');

    if (req.originalUrl.startsWith('/gone')) {
        // subscriptoion does no longer exist
        return res.status(410).send(`subscription gone`);
    }
    return res.status(200).send();
});

subscriber.listen(subscriber_port, function () {
    log.info(`Subscriber Test API listening on port ${subscriber_port}`);
    
}).on('error', function (err) {
    log.error(`Failed to start Subscriber Test API:\n${err}`);
    process.exit(1);
});

// only works when the process normally exits
// on windows, ctrl-c will not trigger this handler (it is unnormal)
// unless you listen on 'SIGINT'
process.on("exit", async (code) => {
    log.error("Process exit event with code: ", code);
    subscriber.removeAllListeners();
});

// just in case some user like using "kill"
process.on("SIGTERM", async (signal) => {
    log.error(`Process ${process.pid} received a SIGTERM signal`);
    subscriber.removeAllListeners();
    process.exit(0);
});

// catch ctrl-c, so that event 'exit' always works
process.on("SIGINT", async (signal) => {
    log.error(`Process ${process.pid} has been interrupted`);
    subscriber.removeAllListeners();
    process.exit(0);
});

// what about errors
// try remove/comment this handler, 'exit' event still works
process.on("uncaughtException", (err) => {
    log.error(`Uncaught Exception: ${err.message}`);
    subscriber.removeAllListeners();
});