/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { config } = require("../../settings");

// In-memory circuit breaker per callback URL.
// This is per delivery-process instance; Phase 3 keeps it simple.

const stateByCallback = new Map();

function nowMs() {
    return Date.now();
}

function getState(callback) {
    const existing = stateByCallback.get(callback);
    if (existing) {
        return existing;
    }

    const created = {
        openUntilMs: 0,
        failures: [], // array of timestamps (ms)
    };
    stateByCallback.set(callback, created);
    return created;
}

function pruneFailures(state, windowMs, now) {
    if (state.failures.length === 0) return;
    const cutoff = now - windowMs;
    while (state.failures.length > 0 && state.failures[0] < cutoff) {
        state.failures.shift();
    }
}

function isOpen(callback) {
    const state = getState(callback);
    return state.openUntilMs > nowMs();
}

function recordSuccess(callback) {
    const state = getState(callback);
    state.failures = [];
    state.openUntilMs = 0;
}

function recordFailure(callback) {
    const state = getState(callback);
    const now = nowMs();

    const windowMs = config.circuit.windowMs;
    pruneFailures(state, windowMs, now);
    state.failures.push(now);

    if (state.failures.length >= config.circuit.failureThreshold) {
        state.openUntilMs = now + config.circuit.openDurationMs;
        state.failures = [];
    }
}

module.exports = { isOpen, recordSuccess, recordFailure };

