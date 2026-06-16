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

const querystring = require('querystring');
const { Pool } = require('pg');
const { config, log } = require('../settings');

const subscription_state = Object.freeze({
    ACTIVE: "active",
    INACTIVE: "inactive",
    UPDATED: "updated",
    DISABLED: "disabled"
});

const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectionTimeoutMillis: 0,
    idleTimeoutMillis: 0,
    min: 10,
    max: 20,
});

let loadAllSubscriptions = async function () {
    const sql_query = `
        SELECT t.topic, s.id, s.callback, s.secret, s.duration, s.status, s.topic_id
        FROM subscriptions s
        JOIN topics t ON t.id = s.topic_id
        WHERE s.status != $1`;
    const result = await pool.query(sql_query, [subscription_state.DISABLED]);
    return result.rows;
}

let getTopics = async function () {
    let sql_query = `SELECT * from topics`;

    const result = await pool.query(sql_query);
    if (result.rowCount === 0) {
        log.debug('no topics found');
        return [];
    }

    return result.rows;
}

let clearAll = async function () {
    // Test/maintenance helper: remove all topics and subscriptions
    await pool.query('TRUNCATE TABLE subscriptions, topics RESTART IDENTITY CASCADE');
}

let numSubscriptions = async function (topic) {
    topic = querystring.escape(topic);
    // topic is not enforced unique in the DB schema, so count across all matching topic rows
    let sql_query = `SELECT count(*)::int from subscriptions WHERE topic_id IN (SELECT id FROM topics WHERE topic = $1)`;
    let sql_values = [topic];

    let result = await pool.query(sql_query, sql_values);
    return result.rows[0].count;
}

let getSubscriptions = async function (topic) {
    topic = querystring.escape(topic);
    const sql_query = `
        SELECT s.id, s.callback, s.secret, s.duration, s.status, s.topic_id
        FROM subscriptions s
        JOIN topics t ON t.id = s.topic_id
        WHERE t.topic = $1`;
    const sql_values = [topic];

    const result = await pool.query(sql_query, sql_values);
    if (result.rowCount === 0) {
        log.debug('topic not found: ' + topic);
        return [];
    }

    return result.rows;
}

let insertSubscription = async function (topic_url, topic, callback, lease_seconds, secret) {
    topic_url = querystring.escape(topic_url);
    topic = querystring.escape(topic);
    const client = await pool.connect()

    try {
        await client.query('BEGIN')

        let result = await client.query('SELECT id from topics WHERE topic_url = $1', [topic_url]);
        if (result.rowCount === 0) {
            try {
                result = await client.query(
                    'INSERT INTO topics (topic_url, topic) VALUES($1, $2) RETURNING id',
                    [topic_url, topic]
                );
            } catch (e) {
                if (e.code === '23505') {
                    result = await client.query('SELECT id from topics WHERE topic_url = $1', [topic_url]);
                } else {
                    throw e;
                }
            }
        }

        const topic_id = result.rows[0].id;
        log.debug(`topic_id: ${topic_id}`);

        const date = new Date();
        const duration = lease_seconds + Math.round(date.getTime() / 1000);

        result = await client.query(
            'SELECT id FROM subscriptions WHERE topic_id = $1 AND callback = $2',
            [topic_id, callback]
        );

        if (result.rowCount === 0) {
            const sql_query = 'INSERT INTO subscriptions (secret, callback, created, duration, topic_id, status) VALUES ($1, $2, $3, $4, $5, $6)';
            const sql_values = [secret, callback, date.toISOString(), duration, topic_id, subscription_state.ACTIVE];
            await client.query(sql_query, sql_values);
        } else {
            const sql_query = 'UPDATE subscriptions SET secret = $1, updated = $3, duration = $4, status = $5 WHERE topic_id = $2 AND callback = $6';
            const sql_values = [secret, topic_id, date.toISOString(), duration, subscription_state.ACTIVE, callback];
            await client.query(sql_query, sql_values);
        }

        await client.query('COMMIT')

    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
}

let updateSubscription = async function (topic_id, callback, lease_seconds, secret) {
    const client = await pool.connect()

    try {
        const date = new Date();
        const duration = lease_seconds + Math.round(date.getTime() / 1000);

        await client.query('BEGIN')
        const sql_query = 'UPDATE subscriptions SET secret = ($1), updated = ($4), duration = ($5), status = ($6) WHERE topic_id = $3 AND callback = $2';
        const sql_values = [secret, callback, topic_id, date.toISOString(), duration, subscription_state.UPDATED];
        client.query(sql_query, sql_values);
        await client.query('COMMIT')
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
}

let activateSubscription = async function (callback) {
    const client = await pool.connect()

    try {
        await client.query('BEGIN')
        const sql_query = 'UPDATE subscriptions SET status = ($2) WHERE callback = $1';
        const sql_values = [callback, subscription_state.ACTIVE];
        client.query(sql_query, sql_values);
        await client.query('COMMIT')
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
}

let deactivateSubscription = async function (callback) {
    const client = await pool.connect()

    try {
        await client.query('BEGIN')
        const sql_query = 'UPDATE subscriptions SET status = ($2) WHERE callback = $1';
        const sql_values = [callback, subscription_state.INACTIVE];
        client.query(sql_query, sql_values);
        await client.query('COMMIT')
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
}

let disableSubscription = async function (callback) {
    const client = await pool.connect()

    try {
        await client.query('BEGIN')
        const sql_query = 'UPDATE subscriptions SET status = ($2) WHERE callback = $1';
        const sql_values = [callback, subscription_state.DISABLED];
        client.query(sql_query, sql_values);
        await client.query('COMMIT')
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
}

let deleteSubscription = async function (topic, callback) {
    topic = querystring.escape(topic);
    const client = await pool.connect()

    try {
        await client.query('BEGIN')
        // topic is not enforced unique in the DB schema, so delete across all matching topic rows
        const sql_query = 'DELETE FROM subscriptions WHERE topic_id IN (SELECT id from topics WHERE topic = $1) AND callback = $2';
        const sql_values = [topic, callback];
        client.query(sql_query, sql_values);
        await client.query('COMMIT')
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
}


module.exports = { pool, subscription_state, clearAll, numSubscriptions, getSubscriptions, getSubscriptions, insertSubscription, updateSubscription, deleteSubscription, disableSubscription, activateSubscription, deactivateSubscription, getTopics, loadAllSubscriptions }