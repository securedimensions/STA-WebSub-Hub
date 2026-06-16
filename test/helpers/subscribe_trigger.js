/*
Trigger a WebSub subscribe request against the hub.

Usage:
  node test/helpers/subscribe_trigger.js --topic ABC --callback http://subscriber:8081/accepted/ABC
*/

"use strict";

const querystring = require("querystring");
const { request } = require("urllib");

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i += 1) {
        const a = argv[i];
        if (!a.startsWith("--")) continue;
        const k = a.slice(2);
        const v = argv[i + 1];
        out[k] = v;
        i += 1;
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv);

    const hubUrl = args.hub || "http://localhost:4000/api/subscriptions";
    const staRoot = args.staRoot || "http://publisher/";
    const topic = args.topic || "ABC";
    const callback = args.callback || `http://subscriber:8081/accepted/${topic}`;
    const lease = args.lease || "60";

    const body = querystring.stringify({
        "hub.mode": "subscribe",
        "hub.topic": new URL(topic, staRoot).toString(),
        "hub.callback": callback,
        "hub.lease_seconds": lease,
    });

    const res = await request(hubUrl, {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        content: body,
    });

    process.stdout.write(res.data.toString("utf8") + "\n");
    process.exit(res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(2);
});

