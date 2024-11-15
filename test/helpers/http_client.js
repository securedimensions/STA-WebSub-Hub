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

function http_post(url, headers, data, cb) {
    request(url, {
        method: 'POST',
        followRedirect: false,
        headers: headers,
        data: data
        }).then(response => {
            cb(null, response);
        }).catch(error => {
            console.log(error);
        });
}

function http_get(url, headers, cb) {
    request(url, {
        method: 'GET',
        followRedirect: false,
        headers: headers
        }).then(response => {
            cb(null, response);
        }).catch(error => {
            console.log(error);
        });
}

var http_client = {
    get: function(url, headers, cb) {
        http_get(url, headers, cb);
    },
    post: function(url, headers, data, cb) {
        http_post(url, headers, data, cb);
    }
};

module.exports = http_client;