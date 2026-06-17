<link rel="stylesheet" href="../architecture-print.css">

<div class="diagram-page landscape">

# Diagram: Notification — Worker Reads Queue

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'fontSize': '22px',
    'fontFamily': 'arial',
    'actorFontSize': '22px',
    'noteFontSize': '20px',
    'messageFontSize': '20px',
    'signalFontSize': '20px'
  }
}}%%
sequenceDiagram
    autonumber
    participant Redis as Redis (BullMQ)
    participant Worker as hub-delivery<br/>(BullMQ Worker)
    participant Cache as subscription cache
    participant FanOut as fan_out.js
    participant Sub as Subscriber(s)

    Redis->>Worker: job dequeued<br/>(concurrency: DELIVERY_WORKER_CONCURRENCY)

    Worker->>FanOut: processNotification(job.data)
    FanOut->>Cache: getActive(topic)
    Note over Cache: In-memory Map lookup — no PostgreSQL

    par fan-out to each subscriber
        FanOut->>FanOut: circuit.isOpen(callback)?
        FanOut->>FanOut: withCallbackLimit(callback)
        loop up to DELIVERY_MAX_ATTEMPTS
            FanOut->>Sub: HTTP POST application/json<br/>Link, X-Hub-Signature, X-Hub-Notification-Id
            alt 2xx success
                Sub-->>FanOut: 200–299
            else HTTP 410 Gone
                Sub-->>FanOut: 410
                FanOut->>FanOut: delete subscription, maybe MQTT unsubscribe
            else transient (5xx, 429, network)
                FanOut->>FanOut: exponential backoff, retry
            else permanent 4xx
                FanOut->>FanOut: record failure, circuit breaker
            end
        end
    end

    alt any subscriber delivery failed
        Worker->>Redis: job failed (retained in DLQ)
    else all succeeded
        Worker->>Redis: job completed
    end
```

</div>

[← Adding to queue](04-notification-enqueue.md) · [← Back to architecture.md](../architecture.md)
