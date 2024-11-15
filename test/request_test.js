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
const {config} = require('../settings');

describe('Subscription GET request testing', () => {

    it('GET request', function (done) {
        http_client.get(config.hub.url, {}, (err, res) => {
            try {
                assert.equal(res.statusCode, 405, 'HTTP GET not allowed');
                done();
            }
            catch (err) {
                done(err);
            }
        });
    });
});

describe('Subscription POST request testing', () => {

    it('request with no content-type header', function (done) {
        const headers = {};
        const data = null;

        http_client.post(config.hub.url, headers, data, (err, res) => {
            try {
                assert.equal(res.statusCode, 415, 'no http content-type header');
                done();
            }
            catch (err) {
                done(err);
            }
        });
    });

    it('request with content-type=application/json', function (done) {
        const headers = {'content-type': 'application/json'};
        const data = null;

        http_client.post(config.hub.url, headers, data, (err, res) => {
            try {
                assert.equal(res.statusCode, 415, 'content-type=application/json');
                done();
            }
            catch (err) {
                done(err);
            }
        });
    });

    it('request exceeding mxax length', function (done) {
        const headers = {};
        const data = {
            'foo.bar': "x".repeat(config.max_request_size)
        };

        http_client.post(config.hub.url, headers, data, (err, res) => {
            try {
                assert.equal(res.statusCode, 413, `request exceeds max. length of ${config.max_request_size}`);
                done();
            }
            catch (err) {
                done(err);
            }
        });
    });
    
});