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
const hub_signature_algorithm = process.env.HUB_SIGNATURE_ALGORTIHM || "sha256";


const subscriber = express();

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

subscriber.post('*', express.raw({ type: '*/*' }), function (req, res) {
    log.debug('==============');
    log.debug('callback: ' + req.originalUrl);
    log.debug(`headers:`);
    log.debug(req.headers);
    log.debug('message:');
    log.debug(req.body.toString());

    const x_hub_signature = req.header('X-Hub-Signature') || null;
    if (x_hub_signature !== null) {
        let hmac = crypto.createHmac(hub_signature_algorithm, subscriber_secret).update(req.body.toString()).digest("hex");
        if ((hub_signature_algorithm + '=' + hmac) === x_hub_signature) {
            log.info("X-Hub-Signature valid");
        } else {
            log.info("X-Hub-Signature invalid!");
        }
    } else {
        log.info("message with no X-Hub-Signature");
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