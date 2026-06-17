<link rel="stylesheet" href="../architecture-print.css">

<div class="diagram-page landscape">

# Diagram: Unsubscribe Flow

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
    participant Sub as Subscriber
    participant API as hub-api
    participant PG as PostgreSQL
    participant Redis as Redis
    participant Ingest as hub-ingest
    participant Broker as MQTT broker
    participant Delivery as hub-delivery

    Sub->>API: POST /api/subscriptions<br/>hub.mode=unsubscribe, hub.topic, hub.callback
    API-->>Sub: 202 Accepted

    API->>Sub: GET hub.mode=unsubscribe<br/>hub.challenge
    Sub-->>API: challenge response (text/plain)

    API->>PG: DELETE subscription (topic + callback)
    API->>API: subscriptionCache.refreshTopic(topic)
    API->>Redis: PUBLISH cache:invalidate<br/>{action: refreshTopic, topic}
    Redis->>Delivery: cache:invalidate message
    Delivery->>PG: SELECT subscriptions for topic
    Delivery->>Delivery: update in-memory cache

    alt no subscriptions remain for topic
        API->>Redis: PUBLISH mqtt:commands<br/>{action: unsubscribe, topic}
        Redis->>Ingest: mqtt:commands message
        Ingest->>Broker: MQTT UNSUBSCRIBE topic
    end
```

</div>

[← Back to architecture.md](../architecture.md)
