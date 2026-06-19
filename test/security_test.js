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
const { pool } = require('../helpers/db');
const db = require('../helpers/db');

const HUB_BASE = `http://localhost:${config.hub.port}`;
const OPS_BASE = `${HUB_BASE}/ops`;
const OPS_TOKEN = process.env.HUB_OPS_TOKEN || '';
const STA_ROOT_URL = process.env.STA_ROOT_URL || config.sta.root_url;

// ---------------------------------------------------------------------------
// V-01 — OPS endpoint authentication
// ---------------------------------------------------------------------------

describe('V-01 — OPS endpoint authentication', () => {

    it('GET /ops/health without token → 401', function (done) {
        http_client.get(`${OPS_BASE}/health`, {}, (err, res) => {
            try {
                assert.equal(res.statusCode, 401, 'expected 401 without ops token');
                done();
            } catch (e) { done(e); }
        });
    });

    it('GET /ops/health with wrong token → 401', function (done) {
        http_client.get(`${OPS_BASE}/health`, { 'x-ops-token': 'wrong-token' }, (err, res) => {
            try {
                assert.equal(res.statusCode, 401, 'expected 401 with wrong ops token');
                done();
            } catch (e) { done(e); }
        });
    });

    it('GET /ops/health with correct token → 200', function (done) {
        http_client.get(`${OPS_BASE}/health`, { 'x-ops-token': OPS_TOKEN }, (err, res) => {
            try {
                assert.equal(res.statusCode, 200, 'expected 200 with correct ops token');
                done();
            } catch (e) { done(e); }
        });
    });

    it('GET /ops/metrics without token → 401', function (done) {
        http_client.get(`${OPS_BASE}/metrics`, {}, (err, res) => {
            try {
                assert.equal(res.statusCode, 401, 'expected 401 without ops token on /metrics');
                done();
            } catch (e) { done(e); }
        });
    });

    it('GET /ops/metrics with correct token → 200', function (done) {
        http_client.get(`${OPS_BASE}/metrics`, { 'x-ops-token': OPS_TOKEN }, (err, res) => {
            try {
                assert.equal(res.statusCode, 200, 'expected 200 with correct ops token on /metrics');
                done();
            } catch (e) { done(e); }
        });
    });

    it('GET /ops/failed without token → 401', function (done) {
        http_client.get(`${OPS_BASE}/failed`, {}, (err, res) => {
            try {
                assert.equal(res.statusCode, 401, 'expected 401 without ops token on /failed');
                done();
            } catch (e) { done(e); }
        });
    });

    it('POST /ops/failed/purge without token → 401', function (done) {
        http_client.post(
            `${OPS_BASE}/failed/purge?confirm=true`,
            { 'content-type': 'application/x-www-form-urlencoded' },
            {},
            (err, res) => {
                try {
                    assert.equal(res.statusCode, 401, 'expected 401 on purge without token');
                    done();
                } catch (e) { done(e); }
            }
        );
    });
});

// ---------------------------------------------------------------------------
// V-04 — Rate limiting on subscription endpoint
// ---------------------------------------------------------------------------

describe('V-04 — Rate limiting on subscription endpoint', function () {
    // This test sends 65 rapid requests; the 61st onward should be rejected.
    this.timeout(30000);

    it('POST /api/subscriptions → 429 after exceeding 60 requests/min', function (done) {
        const url = config.hub.url;
        const headers = { 'content-type': 'application/x-www-form-urlencoded' };
        // Deliberately malformed body (returns 400 fast, no side-effects)
        const body = { 'hub.mode': 'subscribe' };

        let completed = 0;
        let got429 = false;
        const TOTAL = 65;

        function onResponse(err, res) {
            completed++;
            if (res && res.statusCode === 429) {
                got429 = true;
            }
            if (completed === TOTAL) {
                try {
                    assert.ok(got429, 'expected at least one 429 after exceeding rate limit');
                    done();
                } catch (e) { done(e); }
            }
        }

        for (let i = 0; i < TOTAL; i++) {
            http_client.post(url, headers, body, onResponse);
        }
    });
});

// ---------------------------------------------------------------------------
// V-08 — hub.secret encrypted at rest in PostgreSQL
// ---------------------------------------------------------------------------

