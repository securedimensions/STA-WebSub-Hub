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

const { log } = require("./settings");

const mode = (process.env.HUB_MODE || "all").toLowerCase();

async function main() {
    if (mode === "api") {
        require("./server-api");
        return;
    }

    if (mode === "ingest") {
        require("./server-ingest");
        return;
    }

    if (mode === "delivery") {
        require("./server-delivery");
        return;
    }

    if (mode !== "all") {
        throw new Error(`unknown HUB_MODE: ${mode}`);
    }

    // all-in-one dev mode: run all roles in one process
    require("./server-api");
    require("./server-ingest");
    require("./server-delivery");
    log.info("hub running in HUB_MODE=all");
}

main().catch((err) => {
    log.error(`failed to start hub: ${err.message}`);
    process.exit(1);
});
