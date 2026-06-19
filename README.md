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
* **HUB_OPS_TOKEN**: Secret token required to access all `/ops` endpoints on the API role. Pass it as the `x-ops-token` request header or `?token=` query parameter. When unset, all `/ops` endpoints return `503`. **Must be set in production** — generate with e.g. `openssl rand -hex 32`.
* **HUB_SECRET_KEY**: 64-character hex key (32 bytes) used for AES-256-GCM encryption of `hub.secret` values at rest in PostgreSQL. When set, new and renewed subscriptions have their secret encrypted before writing; secrets are transparently decrypted on read. Existing plaintext rows continue to work without a migration. When unset in production, a warning is logged and secrets are stored in plaintext. Generate with `openssl rand -hex 32`.
* **POSTGRES_PASSWORD**: Password for the PostgreSQL database user. **Required in production** — the process will refuse to start if this is unset when `NODE_ENV=production`.
* **HUB_STATS_INTERVAL_MS**: Log queue/delivery counters every N ms (0 = disabled)
* **HUB_OPS_PORT**: HTTP port for ingest/delivery health and metrics (`GET /health`, `GET /metrics`). Disabled when unset or `0`. In Docker this is set per container from `HUB_INGEST_OPS_PORT` / `HUB_DELIVERY_OPS_PORT`.
* **HUB_INGEST_OPS_PORT** / **HUB_DELIVERY_OPS_PORT**: Default ops ports for ingest (`4001`) and delivery (`4002`) in compose files
* **HUB_METRICS_THROUGHPUT_WINDOW_MS**: Rolling window for throughput rates (default `10000` ms)
* **HUB_THROUGHPUT_FLUSH_MS**: How often per-process throughput counters are flushed to Redis for cross-process aggregation (default `1000` ms)
* **HUB_SUBSCRIPTION_EVENTS_MAX**: Max subscription lifecycle events retained in Redis for `/ops/metrics` (default `50`)
* **HUB_LEASE_SWEEP_INTERVAL_MS**: Ingest polls for expired MQTT lease keys and unsubscribes (default `2000` ms; `0` = disabled)

## Operations

The hub exposes health and metrics on three roles. In split deployments (`HUB_MODE=api` / `ingest` / `delivery`), use the API for queue overview and DLQ management, ingest for MQTT/enqueue visibility, and delivery for fan-out and circuit-breaker state.

> **Authentication:** All `/ops` endpoints on the API role require the `HUB_OPS_TOKEN` env var to be set. Pass it as the `x-ops-token` header or `?token=` query param. Without a configured token the endpoints return `503`.

| Role | Base URL (defaults) | Endpoints |
|------|---------------------|-----------|
| **API** | `http://localhost:4000` (`HUB_PORT`) | `GET /ops/health`, `GET /ops/metrics`, `GET /ops/failed`, `POST /ops/failed/*` |
| **Ingest** | `http://localhost:4001` (`HUB_INGEST_OPS_PORT`) | `GET /health`, `GET /metrics` |
| **Delivery** | `http://localhost:4002` (`HUB_DELIVERY_OPS_PORT`) | `GET /health`, `GET /metrics` |

In `docker/docker-compose.yaml`, ingest and delivery ops ports are available on the Docker network only (not published to the host). Use `docker/docker-compose.host.yaml` or add port mappings if you need host access.

### Health

**API** — `GET /ops/health`

Returns `200` when PostgreSQL and Redis are reachable, otherwise `503`.

```json
{ "ok": true, "role": "api", "checks": { "db": true, "redis": true } }
```

**Ingest** — `GET /health` on the ingest ops port. `ok` reflects MQTT broker connectivity.

**Delivery** — `GET /health` on the delivery ops port. `ok` is always `true` when the process is running.

### Metrics

**API** — `GET /ops/metrics`  
**Ingest / delivery** — `GET /metrics` on the respective ops port.

All metrics responses include:

| Field | Description |
|-------|-------------|
| `role` | `api`, `ingest`, or `delivery` |
| `at` | ISO-8601 timestamp of the snapshot |
| `queue` | BullMQ queue depths (see below) |
| `throughput` | Cross-process rates aggregated via Redis (see below) |

#### Queue (`queue`)

| Field | Description |
|-------|-------------|
| `waiting` | Jobs waiting for a worker |
| `active` | Jobs currently being processed |
| `failed` | Jobs in the failed/DLQ set |
| `delayed` | Jobs scheduled for retry |
| `completedRetained` | Completed jobs BullMQ still holds in Redis |
| `completedRetentionMax` | Cap from `QUEUE_REMOVE_ON_COMPLETE_COUNT` |

`completedRetained` is **not** a lifetime total or a throughput rate. BullMQ only keeps the newest completed jobs in Redis, so this value plateaus at `completedRetentionMax` (often `10000`) even under sustained load.

#### Throughput (`throughput`)

Rates are averaged over a rolling window (`windowSeconds`, default `10` from `HUB_METRICS_THROUGHPUT_WINDOW_MS`). Fields ending in `PerSecond` are **rates**; fields ending in `InWindow` are **totals over the whole window** (do not compare `jobsCompletedInWindow` directly to `jobsCompletedPerSecond`).

| Field | Meaning |
|-------|---------|
| `enqueuedPerSecond` | MQTT messages accepted into the BullMQ queue |
| `jobsCompletedPerSecond` | Queue jobs finished (one job per MQTT message) |
| `notificationsPerSecond` | Alias for `jobsCompletedPerSecond` (historical name) |
| `deliveredPerSecond` | Alias for `jobsCompletedPerSecond` |
| `enqueuedInWindow` | Total enqueues in the window |
| `jobsCompletedInWindow` | Total completed jobs in the window |
| `deliveredInWindow` | Alias for `jobsCompletedInWindow` |

