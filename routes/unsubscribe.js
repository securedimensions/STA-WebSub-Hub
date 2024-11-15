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

const { request } = require('urllib');
const parseHttpHeader = require('parse-http-header');
const querystring = require("querystring");
const crypto = require("crypto");

const db = require('../helpers/db');
const { log } = require('../settings');
const mqtt_client = require('../helpers/mqtt_client');

let unsubscribe = async function (topic_url, topic, callback) {

    // validating unsubscription
    const challenge = crypto.randomBytes(16).toString('hex');

    request(callback,
        {
            method: 'GET',
            data: {
                'hub.mode': 'unsubscribe',
                'hub.topic': querystring.escape(topic_url),
                'hub.challenge': challenge
            }
        }
    ).then(res => {
        log.debug('status: %s, body: %s, headers: %j', res.statusCode, res.data, res.headers);

        let content_type = parseHttpHeader(res.headers['content-type'])[0];
        let charset = parseHttpHeader(res.headers['content-type'])['charset'];
        if (content_type !== 'text/plain') {
            log.error("subscriber returned wrong content-type for validation of intent: " + content_type);
            return;
        }
        if (charset !== 'utf-8') {
            log.error("subscriber returned wrong encoding for validation of intent: " + charset);
            return;
        }

        const challenge_response = res.data.toString();
        log.debug(challenge_response);
        if (challenge_response !== challenge) {
            log.error("subscriber returned mismatching challenge value");
            return;
        }
    }).then(async () => {
        await db.deleteSubscription(topic, callback);

        // If there are no more subscriptions for the topic, unsubscribe the topic
        let num_subscriptions = await db.numSubscriptions(topic);
        log.debug(`number of subscriptions after unsubscribe for topic: ${topic}: ${num_subscriptions}`);
        if (num_subscriptions === 0) {
            log.info('unsubscribing topic: ' + topic);
            mqtt_client.unsubscribe('' + topic, async (err) => {
                if (err !== null) {
                    log.error(err);
                }
            });
        }
    }).catch(error => {
        // Validation of intent failed => subscription remains unchanged
        log.error(`validation if intent error for ${topic_url} -> ${callback}: ${error}`);
        if (typeof error.errors === 'array') {
            error.errors.forEach(e => {
                log.debug(e);
            })
        }
    });

}

module.exports = unsubscribe;