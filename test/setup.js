/*
 * Mocha root hook: load a local test/.env override if present.
 *
 * All required env vars are baked into docker-compose.yaml, so this file
 * is a no-op in the normal dockerised test run. It exists solely to allow
 * local overrides via test/.env without committing them.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const envFile = path.resolve(__dirname, ".env");
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
}
