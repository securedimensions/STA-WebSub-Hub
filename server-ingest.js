/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const mqtt_client = require("./helpers/mqtt_client");
const { enqueueNotification } = require("./helpers/queue/producer");
const { config, log } = require("./settings");
const topicActivity = require("./helpers/mqtt/topic_activity");
const { startMqttCommandListener } = require("./helpers/mqtt/commands");
const mqttRegistry = require("./helpers/mqtt/registry");
const { getQueue } = require("./helpers/queue/producer");
const { getQueueStats } = require("./helpers/queue/stats");
const metrics = require("./helpers/metrics");
const throughput = require("./helpers/throughput");
const { startOpsServer } = require("./helpers/ops/server");
const { startLeaseSweep } = require("./helpers/mqtt/lease_sweep");

metrics.setRole("ingest");

let mqttCmdSub = null;
let statsTimer = null;
let leaseSweepTimer = null;
let opsServer = null;
let mqttSessionReady = false;

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

async function bootstrapMqttSubscriptions(isReconnect) {
    const topics = isReconnect
        ? await topicActivity.listActiveTopics()
        : await topicActivity.syncActiveFromDb();
    const source = isReconnect ? "mqtt-reconnect" : "startup-db";

    for (const topic of topics) {
        log.debug(`active subscription topic mqtt="${topic}"`);
        subscribeMqttTopic(topic, source);
    }

    if (isReconnect) {
        log.info(`MQTT reconnect: resubscribed to ${topics.length} topic(s) with active leases`);
    } else {
        log.info(`Ingest ready! subscribed to ${topics.length} topic(s) with active subscriptions`);
    }
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

function startLeaseSweepTimer() {
    if (leaseSweepTimer !== null) {
        return;
    }

    const intervalMs = parseInt(process.env.HUB_LEASE_SWEEP_INTERVAL_MS || "2000", 10);
    leaseSweepTimer = startLeaseSweep({
        intervalMs,
        getStillSubscribedTopics: () =>
            mqttRegistry.snapshot().topics.map((entry) => entry.topic),
    });

    if (leaseSweepTimer !== null) {
        log.info(`lease sweep enabled every ${intervalMs} ms`);
    }
}

mqtt_client
    .on("connect", async () => {
        const isReconnect = mqttSessionReady;
        mqttSessionReady = true;
        log.info(
            `${isReconnect ? "Reconnected" : "Connected"} to MQTT broker ${config.sta.mqtt_url} (publisher ${config.sta.root_url})`
        );
        if (mqttCmdSub === null) {
            await startCommandListener();
        }
        await bootstrapMqttSubscriptions(isReconnect);
        if (statsTimer === null) {
            startQueueStatsLogger();
        }
        startLeaseSweepTimer();
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
    getMetrics: async () => {
        const [queue, globalThroughput] = await Promise.all([
            getQueueStats(),
            throughput.getGlobalSnapshot(),
        ]);
        return {
            role: "ingest",
            at: new Date().toISOString(),
            queue,
            throughput: {
                ...globalThroughput,
                local: throughput.getLocalSnapshot(),
            },
            mqtt: {
                connected: mqtt_client.connected,
                broker: config.sta.mqtt_url,
                ...mqttRegistry.snapshot(),
            },
            process: metrics.snapshot(),
        };
    },
});

async function shutdown(signal) {
    log.info(`ingest process received ${signal}`);
    if (statsTimer) {
        clearInterval(statsTimer);
        statsTimer = null;
    }
    if (leaseSweepTimer) {
        clearInterval(leaseSweepTimer);
        leaseSweepTimer = null;
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
