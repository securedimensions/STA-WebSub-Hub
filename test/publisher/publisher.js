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
const cron = require("node-cron");
let publisher = require('express')();
const mqtt = require('mqtt');

const publisher_port = process.env.PUBLISHER_PORT || 8181;
const sta_root_url = process.env.STA_ROOT_URL || 'http://publisher';
const hub_url = process.env.HUB_URL || "http://localhost:4000/api/subscriptions";
const sta_mqtt_url = process.env.STA_MQTT_URL || "mqtt://localhost:1883";

const log = require('loglevel');
log.setLevel(process.env.PUBLISHER_LOG_LEVEL || log.levels.INFO);

var mqtt_client = mqtt.connect(sta_mqtt_url, {
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000,
  });
  
mqtt_client.on('connect', () => {
    log.info('Connected to STA TEST MQTT publisher');

    publisher = publisher.listen(publisher_port, function () {
        log.info(`STA Publisher listening on port ${publisher_port}`);
    }).on('error', function (err) {
        log.error(`Failed to start STA Test Publisher\n${err}`);
        process.exit(1);
    });

});

function publish_topic(topic) {
    log.info("start in 10 seconds with publishing every 10 seconds to topic: " + topic);
    // publish message on topic every 10 seconds
    cron.schedule("*/10 * * * * *", function () {
        let now = Math.round(Date.now() / 1000).toFixed(0);
        log.debug(`topic ${topic} date: ${now}`);
        mqtt_client.publish(topic, `{"topic": "${topic}", "sequence": ${now}}`);
    });
}

publisher.head('*', function (req, res) {
    // start publishing to the topic
    publish_topic(req.path.substring(1));

    // This STA endpoint does not support MQTT topics with ODATA query
    // => The selflink has no query part!
    let self = sta_root_url + req.path;

    return res.status(200)
        .appendHeader('Link', `<${self}>; rel="self"`)
        .appendHeader('Link', `<${hub_url}>; rel="hub"`)
        .contentType('application/json')
        .send();
});

publisher.get('*', function (req, res) {
    // start publishing to the topic
    if (req.path === '/favicon.ico') {
        return res.status(202).send();
    }

    publish_topic(req.path.substring(1));

    // This STA endpoint does not support MQTT topics with ODATA query
    // => The selflink has no query part!
    let self = sta_root_url + req.path;

    return res.status(200)
        .appendHeader('Link', `<${self}>; rel="self"`)
        .appendHeader('Link', `<${hub_url}>; rel="hub"`)
        .contentType('application/json')
        .send('{}');
});

// only works when the process normally exits
// on windows, ctrl-c will not trigger this handler (it is unnormal)
// unless you listen on 'SIGINT'
process.on("exit", async (code) => {
    console.log("Process exit event with code: ", code);
    publisher.removeAllListeners();
});

// just in case some user like using "kill"
process.on("SIGTERM", async (signal) => {
    console.log(`Process ${process.pid} received a SIGTERM signal`);
    publisher.removeAllListeners();
    process.exit(0);
});

// catch ctrl-c, so that event 'exit' always works
process.on("SIGINT", async (signal) => {
    console.log(`Process ${process.pid} has been interrupted`);
    publisher.removeAllListeners();
    process.exit(0);
});

// what about errors
// try remove/comment this handler, 'exit' event still works
process.on("uncaughtException", (err) => {
    console.log(`Uncaught Exception: ${err.message}`);
    publisher.removeAllListeners();
    //process.exit(1);
});