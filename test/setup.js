/*
 * Mocha root hook: load test environment variables before any test file runs.
 * Loads test/.env if it exists, otherwise falls back to test/.env.example,
 * so tests work out of the box without requiring a manual copy step.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const envFile = path.resolve(__dirname, ".env");
const exampleFile = path.resolve(__dirname, ".env.example");

const file = fs.existsSync(envFile) ? envFile : exampleFile;
dotenv.config({ path: file });