One queue job fans out to **N HTTP POSTs** (one per active subscriber). Throughput fields count **jobs**, not POSTs. For HTTP POST volume use `delivery.postsSucceeded` on the **delivery** metrics endpoint (lifetime counter since process start; derive a rate from deltas if needed).

In split mode, `throughput` on ingest and delivery also includes `local` with the same field names, counting only that process instance.

#### API-only: subscription lifecycle (`subscriptionLifecycle`)

Emitted by the API process during async subscribe validation:

| Field | Description |
|-------|-------------|
| `pendingIntentValidation` | Subscriptions accepted (`202`) but not yet activated or failed |
| `recent` | Newest lifecycle events from Redis (up to `HUB_SUBSCRIPTION_EVENTS_MAX`) |

Event types in `recent`:

| `type` | When |
|--------|------|
| `subscribe_accepted` | `202` returned to the subscriber |
| `subscribe_activated` | Publisher + intent validation succeeded; includes `activationDelayMs`, `publisherValidationMs`, `intentValidationMs` |
| `subscribe_failed` | Validation failed; includes `phase`, `reason`, `failedAfterMs` |

Use `activationDelayMs` to distinguish subscription setup latency from steady-state `throughput` rates.

#### Ingest-only fields

| Field | Description |
|-------|-------------|
| `mqtt.connected` | Whether the MQTT client is connected |
| `mqtt.broker` | Configured broker URL |
| `mqtt.count` / `mqtt.topics` | Topics currently subscribed on the broker |
| `process` | Lifetime counters for this ingest process (`enqueued`, `enqueueDroppedNoSubs`, `enqueueRejected`, …) |

#### Delivery-only fields

| Field | Description |
|-------|-------------|
| `delivery` | Lifetime counters (`jobsCompleted`, `jobsFailed`, `postsSucceeded`, `postsFailed`, `postsSkippedCircuit`, `jobsSkippedNoSubs`, …) |
| `circuitsOpen` | Callback URLs with an open circuit breaker (`callback`, `openUntilMs`, `openForMs`) |
| `throughput.local` | Job/enqueue rates for this delivery process only |

#### API `process` counters

The API response also includes `process` with lifetime counters for the API role (mostly subscription-path metrics; delivery counters stay at `0` on the API process).

### Examples

```bash
# API — health, metrics, failed jobs (requires HUB_OPS_TOKEN)
curl -s -H "x-ops-token: $HUB_OPS_TOKEN" http://localhost:4000/ops/health | jq
curl -s -H "x-ops-token: $HUB_OPS_TOKEN" http://localhost:4000/ops/metrics | jq '.queue, .throughput, .subscriptionLifecycle'
curl -s -H "x-ops-token: $HUB_OPS_TOKEN" 'http://localhost:4000/ops/failed?limit=10'

# Ingest / delivery (local dev or host compose)
curl -s http://localhost:4001/health | jq
curl -s http://localhost:4001/metrics | jq '.mqtt, .throughput'
curl -s http://localhost:4002/metrics | jq '.delivery, .circuitsOpen, .throughput'
```

Set `HUB_STATS_INTERVAL_MS` (e.g. `1000`) to log queue and delivery counters to the process log in addition to the HTTP endpoints.

### Failed jobs (DLQ)
BullMQ retains failed jobs (`removeOnFail: false`). Inspect and retry:

```bash
npm run failed:jobs
npm run failed:jobs -- --limit=50 --start=0
npm run failed:jobs -- --retry=<jobId>
npm run failed:retry-all
npm run failed:retry-all -- --limit=1000 --batch=200
npm run failed:purge
```

Or via API (all require `x-ops-token` header): `GET /ops/failed`, `POST /ops/failed/:id/retry`, `POST /ops/failed/retry-all`, `POST /ops/failed/purge?confirm=true`

**Retry-all** re-queues failed jobs for delivery (watch `queue.waiting` / subscriber load). **Purge** permanently removes failed jobs without delivering them — typical for stale live-stream data after an outage.

## Deployment
The deployment can be done via docker-compose from the `docker` directory. Production compose runs three hub services: `sta-websub-hub-api`, `sta-websub-hub-ingest`, and `sta-websub-hub-delivery`, plus Redis and PostgreSQL.

So for example `docker-compose up -d` will start the WebSub Hub.

## Test

The `test` directory contains a fully dockerised test suite. All services — hub (API, ingest, delivery), PostgreSQL, Redis, MQTT broker, publisher, and subscriber — run inside an isolated `WebSubHubTest` Docker network. No host port mappings are used.

### Running the tests

From the repository root:

```bash
./test/run-tests.sh
```

This builds all images, starts all containers, waits for the hub API to become healthy, runs the Mocha test suite inside the `test-runner` container, and prints a clean summary at the end:

```
============================================================
  TEST SUMMARY
============================================================

  lease_sweep
    ✔ lists registry topics whose lease TTL has expired (1103ms)
    ✔ does not list topics with a live lease
  ...
  37 passing (11s)
  1 pending
============================================================
```

The exit code of `run-tests.sh` matches the test runner exit code, so it integrates directly with CI.

To pass additional `docker compose up` flags (e.g. skip rebuilding images):

```bash
./test/run-tests.sh --no-build
```

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