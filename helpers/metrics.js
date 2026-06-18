/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const state = {
    role: "unknown",
    jobsCompleted: 0,
    jobsFailed: 0,
    postsSucceeded: 0,
    postsFailed: 0,
    postsSkippedCircuit: 0,
    enqueued: 0,
    enqueueRejected: 0,
    enqueueDroppedNoSubs: 0,
    jobsSkippedNoSubs: 0,
};

function setRole(role) {
    state.role = role;
}

function inc(field, amount = 1) {
    state[field] = (state[field] || 0) + amount;
}

function snapshot() {
    return { ...state };
}

module.exports = { setRole, inc, snapshot };
