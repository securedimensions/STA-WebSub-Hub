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

const crypto = require("crypto");
const { log } = require("../../settings");

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

// HUB_SECRET_KEY must be a 64-character hex string (32 bytes).
// If unset, secrets are stored/retrieved as plaintext with a warning.
const keyHex = process.env.HUB_SECRET_KEY;
let KEY = null;

if (keyHex) {
    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
        throw new Error("HUB_SECRET_KEY must be a 64-character hex string (32 bytes). Generate with: openssl rand -hex 32");
    }
    KEY = Buffer.from(keyHex, "hex");
} else if (process.env.NODE_ENV === "production") {
    log.warn("WARNING: HUB_SECRET_KEY is not set — hub.secret values will be stored in plaintext");
}

function encryptSecret(plaintext) {
    if (!plaintext) return plaintext;
    if (!KEY) return plaintext;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

function decryptSecret(stored) {
    if (!stored) return stored;
    if (!stored.startsWith(PREFIX)) return stored; // plaintext (legacy or no key configured)
    if (!KEY) {
        log.error("Encrypted secret found in DB but HUB_SECRET_KEY is not set — cannot decrypt");
        return null;
    }

    const parts = stored.slice(PREFIX.length).split(":");
    if (parts.length !== 3) {
        log.error("Malformed encrypted secret value in DB");
        return null;
    }

    const [ivHex, authTagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final("utf8");
}

module.exports = { encryptSecret, decryptSecret };
