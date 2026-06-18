# SensorThings API WebSub Hub
This repository contains an open source implementation of the OGC SensorThings API WebSub Hub as defined in OGC #24-032.

**Note:** The OGC #24-032 Standard is currently work in progress.

According to the W3C WebSub Recommendation, this `Hub` implementation leverages the freedom of interacting with the `publisher` according to "The hub and the publisher can agree on any mechanism, as long as the hub is eventually able send the updated payload to the subscribers."[section 6, W3C WebSub Recommendation](https://www.w3.org/TR/websub/#publishing). Therefore, and as a compliant OGC SensorThings API WebSub Hub, this implementation connects to the `publisher` via MQTT. Any events received for the subscribed topics will be delivered to the `subscriber`using HTTP POST.

## Implementation
The implementation is based on the latest version of NodeJS (version 22 at the time of writing) for easy implementation of the asynchronous processing of subscription requests, required by the W3C Recommendation. The NodeJS asynchronous support also allows the independent processing of content delivery to the `subscriber`.

The hub ingests MQTT notifications from the publisher, enqueues them in Redis (BullMQ), and delivers them to subscriber callbacks via HTTP POST. Subscription metadata is stored in PostgreSQL. The `./docker/create.sql` contains the relevant database instructions.

### Process roles (`HUB_MODE`)
The hub can run as separate processes for horizontal scaling:

| Mode | Entry | Responsibility |
|------|-------|----------------|
| `api` | `server-api.js` | WebSub subscribe/unsubscribe API |
| `ingest` | `server-ingest.js` | MQTT subscription + enqueue notifications |
| `delivery` | `server-delivery.js` | BullMQ worker + HTTP fan-out to callbacks |
| `all` | `server.js` | All roles in one process (local development) |

Start scripts: `npm run start:api`, `start:ingest`, `start:delivery`, `start:all`.

Redis is required (`REDIS_URL`, default `redis://localhost:6379`). Processes coordinate via Redis pub/sub for MQTT topic commands and subscription-cache invalidation.

### Content Delivery Format
The content delivery is limited to `application/json`. Any other format is rejected.

### Content Delivery Error Handling
Delivery uses a BullMQ queue with per-callback retries and exponential backoff. Transient errors (network failures, HTTP 5xx, 429) are retried up to `DELIVERY_MAX_ATTEMPTS` (default 3). Permanent client errors (most 4xx) fail immediately.

An in-memory circuit breaker per callback URL opens after repeated failures within a sliding window (`DELIVERY_CIRCUIT_*` settings). While open, deliveries to that callback are skipped until the circuit cools down. HTTP 410 (`Gone`) still removes the subscription from the database.

Concurrent POSTs to the same callback are limited by `DELIVERY_PER_CALLBACK_CONCURRENCY` (default 20).

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
* **REDIS_URL**: Redis connection for BullMQ and pub/sub. Default: `redis://localhost:6379`
* **HUB_MODE**: `api`, `ingest`, `delivery`, or `all`. Default: `all` when using `npm start`
* **QUEUE_MAX_WAITING**: Backpressure limit for waiting queue jobs. Default: `120000`
* **DELIVERY_WORKER_CONCURRENCY**: BullMQ worker concurrency. Default: `100`
* **DELIVERY_PER_CALLBACK_CONCURRENCY**: Max concurrent POSTs per callback URL. Default: `20`
* **DELIVERY_MAX_ATTEMPTS**: HTTP retry attempts per notification per callback. Default: `3`
* **DELIVERY_BACKOFF_BASE_MS**: Base delay for exponential backoff. Default: `200`
* **DELIVERY_CIRCUIT_FAILURE_THRESHOLD**: Failures before opening circuit. Default: `10`
* **DELIVERY_CIRCUIT_WINDOW_MS**: Sliding window for circuit failures. Default: `60000`
* **DELIVERY_CIRCUIT_OPEN_MS**: How long a circuit stays open. Default: `30000`
* **HUB_STATS_INTERVAL_MS**: Log queue/delivery counters every N ms (0 = disabled)
* **HUB_INGEST_OPS_PORT** / **HUB_DELIVERY_OPS_PORT**: Health/metrics HTTP ports for ingest/delivery in Docker (mapped to `HUB_OPS_PORT` per container; API uses `/ops` on `HUB_PORT`)
* **HUB_METRICS_THROUGHPUT_WINDOW_MS**: Rolling window for throughput on `/ops/metrics` (default 10000 ms)

## Operations

### Health and metrics
* **API** (`HUB_MODE=api`): `GET /ops/health`, `GET /ops/metrics` (queue depths, `throughput.enqueuedPerSecond` / `throughput.deliveredPerSecond` over rolling window)
* **Ingest** (`HUB_INGEST_OPS_PORT`, default 4001): `GET /health`, `GET /metrics`
* **Delivery** (`HUB_DELIVERY_OPS_PORT`, default 4002): `GET /health`, `GET /metrics` (includes open circuits)

`queue.completedRetained` is **not** a lifetime total — BullMQ only keeps the newest `QUEUE_REMOVE_ON_COMPLETE_COUNT` completed jobs in Redis, so this value plateaus at that cap.

### Failed jobs (DLQ)
BullMQ retains failed jobs (`removeOnFail: false`). Inspect and retry:

```bash
npm run failed:jobs
npm run failed:jobs -- --limit=50 --start=0
npm run failed:jobs -- --retry=<jobId>
```

Or via API: `GET /ops/failed`, `POST /ops/failed/:id/retry`

## Deployment
The deployment can be done via docker-compose from the `docker` directory. Production compose runs three hub services: `sta-websub-hub-api`, `sta-websub-hub-ingest`, and `sta-websub-hub-delivery`, plus Redis and PostgreSQL.

So for example `docker-compose up -d` will start the WebSub Hub.

## Test
The `test` directory contains a simple implementation of a WebSub Subscriber and Publisher. These services are started with an MQTT broker, Redis, and a Postgres database:

````
docker-compose up --build
````

On the output, you will see the startup of the database, broker, publisher and subscriber. The test stack runs split hub services: `hub-api`, `hub-ingest`, and `hub-delivery`.

The test is executed via npm:

````
npm test
````

The output from the test should show `15 passing (1s)`.

### Load / burst testing
Subscribe to a topic and fire a burst of MQTT events via the test publisher:

```bash
npm run burst:run          # subscribe ABC-UNSUB + 1000/s for 5s
npm run burst -- --topic ABC --rate 500 --seconds 10
```

Burst endpoint on the test publisher: `POST /burst/<topic>?rate=1000&seconds=5`

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

#### Testing `hub.secret` per subscription
Topics named `hub.secret=<value>` encode the subscription secret in the callback path. The test subscriber uses that value for HMAC verification, so both `hub.secret=secret` and `hub.secret=foobar` should log **X-Hub-Signature valid** when the hub signed with the matching `hub.secret`.

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