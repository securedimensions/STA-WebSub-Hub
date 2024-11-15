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

'use strict'

const url = require('url');
const querystring = require('querystring');
const express = require('express');

const router = express.Router();
const subscribe = require('./subscribe');
const unsubscribe = require('./unsubscribe');


const { config, log } = require('../settings');

router.get('/subscriptions', function (request, response) {
	return response.status(405).contentType('text').send('please use POST');
});

router.post('/subscriptions', async function (request, response, next) {

	let mode = request.body['hub.mode'] || null;
	if (mode === null) {
		return response.status(400).contentType('text').send('parameter `hub.mode` required');
	}
	mode = mode.toString("utf8").trim();
	log.info("requested mode: " + mode);

	if (!['subscribe', 'unsubscribe'].find(m => m === mode))
		return response.status(501).contentType('text').send('`hub.mode` not allowed: ' + mode);

	let callback = querystring.unescape(request.body['hub.callback']) || null;
	if (callback === null) {
		return response.status(400).contentType('text').send('parameter `hub.callback` required');
	}
	callback = querystring.unescape(callback.toString("utf8").trim());
	log.debug("callback: " + callback);
	if (callback.length > config.max_url_size) {
		log.error(`callback URL exceeds max size of ${config.max_url_size}: ${callback.length}`);
		return response.status(413).contentType('text').send(`hub.callback URL maximum length is ${config.max_url_size}`);
	}

	let topic = request.body['hub.topic'] || null;
	if (topic === null) {
		return response.status(400).contentType('text').send('parameter hub.topic required');
	}
	topic = querystring.unescape(topic.toString("utf8").trim());
	log.debug("topic: " + topic);
	if (topic.length > config.max_topic_size) {
		log.error(`hub.topic URL exceeds max size of ${config.max_topic_size}: ${topic.length}`);
		return response.status(413).contentType('text').send(`hub.topic URL maximum length is ${config.max_topic_size}`);
	}

	if (!topic.startsWith(config.sta.root_url)) {
		log.error(`no SensorThings service found to support topic ${topic}`);
		return response.status(400).contentType('text').send('`hub.topic` refers to unsupported SensorThings service');
	}

	let root_url = new url.URL(config.sta.root_url);
	let root_path = root_url.pathname;
	log.debug("root_path: " + root_path);

	let topic_url = new url.URL(topic);
	let topic_path = topic_url.pathname;
	log.debug("topic_path: " + topic_path);
	let topic_query = topic_url.search;
	log.debug("topic_query: " + topic_query);

	topic = topic_path.substring(root_path.length);
	if (topic_query !== null) {
		topic += topic_query;
	}
	log.debug("topic: " + topic);

	// process lease_seconds
	let lease_seconds = request.body['hub.lease_seconds'] || null;
	log.debug(`lease_seconds: ${lease_seconds}`);
	if (lease_seconds !== null) {
		lease_seconds = lease_seconds.toString("utf8").trim();
		if (isFinite(lease_seconds) && Number(lease_seconds) % 1 == 0) {
			lease_seconds = Number(lease_seconds);
		} else {
			return response.status(400).contentType('text').send('`hub.lease_seconds` must be a number');
		}
		
	}
	else {
		// default lease_seconds
		log.info("`hub.lease_seconds` set to: " + config.hub.default_lease_seconds);
		lease_seconds = config.hub.default_lease_seconds;
	}
	if (lease_seconds < config.hub.min_lease_seconds) {
		// The hub may adopt the lease_seconds
		log.info("`hub.lease_seconds` set to: " + config.hub.min_lease_seconds);
		lease_seconds = config.hub.min_lease_seconds;
	}
	if (lease_seconds > config.hub.max_lease_seconds) {
		// The hub may adopt the lease_seconds
		log.info("`hub.lease_seconds` set to: " + config.hub.max_lease_seconds);
		lease_seconds = config.hub.max_lease_seconds;
	}
	log.debug("lease_seconds: " + lease_seconds);

	let secret = request.body['hub.secret'] || null;
	if (secret !== null) {
		secret = secret.toString("utf8").trim();

		if (secret.length > 200) {
			log.error("`hub.secret` exceeds limit of 200 bytes");
			return response.status(400).contentType('text').send('parameter `hub.secret` exceeds limit of 200 bytes');
		}
	}
	log.debug("secret: " + secret);

	if (mode === 'subscribe') {
		log.debug('subscribe()');
		// async function that finishes some time later...
		subscribe(topic_url, topic, callback, lease_seconds, secret);
	}
	else {
		log.debug('unsubscribe()');
		// async function that finishes some time later...
		unsubscribe(topic_url, topic, callback);
	}

	// Return HTTP 202 on successful subscription
	response.status(202).contentType('text').send(`request for ${mode} accepted`);

});

module.exports = router;
