/*
 * Mocha root hook: load test environment variables before any test file runs.
 *
 * Inside the docker test-runner all env vars are injected by docker-compose,
 * so dotenv is a no-op (it never overrides already-set variables).
 * When running tests on the host directly, test/.env (or test/.env.example
 * as fallback) is loaded so the same settings are available.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const envFile = path.resolve(__dirname, ".env");
const exampleFile = path.resolve(__dirname, ".env.example");

if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
} else if (fs.existsSync(exampleFile)) {
    dotenv.config({ path: exampleFile });
}
