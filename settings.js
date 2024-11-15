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

const log = require('loglevel');
log.setLevel(process.env.HUB_LOG_LEVEL || log.levels.INFO);

module.exports = {
    "config": {
        "sta": {
            "root_url": process.env.STA_ROOT_URL || "http://localhost:8080/FROST-Server",
            "mqtt_url": process.env.STA_MQTT_URL || "mqtt://localhost:1883",
            "mqtt_user": process.env.STA_MQTT_USER || null,
            "mqtt_password": process.env.STA_MQTT_PASSWORD || null
        },
        "hub": {
            "default_lease_seconds": 1800, // 30min
            "max_lease_seconds": 86400, // 1 day
            "min_lease_seconds": 60,
            "url": process.env.HUB_URL || "http://localhost:4000/api/subscriptions",
            "port": process.env.HUB_PORT || 4000,
            "sha_algorithm": process.env.HUB_SIGNATURE_ALGORTIHM || "sha256",
            "enforce_JSON": false,
            "enforce_UTF8": false
        },
        "db": {
            "host": process.env.POSTGRES_HOST || "localhost",
            "database": process.env.POSTGRES_DB || "websub",
            "port": process.env.POSTGRES_PORT || 5432,
            "user": process.env.POSTGRES_USER || "websub",
            "password": process.env.POSTGRES_PASSWORD || "changeme"
        },
	"publisher": {
	    "url": process.env.PUBLISHER_URL || process.env.STA_ROOT_URL
	},
        "max_request_size": 32768,
        "max_url_size": 2024,
        "max_topic_size": 4096,
        "max_content_size": 1048576
    }, 
    log
}
