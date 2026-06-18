/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

require("dotenv").config();

const db = require("../helpers/db");
const { publishReload } = require("../helpers/cache/invalidation");
const { maybeUnsubscribeTopic } = require("../helpers/mqtt/lifecycle");
const { log } = require("../settings");

async function main() {
    const { deleted, topics } = await db.deleteExpiredSubscriptions();

    log.info(`removed ${deleted} expired subscription(s) from database`);

    for (const topic of topics) {
        if ((await db.numSubscriptions(topic)) === 0) {
            log.info(`no subscriptions remain for topic: ${topic}`);
            await maybeUnsubscribeTopic(topic);
        }
    }

    if (deleted > 0) {
        await publishReload();
        log.info("published cache reload to delivery workers");
    }
}

main()
    .then(() => db.pool.end())
    .catch((err) => {
        log.error(`expired subscription cleanup failed: ${err.message}`);
        db.pool.end().finally(() => process.exit(1));
    });
