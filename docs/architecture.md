# STA-WebSub-Hub — Architecture

This document describes the **implemented** architecture of the OGC SensorThings API WebSub Hub: how processes interact, how subscribe/unsubscribe/notification flows work, and how the design sustains **burst MQTT load** (~1,000 notifications/s) while delivering every notification to subscribers over HTTP(S).

For scaling rationale and phased rollout history, see [`DESIGN.md`](../DESIGN.md).

### Diagrams (separate landscape pages)

Each diagram lives on its own page for printing and PDF export. Use [`architecture-print.css`](architecture-print.css) for landscape layout.

| Diagram | Page |
|---------|------|
| Component / services | [`diagrams/01-component-services.md`](diagrams/01-component-services.md) |
| Subscribe flow | [`diagrams/02-subscribe.md`](diagrams/02-subscribe.md) |
| Unsubscribe flow | [`diagrams/03-unsubscribe.md`](diagrams/03-unsubscribe.md) |
| Notification — enqueue | [`diagrams/04-notification-enqueue.md`](diagrams/04-notification-enqueue.md) |
| Notification — delivery | [`diagrams/05-notification-delivery.md`](diagrams/05-notification-delivery.md) |

**PDF export** (per diagram page, run from repository root):

```bash
npx md-to-pdf docs/diagrams/01-component-services.md --stylesheet docs/architecture-print.css
```

---

## 1. Overview

