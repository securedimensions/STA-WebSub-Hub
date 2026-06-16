/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const http = require("http");
const { log } = require("../../settings");

function startOpsServer({ role, getHealth, getMetrics }) {
    const port = parseInt(process.env.HUB_OPS_PORT || "0", 10);
    if (!Number.isFinite(port) || port <= 0) {
        return null;
    }

    const server = http.createServer(async (req, res) => {
        const path = req.url?.split("?")[0];

        try {
            if (req.method === "GET" && path === "/health") {
                const health = await getHealth();
                res.writeHead(health.ok ? 200 : 503, { "content-type": "application/json" });
                res.end(JSON.stringify(health));
                return;
            }

            if (req.method === "GET" && path === "/metrics") {
                const metrics = await getMetrics();
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify(metrics));
                return;
            }

            res.writeHead(404, { "content-type": "text/plain" });
            res.end("not found");
        } catch (e) {
            log.error(`ops server error: ${e.message}`);
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
        }
    });

    server.listen(port, () => {
        log.info(`${role} ops listening on port ${port}`);
    });

    return server;
}

module.exports = { startOpsServer };
