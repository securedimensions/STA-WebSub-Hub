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
const mqtt_client = require('../helpers/mqtt_client');
const { config, log } = require('../settings');

function parseLink(data) {
    let parsed_data = {};

    if (data == null) {
        return parsed_data;
    }

    data.forEach(d => {
        let linkInfo = /<([^>]+)>;\s+rel="([^"]+)"/ig.exec(d)

        parsed_data[linkInfo[2]] = linkInfo[1]
    });

    return parsed_data;
}

let subscribe = async function (topic_url, topic, callback, lease_seconds = config.hub.default_lease_seconds, secret = null) {

    // Validate that subscription with Publisher is possible
    const url = config.publisher.url + topic;
    log.info('Starting validation of intent with publisher: ', url);
    log.info('topic_url: ', topic_url.toString());
    const status = await request(url, { method: 'HEAD' })
        .then(async (res) => {
            // result: { data: Buffer, res: Response }
            log.debug('status: %s, body: %s, headers: %j', res.statusCode, res.data, res.headers);
            let linkHeaders = parseLink(res.headers['link']);
            log.debug('linkHeaders: ', linkHeaders);

            let accepted = true;
            let error_msg = '';
            if (linkHeaders['hub'] === undefined) {
                error_msg = 'publisher did not return Link rel="hub"';
                accepted = false;
            }

            if (linkHeaders['hub'] !== config.hub.url) {
                error_msg = 'publisher returned mismatching hub URL: ' + linkHeaders['hub'];
                accepted = false;
            }

            if (linkHeaders['self'] === undefined) {
                error_msg = 'publisher did not return Link rel="self"';
                accepted = false;
            }

            //if (linkHeaders['self'] !== topic_url.toString()) {
            if (querystring.unescape(linkHeaders['self']) !== querystring.unescape(topic_url.toString())) {
                error_msg = 'publisher returned mismatching topic URL: ' + linkHeaders['self'];
                accepted = false;
            }

            if (accepted === false) {
                log.error('topic registration with publisher failed: ' + topic);
                log.error(error_msg);
                request(callback,
                    {
                        method: 'GET',
                        data: {
                            'hub.mode': 'denied',
                            'hub.topic': querystring.escape(topic_url),
                            'hub.reason': error_msg
                        }
                    }
                ).then(res => {
                    log.debug(`hub.denied response status code: ${res.statusCode}`);
                }).catch(reason => {
                    log.error(`hub.denied error: ${reason}`);
                }); 
                return false;               
            }
            log.info('Validation of intent with publisher finished successfuly');
            return true;
        }).catch(reason => {
            log.error(`publisher connect error: ${reason}`);
            return false;
        });

    if (status == false) {
        return;
    }


    // validate intent of Subscriber
    const challenge = crypto.randomBytes(16).toString('hex');
    log.debug("topic: ", topic_url);
    let params = {
        'hub.mode': 'subscribe',
        'hub.topic': topic_url.toString(), //querystring.escape(topic_url),
        'hub.challenge': challenge,
        'hub.lease_seconds': lease_seconds
    };

    if (secret !== null) {
        params['hub.secret'] = secret;
    }
    log.debug("params: ", params);
    request(callback, { method: 'GET', data: params })
        .then(async (res) => {

            // result: { data: Buffer, res: Response }
            log.debug('status: %s, body: %s, headers: %j', res.statusCode, res.data, res.headers);

            let content_type = parseHttpHeader(res.headers['content-type'])[0];
            let charset = parseHttpHeader(res.headers['content-type'])['charset'];
            if (content_type !== 'text/plain') {
                log.error("subscriber returned wrong content-type for validation of intent: " + content_type);
                return;
            }
            if (charset.toLowerCase() !== 'utf-8') {
                log.error("subscriber returned wrong encoding for validation of intent: " + charset);
                return;
            }

            const challenge_response = res.data.toString();
            log.debug(challenge_response);
            if (challenge_response !== challenge) {
                log.error("subscriber returned mismatching challenge value");
                return;
            }

            // Register subscription with Publisher
            mqtt_client.subscribe('' + topic, async (err, granted) => {
                if (err !== null) log.error(err);
                if ((granted.length > 0) && ((granted[0].topic !== topic) || (err !== null))) {
                    // mqtt.subscribe did return an error, so send denied to callback ...
                    log.error('topic registration with SensorThings service failed: ' + topic);
                    request(callback,
                        {
                            method: 'GET',
                            data: {
                                'hub.mode': 'denied',
                                'hub.topic': topic_url.toString(), //querystring.escape(topic_url),
                                'hub.reason': 'Publisher MQTT subscription error'
                            }
                        }
                    ).then(res => {
                        log.debug(`hub.denied response status code: ${res.statusCode}`);
                    }).catch(reason => {
                        log.error(`hub.denied error: ${reason}`);
                    });

                    return;
                }
            });

            // find all callback URLs for the topic...
            let subscriptions = await db.getSubscriptions(topic);
            log.debug('subscriptions: ', subscriptions);
            const subscription = subscriptions.filter(s => s.callback === callback);

            if (subscription.length === 0) {
                log.info(`no subscription for topic: ${topic_url} -> ${callback}`);
                // Insert subscription into the database
                await db.insertSubscription(topic_url, topic, callback, lease_seconds, secret);
                log.info(`subscription created: ${topic_url} -> ${callback}`);
            } else {
                log.debug('subscription topic_id: ' + subscription[0].topic_id);
                // the subscription exists and need to be updated
                await db.updateSubscription(subscription[0].topic_id, callback, lease_seconds, secret);
                log.info(`subscription updated: ${topic_url} -> ${callback}`);
            }

        }).catch(error => {
            log.error(`validation if intent error for ${topic_url} -> ${callback}: ${error.code}`);
            if (typeof error.errors === 'array') {
                error.errors.forEach(e => {
                    log.debug(e);
                })
            }
        });

}

module.exports = subscribe;