describe('V-08 — hub.secret encrypted at rest', () => {
    const topic = 'security-secret-test';
    const secret = 'super-secret-value';
    const callback = `http://subscriber:8081/accepted/${topic}`;

    before('clear subscriptions', async function () {
        await db.clearAll();
    });

    after('clear subscriptions', async function () {
        await db.clearAll();
    });

    it('subscribe with hub.secret → subscription stored and activated', function (done) {
        const params = {
            'hub.mode': 'subscribe',
            'hub.secret': secret,
            'hub.callback': callback,
            'hub.topic': `${STA_ROOT_URL}/${topic}`,
        };

        http_client.post(config.hub.url, {}, params, async (err, res) => {
            try {
                assert.equal(res.statusCode, 202, 'expected 202 Accepted');

                // Poll until subscription is stored (async intent validation)
                const startedAt = Date.now();
                const poll = async () => {
                    const count = await db.numSubscriptions(topic);
                    if (count >= 1) { done(); return; }
                    if (Date.now() - startedAt > 8000) {
                        done(new Error('timed out waiting for subscription to be stored'));
                        return;
                    }
                    setTimeout(poll, 200);
                };
                poll();
            } catch (e) { done(e); }
        });
    });

    it('stored secret value is encrypted (enc:v1: prefix) when HUB_SECRET_KEY is set', async function () {
        if (!process.env.HUB_SECRET_KEY) {
            this.skip();
        }

        // Query the raw DB value — bypasses the decryption layer in db.js
        const result = await pool.query(
            `SELECT s.secret FROM subscriptions s
             JOIN topics t ON t.id = s.topic_id
             WHERE t.topic LIKE $1`,
            [`%${topic}%`]
        );

        assert.ok(result.rowCount > 0, 'expected at least one subscription row');
        const storedSecret = result.rows[0].secret;
        assert.ok(
            storedSecret.startsWith('enc:v1:'),
            `expected stored secret to start with 'enc:v1:' but got: ${storedSecret.slice(0, 20)}…`
        );
    });

    it('decrypted secret round-trips correctly', async function () {
        if (!process.env.HUB_SECRET_KEY) {
            this.skip();
        }

        const { decryptSecret } = require('../helpers/security/secret_crypto');

        const result = await pool.query(
            `SELECT s.secret FROM subscriptions s
             JOIN topics t ON t.id = s.topic_id
             WHERE t.topic LIKE $1`,
            [`%${topic}%`]
        );

        assert.ok(result.rowCount > 0, 'expected at least one subscription row');
        const storedSecret = result.rows[0].secret;
        const decrypted = decryptSecret(storedSecret);
        assert.equal(decrypted, secret, 'decrypted secret must equal the original plaintext');
    });

    it('plaintext secret stored as-is when HUB_SECRET_KEY is not set', async function () {
        if (process.env.HUB_SECRET_KEY) {
            this.skip();
        }

        const result = await pool.query(
            `SELECT s.secret FROM subscriptions s
             JOIN topics t ON t.id = s.topic_id
             WHERE t.topic LIKE $1`,
            [`%${topic}%`]
        );

        assert.ok(result.rowCount > 0, 'expected at least one subscription row');
        const storedSecret = result.rows[0].secret;
        assert.equal(storedSecret, secret, 'without HUB_SECRET_KEY secret should be plaintext');
    });
});

// ---------------------------------------------------------------------------
// V-09 — Content-Type null-check (fixed: missing header now correctly → 415)
// ---------------------------------------------------------------------------

describe('V-09 — Content-Type enforcement', () => {

    it('POST /api/subscriptions with no Content-Type header → 415', function (done) {
        http_client.post(config.hub.url, {}, null, (err, res) => {
            try {
                assert.equal(res.statusCode, 415, 'expected 415 when Content-Type header is absent');
                done();
            } catch (e) { done(e); }
        });
    });

    it('POST /api/subscriptions with Content-Type: application/json → 415', function (done) {
        http_client.post(
            config.hub.url,
            { 'content-type': 'application/json' },
            null,
            (err, res) => {
                try {
                    assert.equal(res.statusCode, 415, 'expected 415 for unsupported content type');
                    done();
                } catch (e) { done(e); }
            }
        );
    });
});

// ---------------------------------------------------------------------------
// V-11 — Security HTTP response headers (helmet)
// ---------------------------------------------------------------------------

describe('V-11 — Security HTTP response headers', () => {

    it('response includes X-Content-Type-Options: nosniff', function (done) {
        http_client.get(HUB_BASE, {}, (err, res) => {
            try {
                assert.equal(
                    res.headers['x-content-type-options'],
                    'nosniff',
                    'expected X-Content-Type-Options: nosniff'
                );
                done();
            } catch (e) { done(e); }
        });
    });

    it('response includes X-Frame-Options header', function (done) {
        http_client.get(HUB_BASE, {}, (err, res) => {
            try {
                assert.ok(
                    res.headers['x-frame-options'],
                    'expected X-Frame-Options header to be present'
                );
                done();
            } catch (e) { done(e); }
        });
    });

    it('response does not include X-Powered-By header', function (done) {
        http_client.get(HUB_BASE, {}, (err, res) => {
            try {
                assert.equal(
                    res.headers['x-powered-by'],
                    undefined,
                    'expected X-Powered-By header to be absent'
                );
                done();
            } catch (e) { done(e); }
        });
    });
});