The hub sits between three parties defined by the [W3C WebSub Recommendation](https://www.w3.org/TR/websub/):

| Party | Protocol | Role |
|-------|----------|------|
| **Publisher** (STA service) | MQTT + HTTP HEAD | Publishes observation updates; validates topic URLs |
| **Hub** (this project) | HTTP + MQTT + Redis | Manages subscriptions; relays notifications |
| **Subscriber** | HTTP | Receives `POST` callbacks with JSON payloads |

The hub **does not** query the database on every MQTT message. Instead it:

1. **Ingests** MQTT payloads and enqueues a durable job in Redis (BullMQ).
2. **Delivers** jobs via worker processes that read an in-memory subscription cache and fan out HTTP `POST`s.
3. **Persists** subscription metadata in PostgreSQL (source of truth, not on the hot path).

---

## 2. Process topology

Production runs three Node.js processes (or containers), selected by `HUB_MODE`:

| Process | Entry | `HUB_MODE` | Responsibility |
|---------|-------|------------|----------------|
| **hub-api** | `server-api.js` | `api` | Express WebSub API (`POST /api/subscriptions`), ops endpoints (`/ops/*`) |
| **hub-ingest** | `server-ingest.js` | `ingest` | MQTT client, enqueue notifications, MQTT topic subscribe/unsubscribe |
| **hub-delivery** | `server-delivery.js` | `delivery` | BullMQ worker, HTTP fan-out to subscriber callbacks |

`server.js` with `HUB_MODE=all` runs all three in one process for local development.

**Diagram:** [Component / services](diagrams/01-component-services.md) (landscape page)

### Redis pub/sub channels

| Channel | Publisher | Subscriber | Payload |
|---------|-----------|------------|---------|
| `mqtt:commands` | hub-api, hub-delivery | hub-ingest | `{ action: "subscribe" \| "unsubscribe", topic }` |
| `cache:invalidate` | hub-api, cleanup job | hub-delivery | `{ action: "refreshTopic", topic }` or `{ action: "reload" }` |

These channels decouple the API and delivery processes from the MQTT ingest process without direct coupling.

### Key modules

```
server.js              # HUB_MODE router (all | api | ingest | delivery)
server-api.js          # HTTP server for WebSub API
server-ingest.js       # MQTT + enqueue
server-delivery.js     # BullMQ worker + cache listener

routes/
  subscriptions.js     # POST /api/subscriptions
  subscribe.js         # subscribe flow
  unsubscribe.js       # unsubscribe flow
  ops.js               # /ops/health, /ops/metrics, /ops/failed

helpers/
  db.js                # PostgreSQL (subscriptions persistence)
  cache/subscriptions.js   # In-memory cache (delivery hot path)
  cache/invalidation.js    # Redis pub/sub cache refresh
  mqtt/commands.js         # Redis pub/sub MQTT topic control
  queue/connection.js      # ioredis connection
  queue/producer.js        # BullMQ enqueue + backpressure
  queue/worker.js          # BullMQ worker
  queue/failed.js          # DLQ inspection / retry
  delivery/fan_out.js      # Per-job fan-out + retries
  delivery/http_client.js  # undici connection pool
  delivery/circuit.js      # Per-callback circuit breaker
  delivery/limiter.js      # Per-callback concurrency cap
  delivery/signature.js    # X-Hub-Signature headers
```

---

## 3. Subscribe flow

A subscriber sends `POST /api/subscriptions` with `hub.mode=subscribe`. The API returns **202 Accepted** immediately; validation and persistence run asynchronously.

**Diagram:** [Subscribe flow](diagrams/02-subscribe.md) (landscape page)

### Implementation notes

- **Publisher validation** (`routes/subscribe.js`): HTTP `HEAD` against the publisher checks `Link: rel="hub"` matches `HUB_URL` and `rel="self"` matches the requested topic.
- **Subscriber intent validation**: random `hub.challenge` echoed back as `text/plain; charset=utf-8`.
- **MQTT subscribe is delegated** to ingest via `mqtt:commands` so the API process never holds an MQTT connection.
- **Cache invalidation** ensures all delivery worker instances refresh the same topic after a subscription change.

---

## 4. Unsubscribe flow

A subscriber sends `POST /api/subscriptions` with `hub.mode=unsubscribe`. The API returns **202 Accepted** immediately.

**Diagram:** [Unsubscribe flow](diagrams/03-unsubscribe.md) (landscape page)

### Implementation notes

- If intent validation fails, the subscription in PostgreSQL is **unchanged**.
- MQTT `UNSUBSCRIBE` only happens when `numSubscriptions(topic) === 0` after the delete.
- hub-delivery may also trigger `mqtt:commands` unsubscribe when the last active subscription is removed (410) or when a topic has no active subscribers after in-memory compaction.

---

## 5. Notification flow

When the publisher emits an MQTT message on a subscribed topic, the hub enqueues one BullMQ job and delivers the payload to every active subscriber callback.

**Diagrams:**

- [Adding to queue](diagrams/04-notification-enqueue.md) (landscape page)
- [Worker reads queue](diagrams/05-notification-delivery.md) (landscape page)

### Delivery headers

Built by `helpers/delivery/signature.js`:

- `Content-Type: application/json`
- `Link: <hub-url>; rel="hub", <topic-url>; rel="self"`
- `X-Hub-Notification-Id: <uuid>`
- `X-Hub-Signature: sha256=<hmac>` (when `hub.secret` was provided at subscribe time)

---

## 6. Burst processing

The original monolithic design performed a **PostgreSQL query and unbounded async HTTP** on every MQTT message. That cannot sustain ~1,000 notifications/s. The current implementation addresses burst load through **decoupling, buffering, and bounded concurrency**.

### 6.1 Hot path vs cold path

| Path | Trigger | Work | DB? |
|------|---------|------|-----|
| **Hot** | MQTT `message` | Validate size → `enqueueNotification()` | No |
| **Warm** | BullMQ job | Cache lookup → HTTP fan-out | No (cache only) |
| **Cold** | Subscribe / unsubscribe | Intent validation, CRUD | Yes |

Ingest returns from the MQTT handler as soon as the job is queued. Slow subscribers cannot block MQTT consumption.

### 6.2 Durable queue (BullMQ on Redis)

```
MQTT message  →  1 BullMQ job  →  N HTTP POSTs (one job fans out to all callbacks)
```

- **`helpers/queue/producer.js`**: adds jobs with `removeOnFail: false` so failed deliveries are retained for inspection/retry (`/ops/failed`, `npm run failed:jobs`).
- **Backpressure**: if `getWaitingCount() >= QUEUE_MAX_WAITING` (default 120,000), enqueue throws `queue full` and the message is rejected rather than exhausting memory.
- **Horizontal scaling**: multiple `hub-delivery` instances consume the same queue; each job is processed by exactly one worker.

### 6.3 In-memory subscription cache

`helpers/cache/subscriptions.js` holds a `Map<topic, subscriptions[]>` loaded at delivery startup and refreshed on:

- `cache:invalidate` pub/sub events (subscribe/unsubscribe from API)
- `cache:reload` after periodic expired-subscription cleanup
- In-memory compaction inside `getActive()` (drops expired entries without a DB round-trip)

Expired subscriptions are **not** deleted on the notification hot path. `getActive()` filters them before HTTP fan-out; a background job removes expired rows from PostgreSQL and signals delivery workers to reload the cache.

- **Manual / cron host:** `npm run cleanup:expired`
- **Docker:** `sta-websub-hub-cleanup` service (`docker/Dockerfile.cleanup`), default schedule every 30 minutes via `CLEANUP_CRON_SCHEDULE`

At ~1,000 MQTT messages/s, avoiding 1,000 PostgreSQL reads/s is the largest single throughput gain.

### 6.4 Bounded fan-out concurrency

| Layer | Control | Default | Purpose |
|-------|---------|---------|---------|
| Worker | `DELIVERY_WORKER_CONCURRENCY` | 100 | Max concurrent BullMQ jobs per delivery process |
| Per callback | `DELIVERY_PER_CALLBACK_CONCURRENCY` | 20 | Max concurrent POSTs to the same subscriber URL |
| HTTP pool | undici `Agent.connections` | 100 | Reused TCP/TLS connections across POSTs |

`helpers/delivery/limiter.js` implements a per-callback semaphore so one slow subscriber does not spawn unlimited in-flight requests.

### 6.5 Retries, circuit breaker, and DLQ

Under burst load, transient subscriber outages are common. The hub handles them without disabling subscriptions permanently:

- **Per-attempt retries** (`DELIVERY_MAX_ATTEMPTS`, exponential `DELIVERY_BACKOFF_BASE_MS`) for network errors, HTTP 5xx, and 429.
- **Circuit breaker** (`helpers/delivery/circuit.js`): after repeated failures to a callback within a sliding window, deliveries to that URL are skipped until the circuit cools down — protecting workers from hammering a dead endpoint.
- **BullMQ job retries** (`DELIVERY_JOB_MAX_ATTEMPTS`) for partial fan-out failures (some subscribers succeeded, others did not).
- **DLQ**: failed jobs remain in Redis for operator inspection and manual retry.

### 6.6 Burst throughput model

For a topic with **S** active subscribers at **R** MQTT messages/s:

| Metric | Old design | Current design |
|--------|-----------|----------------|
| DB reads/s | R | 0 on hot path |
| Queue jobs/s | — | R |
| HTTP POSTs/s | R × S (unbounded concurrency) | R × S (bounded per worker + per callback) |
| Ingest blocking | Until all POSTs settle | Until Redis enqueue ack |

Example at **R = 1,000/s**, **S = 3**: ~3,000 HTTP POSTs/s spread across workers with connection reuse and per-callback caps, while ingest sustains 1,000 enqueues/s.

### 6.7 Operational visibility

| Endpoint | Process | Information |
|----------|---------|-------------|
| `GET /ops/health` | hub-api | PostgreSQL + Redis connectivity |
| `GET /ops/metrics` | hub-api | Queue depths (waiting, active, failed, delayed) |
| `GET /health`, `GET /metrics` | hub-ingest (`HUB_OPS_PORT`) | MQTT connected, queue stats, enqueue counters |
| `GET /health`, `GET /metrics` | hub-delivery (`HUB_OPS_PORT`) | Job counters, open circuits |

Set `HUB_STATS_INTERVAL_MS` to log queue and delivery counters periodically.

---

## 7. Deployment modes

| Compose file | PostgreSQL | Redis | Hub services |
|--------------|------------|-------|--------------|
| `docker/docker-compose.yaml` | Container | Container | api, ingest, delivery, cleanup |
| `docker/docker-compose.host.yaml` | Host | Host | api, ingest, delivery, cleanup |

Environment variables are documented in `docker/.env.example` and `docker/.env.host.example`. See [`README.md`](../README.md) for the full list.

---

## 8. WebSub compliance summary

| Requirement | Implementation |
|-------------|----------------|
| Intent verification (subscriber) | `hub.challenge` GET/response in subscribe/unsubscribe |
| Intent verification (publisher) | HTTP HEAD + `Link` header checks |
| Authenticated distribution | `X-Hub-Signature` HMAC when `hub.secret` set |
| Subscription denied | `hub.mode=denied` GET to callback |
| Gone (410) | Subscription removed from DB and cache |
| Async acceptance | `202` returned before validation completes |

---

## 9. Related documents

- [`DESIGN.md`](../DESIGN.md) — scaling design goals, phased implementation plan, configuration reference
- [`README.md`](../README.md) — configuration, deployment, testing, burst tooling
