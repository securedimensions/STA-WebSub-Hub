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
const { topicFromDb } = require("./helpers/topic_key");
const { startMqttCommandListener } = require("./helpers/mqtt/commands");
const mqttRegistry = require("./helpers/mqtt/registry");
const { getQueue } = require("./helpers/queue/producer");
const { getQueueStats } = require("./helpers/queue/stats");
const metrics = require("./helpers/metrics");
const { startOpsServer } = require("./helpers/ops/server");

metrics.setRole("ingest");

let mqttCmdSub = null;
let statsTimer = null;
let opsServer = null;

function subscribeMqttTopic(topic, source) {
    log.debug(`MQTT subscribe request (${source}): topic="${topic}" connected=${mqtt_client.connected}`);
    mqtt_client.subscribe(topic, (err, granted) => {
        mqttRegistry.recordSubscribe(topic, { source, err, granted });
    });
}

function unsubscribeMqttTopic(topic, source) {
    log.debug(`MQTT unsubscribe request (${source}): topic="${topic}" connected=${mqtt_client.connected}`);
    mqtt_client.unsubscribe(topic, (err) => {
        mqttRegistry.recordUnsubscribe(topic, { source, err });
    });
}

async function subscribeToAllTopicsFromDb() {
    const client = await pool.connect();
    const query = new Query("SELECT topic from topics");
    const result = client.query(query);
    assert.equal(query, result);

    let topicCount = 0;

    query
        .on("row", (row) => {
            topicCount += 1;
            const topic = topicFromDb(row.topic);
            log.debug(`DB topic row raw="${row.topic}" mqtt="${topic}"`);
            subscribeMqttTopic(topic, "startup-db");
        })
        .on("end", () => {
            client.release();
            log.info(`Ingest ready! loaded ${topicCount} topic(s) from database for MQTT subscribe`);
        })
        .on("error", (error) => {
            client.release();
            log.error("init MQTT subscriptions error: ", error);
        });
}

async function startCommandListener() {
    mqttCmdSub = await startMqttCommandListener(async (cmd) => {
        if (cmd.action === "subscribe") {
            subscribeMqttTopic(cmd.topic, "redis-command");
        } else if (cmd.action === "unsubscribe") {
            unsubscribeMqttTopic(cmd.topic, "redis-command");
        }
    });
    log.info("MQTT command listener ready (redis channel mqtt:commands)");
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
        log.info(`Connected to MQTT broker ${config.sta.mqtt_url} (publisher ${config.sta.root_url})`);
        await startCommandListener();
        await subscribeToAllTopicsFromDb();
        startQueueStatsLogger();
    })
    .on("reconnect", () => {
        log.info(`Reconnecting to MQTT broker ${config.sta.mqtt_url}`);
    })
    .on("disconnect", () => {
        log.info(`Disconnected from MQTT broker ${config.sta.mqtt_url}`);
    })
    .on("close", () => {
        log.info(`MQTT connection closed (${config.sta.mqtt_url})`);
    })
    .on("error", (err) => {
        log.error(`MQTT client error: ${err.message}`);
    })
    .on("offline", () => {
        log.warn(`MQTT client offline (${config.sta.mqtt_url})`);
    })
    .on("message", (topic, message) => {
        log.debug(`MQTT message received: topic="${topic}" bytes=${message.length}`);

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

            enqueueNotification(topic, message.toString())
                .then(() => {
                    log.debug(`notification enqueued: topic="${topic}" bytes=${message.length}`);
                })
                .catch((err) => {
                    log.error(`failed to enqueue notification for ${topic}: ${err.message}`);
                });
        } catch (e) {
            log.error(`payload not JSON format for topic="${topic}": ${e}`);
        }
    });

opsServer = startOpsServer({
    role: "ingest",
    getHealth: async () => ({
        ok: mqtt_client.connected === true,
        role: "ingest",
        checks: { mqtt: mqtt_client.connected === true },
    }),
    getMetrics: async () => ({
        role: "ingest",
        at: new Date().toISOString(),
        queue: await getQueueStats(),
        mqtt: {
            connected: mqtt_client.connected,
            broker: config.sta.mqtt_url,
            ...mqttRegistry.snapshot(),
        },
        process: metrics.snapshot(),
    }),
});

async function shutdown(signal) {
    log.info(`ingest process received ${signal}`);
    if (statsTimer) {
        clearInterval(statsTimer);
        statsTimer = null;
    }
    if (opsServer) {
        opsServer.close();
        opsServer = null;
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
