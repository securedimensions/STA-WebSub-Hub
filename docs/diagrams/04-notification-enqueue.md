<link rel="stylesheet" href="../architecture-print.css">

<div class="diagram-page landscape">

# Diagram: Notification - Adding to Queue

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
    participant Pub as Publisher
    participant Broker as MQTT broker
    participant Ingest as hub-ingest
    participant Redis as Redis BullMQ

    Pub->>Broker: MQTT PUBLISH topic and JSON payload
    Broker->>Ingest: MQTT message

    Note over Ingest: Size check and optional JSON validation. No DB on this path.

    alt payload too large or invalid JSON
        Ingest->>Ingest: reject, log error, no enqueue
    else payload accepted
        Ingest->>Redis: getWaitingCount
        alt queue at QUEUE_MAX_WAITING limit
            Ingest->>Ingest: reject queue full
        else queue has capacity
            Ingest->>Redis: add deliver job with notificationId topic payload
            Redis-->>Ingest: job queued
            Note over Ingest,Redis: Ingest returns immediately. Delivery is not blocked.
        end
    end
```

</div>

[← Back to architecture.md](../architecture.md) · [Worker reads queue →](05-notification-delivery.md)
