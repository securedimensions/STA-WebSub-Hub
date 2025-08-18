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

"use strict"

const app = require('./app');
const mqtt_client = require('./helpers/mqtt_client');
const { config, log } = require('./settings');
const http_publish = require('./helpers/http_publish');
const {pool} = require('./helpers/db');
const {Query} = require('pg');
const assert = require("assert");

var server = null;

mqtt_client.on('connect', async () => {
    log.info(`Connected to Publisher ${config.sta.root_url}`);

    if (server !== null) {
        log.error('Connection loop with MQTT Broker...');
    }
    else {
        // Start the HTTP API
        server = app.listen(config.hub.port, function () {
            log.info(`Hub is up with URL ${config.hub.url}`);
            log.info(`Hub API listening on port ${config.hub.port}`);
        }).on('error', function (err) {
            log.error(`Failed to start Hub:\n${err}`);
            process.exit(1);
        }).on('listening', async function() {

            // Register all topics with the publisher
            const client = await pool.connect();
            const query = new Query('SELECT topic from topics');
            const result = client.query(query);

            assert.equal(query, result);

            query.on('row', (row) => {
                log.info('Subscribing to MQTT topic: ', row.topic);
                // Register subscription with Publisher
                
                mqtt_client.subscribe(row.topic, (err, granted) => {
                    if (err !== null) log.error(err);
                    if (granted !== null) log.debug(granted[0]);
                });
                
            }).on('end', () => {
                client.release();
                log.info("Hub ready!");
            }).on('error', (error) => {
                log.error('init MQTT subscriptions error: ', error)
            });
        });
        
    }
}).on('disconnect', () => {
    log.info(`Disconnected from Publisher ${config.sta.root_url}`);
    app.removeAllListeners();
}).on('close', () => {
    log.info(`Publisher ${config.sta.root_url} closed MQTT connection`);
    app.removeAllListeners();
}).on('message', (topic, message) => {

    if (message.length > config.max_content_size) {
        log.error(`rejecting content delivery as size exceeds limit of ${config.max_content_size}`);
        return;
    }

    try {
        if (config.hub.enforce_JSON) {
            // We need to make sure to only work on JSON content delivery
            JSON.parse(message.toString());
        }
    
        // publish the message to subscribers
        http_publish(topic, message.toString());
    }
    catch(e) {
        log.error(`payload not JSON format: ${e}`);
    }
  });
