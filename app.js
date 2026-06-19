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

const express = require('express');
const parseHttpHeader = require('parse-http-header');
const path = require('path');
const favicon = require('serve-favicon');

const rateLimit = require('express-rate-limit');
const subscriptions = require('./routes/subscriptions');
const ops = require('./routes/ops');
const metrics = require('./helpers/metrics');
const { config, log } = require('./settings');
const { requireOpsToken } = require('./helpers/security/ops_auth');

metrics.setRole('api');

const subscriptionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many subscription requests, please try again later'
});

const app = express();
app.use(function (req, res, next) {
  
  if (['PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    return res.status(405).contentType('text').send('method not implemented');
  }

  if (req.method === 'POST') {
    if (req.header('content-type') === undefined) {
      log.error("request has no content-type header");
      return res.status(415).contentType('text').send('content type header missing');
    }

    let content_type = parseHttpHeader(req.headers['content-type'])[0];
    log.debug(`content-type: ${content_type}`);

    if (content_type !== 'application/x-www-form-urlencoded') {
      log.error("request has wrong content-type: " + content_type);
      return res.status(415).contentType('text').send('content type must be `application/x-www-form-urlencoded`');
    }

    let charset = parseHttpHeader(req.headers['content-type'])['charset'];
    log.debug(`encoding: ${charset}`);

    if (config.hub.enforce_UTF8) {
      if (charset === undefined) {
        log.error("request has no charset defined in the content-type header");
        return res.status(415).contentType('text').send('charset missing in the content type header');
      }

      if (charset.toLowerCase() !== 'utf-8') {
        log.error("request has wrong charset: " + charset);
        return res.status(415).contentType('text').send('charset encoding must be `utf-8`');
      }
    }
  }
  next();
})

app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(express.urlencoded({ extended: true, limit: config.max_request_size }));
app.use(express.static(path.join(__dirname, 'public')));

// WebSub API
app.use('/api/subscriptions', subscriptionLimiter);
app.use('/api', subscriptions);
app.use('/ops', requireOpsToken, ops);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  let err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function (err, req, res, next) {
  log.error(err);
  const isDev = req.app.get('env') === 'development';
  const body = isDev
    ? { error: err.message, stack: err.stack }
    : { error: 'Internal Server Error' };
  res.status(err.status || 500).json(body);
});

module.exports = app;