/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const mqtt_client = require("./helpers/mqtt_client");
const { enqueueNotification } = require("./helpers/queue/producer");
const { config, log } = require("./settings");
const { pool } = require("./helpers/db");
const { Query } = require("pg");
const assert = require("assert");
const querystring = require("querystring");
const { startMqttCommandListener } = require("./helpers/mqtt/commands");
const { getQueue } = require("./helpers/queue/producer");

let mqttCmdSub = null;
let statsTimer = null;

async function subscribeToAllTopicsFromDb() {
    const client = await pool.connect();
    const query = new Query("SELECT topic from topics");
    const result = client.query(query);
    assert.equal(query, result);

    query
        .on("row", (row) => {
            const topic = querystring.unescape(row.topic);
            log.info("Subscribing to MQTT topic: ", topic);
            mqtt_client.subscribe(topic, (err, granted) => {
                if (err !== null) log.error(err);
                if (granted !== null) log.debug(granted[0]);
            });
        })
        .on("end", () => {
            client.release();
            log.info("Ingest ready!");
        })
        .on("error", (error) => {
            client.release();
            log.error("init MQTT subscriptions error: ", error);
        });
}

async function startCommandListener() {
    mqttCmdSub = await startMqttCommandListener(async (cmd) => {
        if (cmd.action === "subscribe") {
            mqtt_client.subscribe(cmd.topic, (err) => {
                if (err) log.error(err);
            });
        } else if (cmd.action === "unsubscribe") {
            mqtt_client.unsubscribe(cmd.topic, (err) => {
                if (err) log.error(err);
            });
        }
    });
}

function startQueueStatsLogger() {
    const intervalMs = parseInt(process.env.HUB_STATS_INTERVAL_MS || "0", 10);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        return;
    }

    const queue = getQueue();
    statsTimer = setInterval(async () => {
        try {
            const waiting = await queue.getWaitingCount();
            const active = await queue.getActiveCount();
            const failed = await queue.getFailedCount();
            const delayed = await queue.getDelayedCount();
            log.info(
                `queue stats: waiting=${waiting} active=${active} delayed=${delayed} failed=${failed}`
            );
        } catch (e) {
            log.error(`queue stats error: ${e.message}`);
        }
    }, intervalMs);
}

mqtt_client
    .on("connect", async () => {
        log.info(`Connected to Publisher ${config.sta.root_url}`);
        await startCommandListener();
        await subscribeToAllTopicsFromDb();
        startQueueStatsLogger();
    })
    .on("disconnect", () => {
        log.info(`Disconnected from Publisher ${config.sta.root_url}`);
    })
    .on("close", () => {
        log.info(`Publisher ${config.sta.root_url} closed MQTT connection`);
    })
    .on("message", (topic, message) => {
        if (message.length > config.max_content_size) {
            log.error(
                `rejecting content delivery as size exceeds limit of ${config.max_content_size}`
            );
            return;
        }

        try {
            if (config.hub.enforce_JSON) {
                JSON.parse(message.toString());
            }

            enqueueNotification(topic, message.toString()).catch((err) => {
                log.error(`failed to enqueue notification for ${topic}: ${err.message}`);
            });
        } catch (e) {
            log.error(`payload not JSON format: ${e}`);
        }
    });

async function shutdown(signal) {
    log.info(`ingest process received ${signal}`);
    if (statsTimer) {
        clearInterval(statsTimer);
        statsTimer = null;
    }
    try {
        if (mqttCmdSub) {
            await mqttCmdSub.quit();
        }
    } catch (_e) {
        // ignore
    }
    mqtt_client.end(true, () => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

