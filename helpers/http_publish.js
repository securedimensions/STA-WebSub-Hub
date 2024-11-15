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

const db = require('./db');
const crypto = require('crypto');
const { request } = require('urllib');
const mqtt_client = require('./mqtt_client');
const { config, log } = require('../settings');

let http_publish = async function (topic, payload) {

    // find all callback URLs where to send the payload...
    let subscriptions = await db.getSubscriptions(topic);

    log.debug(`no of subscriptions for ${topic}: ${subscriptions.length}`);

    if (subscriptions.length == 0) {
        mqtt_client.unsubscribe(''+topic);
        return;
    }

    let num_subcriptions = subscriptions.length;

    const d = new Date();
    const seconds = Math.round(d.getTime() / 1000);

    // Just send the message to each subscriber
    subscriptions.forEach(async (subscription) => {

        // Check if the subscription is expired
        if ((typeof subscription.duration == "number") && (seconds > subscription.duration)) {
            log.info(`subscription is expired: ${topic} -> ${subscription.callback}`);
            log.debug("now: ", seconds);
            log.debug("duration: " + subscription.duration);
            db.deleteSubscription(topic, subscription.callback);
            num_subcriptions -= 1;
            if (num_subcriptions === 0) {
                log.info(`number of subscriptions remaining for ${topic}: ${num_subcriptions}`);
                mqtt_client.unsubscribe(''+topic);
            }
            return;
        }

        // Check if the subscription is diaabled (message could notbe delivered twice)
        if (subscription.status === db.subscription_state.DISABLED) {
            log.warn(`subscription is disabled - not publishing payload to: ${topic} -> ${subscription.callback}`);
            return;
        }
        
        log.debug("subscription: " + JSON.stringify(subscription));
        log.debug("payload: " + payload);
        const topic_url = config.sta.root_url + topic;

        let headers = {
            'Content-Type': 'application/json',
            'Link': [config.hub.url + ';rel="hub"', topic_url + ';rel="self"']
        };
        if (subscription.secret !== null) {
            // include header X-Hub-Signature
            let hmac = crypto.createHmac(config.hub.sha_algorithm, subscription.secret).update(payload).digest("hex");
            log.debug(`secret: ${subscription.secret})`);
            log.debug(`hmac: ${hmac}`);
            // generate hmac signature from the subscription, based on secret
            headers['X-Hub-Signature'] = config.hub.sha_algorithm + '=' + hmac;

            log.debug(headers);

        }
        request(subscription.callback, {
            method: 'POST',
            followRedirect: false,
            headers: headers,
            content: payload
            }).then(response => {
            log.debug(`publishing status code  for ${topic} -> ${subscription.callback}: ${response.statusCode}`);
            if ((response.statusCode >= 200) && (response.statusCode <= 299)) {
                if (subscription.status === db.subscription_state.INACTIVE) {
                    log.info(`status changed to ACTIVE for: ${topic} -> ${subscription.callback}`);
                    db.activateSubscription(subscription.callback);
                }
            }

            if (response.statusCode === 410) {
                log.info("subscription gone for topic: " + topic);
                db.deleteSubscription(topic, subscription.callback);
                num_subcriptions -= 1;
                if (num_subcriptions === 0) {
                    log.info(`number of subscriptions remaining for ${topic}: ${num_subcriptions}`);
                    mqtt_client.unsubscribe(''+topic);
                }
            }
        }).catch(reason => {
            log.error(`publishing error for ${topic} -> ${subscription.callback}: ${reason}`);
            // subscription.state {ACTIVE, UPDATED} -> {INACTIVE} - continue deliver payload
            // subscription.state {INACTIVE} -> {DISABLED} - stop delivering payload
            if ([db.subscription_state.ACTIVE, db.subscription_state.UPDATED].includes(subscription.status)) {
                log.info(`status changed to INACTIVE for: ${topic} -> ${subscription.callback}`);
                db.deactivateSubscription(subscription.callback);
            } else if (subscription.status === db.subscription_state.INACTIVE) {
                log.info(`status changed to DISABLED for: ${topic} -> ${subscription.callback}`);
                db.disableSubscription(subscription.callback);
            }
            
        });
        
    });
}

module.exports = http_publish;