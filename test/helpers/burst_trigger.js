/*
Trigger a publisher burst for load testing.

Usage:
  node test/helpers/burst_trigger.js --topic "ABC" --rate 1000 --seconds 5
*/

"use strict";

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
    const topic = args.topic || "ABC";
    const rate = args.rate || "1000";
    const seconds = args.seconds || "5";
    const baseUrl = args.publisher || "http://localhost:8181";

    const url = `${baseUrl}/burst/${encodeURIComponent(topic)}?rate=${encodeURIComponent(
        rate
    )}&seconds=${encodeURIComponent(seconds)}`;

    const res = await request(url, { method: "POST" });
    process.stdout.write(res.data.toString("utf8") + "\n");
    process.exit(res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(2);
});

