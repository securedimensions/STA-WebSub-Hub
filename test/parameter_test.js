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

const assert = require('node:assert');
const http_client = require('./helpers/http_client');
const { config } = require('../settings');
const db = require('../helpers/db');

// Derive from config so tests work regardless of how the publisher container is named.
const sta_root_url = config.sta.root_url.replace(/\/$/, '');
const subscriber_base = process.env.SUBSCRIBER_URL || 'http://subscriber:8081';

// A URL that intentionally does NOT match STA_ROOT_URL, used to test the
// "publisher not supported" rejection path.
const bad_publisher_url = "http://unsupported-publisher";

const parameters = [
    [{}, 400, 'no parameters'],
    [{ 'hub.mode': 'subscribe' }, 400, 'missing mandatory parameter `hub.mode`'],
    [{ 'hub.mode': 'subscribe', 'hub.callback': 'http://foobar' }, 400, 'missing mandatory parameter `hub.topic`'],
    [{ 'hub.mode': 'subscribe', 'hub.topic': 'topic' }, 400, 'missing mandatory parameter `hub.callback`'],
    [{ 'hub.mode': 'subscribe', 'hub.callback': 'http://foobar', 'hub.topic': bad_publisher_url + '/ABC' }, 400, 'publisher not supported'],
    [{ 'hub.mode': 'subscribe', 'hub.callback': 'http://foobar/' + "x".repeat(config.max_url_size), 'hub.topic': bad_publisher_url + '/ABC' }, 413, 'URL size exceeded'],
    [{ 'hub.mode': 'subscribe', 'hub.callback': 'http://foobar/', 'hub.topic': sta_root_url + "x".repeat(config.max_topic_size) }, 413, 'Topic size exceeded']
]

describe('Subscription Parameter Failure Testing', () => {

    parameters.forEach(params => {

        it(`request with hub.mode=${params[0]['hub.mode']}\thub.callback=${params[0]['hub.callback']}\thub.topic=${params[0]['hub.topic']}`, function (done) {
            const headers = {};

            http_client.post(config.hub.url, headers, params[0], (err, res) => {
                try {
                    assert.equal(res.statusCode, params[1], params[2]);
                    done();
                }
                catch (err) {
                    console.log(err);
                    done(err);
                }
            });
        });
    })
});

describe('Subscribe Testing - with correct hub.secret', () => {
    let topic = '';
    const headers = {};
    let params = {};
    let message = '';

    describe('Subscribe', () => {
        topic = 'hub.secret=secret';

        before(`remove subscription for ${topic}`, async function () {
            await db.clearAll();
        });
        after(`remove subscription for ${topic}`, async function () {
            await db.clearAll();
        });


        params = { 'hub.mode': 'subscribe', 'hub.secret': 'secret', 'hub.callback': subscriber_base + '/accepted/' + topic, 'hub.topic': sta_root_url + '/' + topic };
        message = `subscribe to topic ${topic}`;
        it(message, function (done) {
            // Subscribe for topic
            http_client.post(config.hub.url, headers, params, async (err, res) => {
                try {
                    assert.equal(res.statusCode, 202, message);
                    const startedAt = Date.now();
                    const poll = async () => {
                        try {
                            const no = await db.numSubscriptions(topic);
                            if (no >= 1) {
                                done();
                                return;
                            }
                            if (Date.now() - startedAt > 8000) {
                                done(new Error(`Timed out waiting for subscription to be stored for topic ${topic}. numSubscriptions=${no}`));
                                return;
                            }
                            setTimeout(poll, 200);
                        } catch (e) {
                            done(e);
                        }
                    };
                    poll();
                }
                catch (err) {
                    console.log(err);
                    done(err);
                }
            });
        });
    });
});

