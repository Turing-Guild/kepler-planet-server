# Kepler Planet Server

Hello World planet simulation server for Kepler-442b habitat channels.

The server exposes one public WebSocket endpoint and routes messages into isolated
channels by `planetId` and `habitatId`.

## Endpoints

- `GET /health`: public health check.
- `GET /events?habitatId=<id>&since=<eventId>`: replay recent events for a habitat.
- `WS /planet/stream`: live planet and habitat-channel stream.

`/events` and `/planet/stream` require:

```text
Authorization: Bearer <PLANET_SHARED_TOKEN>
```

## Local Development

```bash
npm install
npm run build
PLANET_SHARED_TOKEN=dev-token npm start
```

Connect with any WebSocket client to:

```text
ws://localhost:8787/planet/stream
```

Send a hello message first:

```json
{
  "type": "hello",
  "planetId": "kepler-442b",
  "habitatId": "habitat-demo",
  "moduleId": "cli",
  "role": "operator"
}
```

Then send habitat-scoped module messages:

```json
{
  "scope": "habitat",
  "type": "module.message",
  "payload": {
    "text": "Hello from the CLI"
  }
}
```

## Hello World Behavior

- The planet ticks every 5 seconds by default.
- Every tick emits `planet.tick`.
- Every third tick emits `planet.dust_update`.
- Habitat-scoped module messages relay only to other clients in the same
  `planetId/habitatId` channel.
- Recent events are stored in memory for replay.
