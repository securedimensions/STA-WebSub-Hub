# SensorThings API WebSub Hub
This repository contains an open source implementation of the OGC SensorThings API WebSub Hub as defined in OGC #24-032.

**Note:** The OGC #24-032 Standard is currently work in progress.

According to the W3C WebSub Recommendation, this `Hub` implementation leverages the freedom of interacting with the `publisher` according to "The hub and the publisher can agree on any mechanism, as long as the hub is eventually able send the updated payload to the subscribers."[section 6, W3C WebSub Recommendation](https://www.w3.org/TR/websub/#publishing). Therefore, and as a compliant OGC SensorThings API WebSub Hub, this implementation connects to the `publisher` via MQTT. Any events received for the subscribed topics will be delivered to the `subscriber`using HTTP POST.

## Implementation
The implementation is based on the latest version of NodeJS (version 22 at the time of writing) for easy implementation of the asynchronous processing of subscription requests, required by the W3C Recommendation. The NodeJS asynchronous support also allows the independent processing of content delivery to the `subscriber`. 

The topic / subscription management requires a Postgres database. The `./docker/create.sql` contains the relevant instructions.

### Content Delivery Format
The content delivery is limited to `application/json`. Any other format is rejected.

### Content Delivery Error Handling
This implementation uses a state diagram for delivering content to subscribers' callbacks. In case an error occurs when POSTing the content to the callback, the hub's delivery status for that subscription changes from `active` or `updated` to `inactive`. If the next attempt to deliver content fails, the state changes to `disabled` and the hub stops further attempts to deliver content for that subscription to the callback. Once the subscription is updated (via a `subscribe` request), the state changes back to `updated` and the hub restarts the attempts to deliver content.

This means that the hub allows two failed attempt to deliver content to a callback.

### Content Delivery `Gone`
In case the content delivery to a callback returns HTTP status code 410, the hub removes the subscription from the database. This solution was chosen over the `mark the subscription as gone` to avoid flooding the database with invalid subscriptions.

### Validation of Intent
This implementation does validate the intent with the `subscriber` as defined by the W3C Recommendation.

This implementation does validate the subscription intent with the `publisher` using a HTTP HEAD discovery request.

### Max Request and Value Size
The max. request size for a subscription can be controlled via configuration parameters in the `settings.js` file.

### Max Content Delivery Size
The max. content size for the content delivery to the subscribers can be configured in the `settings.js` file. When configuring the max. value, please keep in mind that this implementation buffers the entire content in main memory. If the subscription was made including the `hub.secret` the `X-Hub-Signature` value is calculated. The stored content is then delivered to all subscribed `callback`s. 

### MQTT Topic Limitations
A `publisher` - aka a SensorThings Service - may support the subscription to MQTT topics that include an ODATA query. To determine any limitations,the Hub makes a discovery request to the `publisher` using HTTP HEAD upon a `subscribe` request. 

If the `publisher` has limitations regarding the use of ODATA query commands included in the topic URL (e.g. `$expand`, `$filter`, etc.), the self-link returned will either be missing or not match the requested topic URL. In this case, the Hub will send a `denied` to the `callback` as defined by the W3C WebSub Recommendation.

## Configuration
The file `settings.js` contains the configuration parameters to operate the hub. This implementation is restricted to interconnect with one service functioning as the `publisher`.

### Configuration via .env
Some environment variables control the basic behavior of the Hub by overwriting the defaults from `settings.js`:

* **POSTGRES_***: The typical configuration parameters for the Postgres database
    * POSTGRES_HOST, POSTGRES_DB, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD
* **HUB_PORT**: The port to start the server. Default: `4000`
* **HUB_URL**: The URL that can be used by subscribers to undertake subscription management. Default: `http://localhost:4000/api/subscriptions`
* **HUB_LOG_LEVEL**: DEBUG, INFO, WARN, ERROR. Default: `INFO`
* **HUB_SIGNATURE_ALGORITHM**: The hash algorithm used to calculate the value for the `X-Hub-Signature` (only in use when a subscription is made including parameter `hub.secret`). Allowed values are defined in [section 7.1, W3C WebSub](https://www.w3.org/TR/websub/#authenticated-content-distribution). Default: `sha256`.
* **STA_ROOT_URL**: The base URL for the SensorThings service. Default: `http://localhost:8080/FROST-Server`
* **STA_MQTT_URL**: The MQTT broker to use. Default: `mqtt://localhost:1883`
* **STA_MQTT_USER**: The MQTT username. Default: `null`.
* **STA_MQTT_PASSWORD**: The MQTT password. Default: `null`.
* **PUBLISHER_URL**: For a service where the WebSub Discovery and MQTT subscription is separated. Default: *STA_ROOT_URL*

## Deployment
The deployment can be done via docker-compose from the `docker` directory. So for example `docker-compose up -d` will start the WebSub Hub.

## Test
The `test` directory contains a simple implementation of a WebSub Subscriber and Publisher. These services are started with an MQTT broker and a Postgres database:

````
docker-compose up --build
````

On the output, you will see the startup of the database, broker, publisher and subscriber.

The test is executed via npm:

````
npm test
````

The output from the test should show `15 passing (1s)`.

### Testing `hub.secret`
To verify the proper functioning of the `hub.secret` parameter, the test command has started subscriptions to three topics. The publisher was triggered to periodically send MQTT events to the Hub. The `Subscriber` functions with the `hub.secret=secret`. 

#### Testing correct `hub.secret`
Topic `hub.secret=secret` is a subscription with the correct secret. The subscriber will display something like this:

````
subscriber-1  | ==============
subscriber-1  | callback: /accepted/hub.secret=secret
subscriber-1  | headers:
subscriber-1  | {
subscriber-1  |   host: 'subscriber:8081',
subscriber-1  |   connection: 'keep-alive',
subscriber-1  |   'content-type': 'application/json',
subscriber-1  |   link: 'http://localhost:4000/api/subscriptions;rel="hub", http://publisher/hub.secret=secret;rel="self"',
subscriber-1  |   'x-hub-signature': 'sha256=01a739f386aa8d29b351b4ee5c98cd35368181dd53954362b4d6e913fb20e746',
subscriber-1  |   'user-agent': 'node-urllib/VERSION Node.js/22.11.0 (linux; x64)',
subscriber-1  |   'content-length': '54'
subscriber-1  | }
subscriber-1  | message:
subscriber-1  | {"topic": "hub.secret=secret", "sequence": 1731606970}
subscriber-1  | X-Hub-Signature valid
subscriber-1  | ==============
````

#### Testing incorrect `hub.secret`
Topic `hub.secret=foobar` is a subscription with an incorrect secret. The subscriber will display something like this:

````
subscriber-1  | ==============
subscriber-1  | callback: /accepted/hub.secret=foobar
subscriber-1  | headers:
subscriber-1  | {
subscriber-1  |   host: 'subscriber:8081',
subscriber-1  |   connection: 'keep-alive',
subscriber-1  |   'content-type': 'application/json',
subscriber-1  |   link: 'http://localhost:4000/api/subscriptions;rel="hub", http://publisher/hub.secret=foobar;rel="self"',
subscriber-1  |   'x-hub-signature': 'sha256=49a21f347d2dd8413f0da4d8fc17aa1d419488ab61fa7965313808f41ab8d60e',
subscriber-1  |   'user-agent': 'node-urllib/VERSION Node.js/22.11.0 (linux; x64)',
subscriber-1  |   'content-length': '54'
subscriber-1  | }
subscriber-1  | message:
subscriber-1  | {"topic": "hub.secret=foobar", "sequence": 1731606970}
subscriber-1  | X-Hub-Signature invalid!
subscriber-1  | ==============
````

#### Testing missing `hub.secret`
Topic `ABC` is a subscription with missing secret. The subscriber will display something like this:

````
subscriber-1  | ==============
subscriber-1  | callback: /accepted/ABC
subscriber-1  | headers:
subscriber-1  | {
subscriber-1  |   host: 'subscriber:8081',
subscriber-1  |   connection: 'keep-alive',
subscriber-1  |   'content-type': 'application/json',
subscriber-1  |   link: 'http://localhost:4000/api/subscriptions;rel="hub", http://publisher/ABC;rel="self"',
subscriber-1  |   'user-agent': 'node-urllib/VERSION Node.js/22.11.0 (linux; x64)',
subscriber-1  |   'content-length': '40'
subscriber-1  | }
subscriber-1  | message:
subscriber-1  | {"topic": "ABC", "sequence": 1731606970}
subscriber-1  | message with no X-Hub-Signature
subscriber-1  | ==============
````