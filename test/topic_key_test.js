/*
MIT License

Copyright (c) 2024 Secure Dimensions
 */

"use strict";

const assert = require("assert");

describe("topic_key", function () {
    const query =
        "?$expand=Datastream($expand=Party($select=displayName),Sensor($select=properties))";
    const fullTopic =
        "https://citiobs.demo.secure-dimensions.de/staplustest/v1.1/Datastreams(2429)/Observations" +
        query;

    function loadWithRoot(rootUrl) {
        process.env.STA_ROOT_URL = rootUrl;
        delete require.cache[require.resolve("../settings")];
        delete require.cache[require.resolve("../helpers/topic_key")];
        return require("../helpers/topic_key");
    }

    afterEach(function () {
        delete process.env.STA_ROOT_URL;
        delete require.cache[require.resolve("../settings")];
        delete require.cache[require.resolve("../helpers/topic_key")];
    });

    it("strips STA_ROOT_URL path for MQTT topics", function () {
        const topicKey = loadWithRoot("https://citiobs.demo.secure-dimensions.de/staplustest/");
        const relative = topicKey.hubRelativeTopicFromUrl(fullTopic);
        const mqtt = topicKey.mqttTopicKey(relative);

        assert.strictEqual(relative, `v1.1/Datastreams(2429)/Observations${query}`);
        assert.strictEqual(mqtt, `v1.1/Datastreams(2429)/Observations${query}`);
        assert.ok(!mqtt.startsWith("staplustest/"));
    });

    it("strips STA_ROOT_URL path without trailing slash", function () {
        const topicKey = loadWithRoot("https://citiobs.demo.secure-dimensions.de/staplustest");
        const relative = topicKey.hubRelativeTopicFromUrl(fullTopic);
        const mqtt = topicKey.mqttTopicKey(relative);

        assert.strictEqual(relative, `v1.1/Datastreams(2429)/Observations${query}`);
        assert.strictEqual(mqtt, `v1.1/Datastreams(2429)/Observations${query}`);
    });

    it("removes staplustest prefix when passed through on MQTT key", function () {
        const topicKey = loadWithRoot("https://citiobs.demo.secure-dimensions.de/staplustest/");
        const mqtt = topicKey.mqttTopicKey(
            `staplustest/v1.1/Datastreams(2429)/Observations${query}`
        );

        assert.strictEqual(mqtt, `v1.1/Datastreams(2429)/Observations${query}`);
    });

    it("leaves topics unchanged when STA_ROOT_URL has no path", function () {
        const topicKey = loadWithRoot("http://localhost:8080/FROST-Server/");
        const relative = topicKey.hubRelativeTopicFromUrl(
            `http://localhost:8080/FROST-Server/v1.1/Observations`
        );

        assert.strictEqual(relative, "v1.1/Observations");
        assert.strictEqual(topicKey.mqttTopicKey(relative), "v1.1/Observations");
    });
});
