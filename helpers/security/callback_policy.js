/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const dns = require("dns").promises;
const net = require("net");
const { config } = require("../../settings");

const cache = new Map(); // hostname -> { ok: boolean, expiresAt: number, reason?: string }

function hasControlChars(s) {
    return typeof s === "string" && (s.includes("\r") || s.includes("\n"));
}

function normalizeCallbackUrl(callback) {
    if (typeof callback !== "string") {
        throw new Error("hub.callback must be a string");
    }
    if (hasControlChars(callback)) {
        throw new Error("hub.callback contains invalid control characters");
    }

    let u;
    try {
        u = new URL(callback);
    } catch (_e) {
        throw new Error("hub.callback must be an absolute URL");
    }

    const proto = u.protocol.toLowerCase();
    if (proto === "https:") {
        return u;
    }
    if (proto === "http:" && config.security.allowInsecureCallbackHttp) {
        return u;
    }

    throw new Error("hub.callback must use https");
}

function isPrivateIpv4(ip) {
    const parts = ip.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return true;

    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 0) return true; // 0.0.0.0/8
    if (a >= 224) return true; // multicast/reserved

    return false;
}

function isPrivateIpv6(ip) {
    const norm = ip.toLowerCase();
    if (norm === "::1") return true; // loopback
    if (norm.startsWith("fe80:")) return true; // link-local
    if (norm.startsWith("fc") || norm.startsWith("fd")) return true; // unique local fc00::/7
    if (norm.startsWith("ff")) return true; // multicast
    if (norm === "::") return true;
    return false;
}

function assertPublicIp(ip) {
    const family = net.isIP(ip);
    if (family === 4) {
        if (!config.security.allowPrivateCallbackTargets && isPrivateIpv4(ip)) {
            throw new Error("hub.callback resolves to a private or local IPv4 address");
        }
        return;
    }
    if (family === 6) {
        if (!config.security.allowPrivateCallbackTargets && isPrivateIpv6(ip)) {
            throw new Error("hub.callback resolves to a private or local IPv6 address");
        }
        return;
    }
    throw new Error("hub.callback resolves to an invalid IP");
}

async function assertCallbackTargetAllowed(urlObj) {
    // Block localhost-ish hostnames even before DNS.
    const host = urlObj.hostname.toLowerCase();
    if (!config.security.allowPrivateCallbackTargets) {
        if (host === "localhost" || host === "localhost.") {
            throw new Error("hub.callback hostname is not allowed");
        }
    }

    // If host is already an IP, check it directly.
    if (net.isIP(host)) {
        assertPublicIp(host);
        return;
    }

    const ttlMs = config.security.callbackDnsCacheTtlMs;
    const now = Date.now();
    const cached = cache.get(host);
    if (cached && cached.expiresAt > now) {
        if (!cached.ok) {
            throw new Error(cached.reason || "hub.callback hostname is not allowed");
        }
        return;
    }

    let addresses;
    try {
        addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch (_e) {
        cache.set(host, {
            ok: false,
            reason: "hub.callback hostname could not be resolved",
            expiresAt: now + ttlMs,
        });
        throw new Error("hub.callback hostname could not be resolved");
    }

    try {
        for (const addr of addresses) {
            assertPublicIp(addr.address);
        }
    } catch (e) {
        cache.set(host, { ok: false, reason: e.message, expiresAt: now + ttlMs });
        throw e;
    }

    cache.set(host, { ok: true, expiresAt: now + ttlMs });
}

async function validateAndAuthorizeCallback(callback) {
    const urlObj = normalizeCallbackUrl(callback);
    await assertCallbackTargetAllowed(urlObj);
    return urlObj.toString();
}

module.exports = { validateAndAuthorizeCallback, normalizeCallbackUrl, assertCallbackTargetAllowed };

