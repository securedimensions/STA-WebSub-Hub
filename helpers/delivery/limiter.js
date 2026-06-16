/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const { config } = require("../../settings");

class Semaphore {
    constructor(max) {
        this.max = max;
        this.current = 0;
        this.waiters = [];
    }

    acquire() {
        if (this.current < this.max) {
            this.current += 1;
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            this.waiters.push(resolve);
        });
    }

    release() {
        this.current -= 1;
        if (this.waiters.length > 0) {
            this.current += 1;
            const next = this.waiters.shift();
            next();
        }
    }
}

const semaphores = new Map();

function getSemaphore(callback) {
    let sem = semaphores.get(callback);
    if (!sem) {
        sem = new Semaphore(config.delivery.perCallbackConcurrency);
        semaphores.set(callback, sem);
    }
    return sem;
}

async function withCallbackLimit(callback, fn) {
    const sem = getSemaphore(callback);
    await sem.acquire();
    try {
        return await fn();
    } finally {
        sem.release();
    }
}

module.exports = { withCallbackLimit };