describe('Subscribe Testing - with correct hub.secret', () => {
    let topic = '';
    const headers = {};
    let params = {};
    let message = '';

    describe('Subscribe', () => {
        topic = 'hub.secret=foobar';

        before(`remove subscription for ${topic}`, async function () {
            await db.clearAll();
        });
        after(`remove subscription for ${topic}`, async function () {
            await db.clearAll();
        });


        params = { 'hub.mode': 'subscribe', 'hub.secret': 'foobar', 'hub.callback': subscriber_base + '/accepted/' + topic, 'hub.topic': sta_root_url + '/' + topic };
        message = `subscribe to topic ${topic}`;
        it(message, function (done) {
            // Subscribe for topic
            http_client.post(config.hub.url, headers, params, async (err, res) => {
                try {
                    assert.equal(res.statusCode, 202, message);
                    const startedAt = Date.now();
                    const poll = async () => {
                        try {
                            const no = await db.numSubscriptions(topic);
                            if (no >= 1) {
                                done();
                                return;
                            }
                            if (Date.now() - startedAt > 8000) {
                                done(new Error(`Timed out waiting for subscription to be stored for topic ${topic}. numSubscriptions=${no}`));
                                return;
                            }
                            setTimeout(poll, 200);
                        } catch (e) {
                            done(e);
                        }
                    };
                    poll();
                }
                catch (err) {
                    console.log(err);
                    done(err);
                }
            });
        });
    });
});

describe('Subscribe Testing - no hub.secret', () => {
    let topic = '';
    const headers = {};
    let params = {};
    let message = '';

    describe('Subscribe', () => {
        topic = 'ABC';

        before(`remove subscription for ${topic}`, async function () {
            await db.clearAll();
        });
        after(`remove subscription for ${topic}`, async function () {
            await db.clearAll();
        });

        params = { 'hub.mode': 'subscribe', 'hub.callback': subscriber_base + '/accepted/' + topic, 'hub.topic': sta_root_url + '/' + topic };
        message = `subscribe to topic ${topic}`;
        it(message, function (done) {
            // Subscribe for topic
            http_client.post(config.hub.url, headers, params, async (err, res) => {
                try {
                    assert.equal(res.statusCode, 202, message);
                    const startedAt = Date.now();
                    const poll = async () => {
                        try {
                            const no = await db.numSubscriptions(topic);
                            if (no >= 1) {
                                done();
                                return;
                            }
                            if (Date.now() - startedAt > 8000) {
                                done(new Error(`Timed out waiting for subscription to be stored for topic ${topic}. numSubscriptions=${no}`));
                                return;
                            }
                            setTimeout(poll, 200);
                        } catch (e) {
                            done(e);
                        }
                    };
                    poll();
                }
                catch (err) {
                    console.log(err);
                    done(err);
                }
            });
        });
    });
});

describe('Subscribe / Unsubscribe Testing', () => {
    let topic = '';
    const headers = {};
    let params = {};
    let message = '';

    describe('Subscribe and then unsubscribe', () => {
        topic = 'ABC-UNSUB';
        
        before(`remove subscription for ${topic}`, async function () {
            await db.clearAll();
        });
        after(`remove subscription for ${topic}`, async function () {
            await db.clearAll();
        });
        it(message, function (done) {
            params = { 'hub.mode': 'subscribe', 'hub.callback': subscriber_base + '/accepted/' + topic, 'hub.topic': sta_root_url + '/' + topic };
            message = `subscribe and then unsubscribe to topic ${topic}`;
            // Subscribe for topic
            http_client.post(config.hub.url, headers, params, async (err, res) => {
                try {
                    assert.equal(res.statusCode, 202, message);
                }
                catch (err) {
                    console.log(err);
                }
            });

            // The validation of intent is async. Poll until the subscription is stored.
            const startedAt = Date.now();
            const poll = async () => {
                try {
                    const no = await db.numSubscriptions(topic);
                    if (no === 1) {
                        console.log("Unsubscribe starting");
                        params = { 'hub.mode': 'unsubscribe', 'hub.callback': subscriber_base + '/accepted/' + topic, 'hub.topic': sta_root_url + '/' + topic };
                        message = `unsubscribe to topic ${topic}`;
                        http_client.post(config.hub.url, headers, params, async (err, res) => {
                            try {
                                assert.equal(res.statusCode, 202, message);
                                console.log("Unsubscribe finished");
                                done();
                            }
                            catch (err) {
                                done(err);
                            }
                        });
                        return;
                    }

                    if (Date.now() - startedAt > 8000) {
                        done(new Error(`Timed out waiting for subscription to be stored for topic ${topic}. numSubscriptions=${no}`));
                        return;
                    }

                    setTimeout(poll, 200);
                } catch (err) {
                    done(err);
                }
            };

            poll();

            

        });
    });
});