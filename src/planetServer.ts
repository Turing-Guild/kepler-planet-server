import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { isAuthorized, rejectUpgrade, sendJson, sendUnauthorized } from './auth.js';
import type { Config } from './config.js';
import type { ClientContext, EventEnvelope, HelloMessage, ModuleEnvelope, PlanetState } from './types.js';
import { isHelloMessage, isModuleEnvelope, parseJsonMessage } from './validation.js';

export interface PlanetServerHandle {
  close: () => Promise<void>;
  server: http.Server;
  state: ServerState;
}

export interface ServerState {
  channels: Map<string, Set<ClientContext>>;
  clients: Map<WebSocket, ClientContext>;
  eventsByHabitat: Map<string, EventEnvelope[]>;
  planet: PlanetState;
  nextEventId: number;
}

export function createServerState(): ServerState {
  return {
    channels: new Map(),
    clients: new Map(),
    eventsByHabitat: new Map(),
    planet: {
      tick: 0,
      dustLevel: 0.1,
      solarOutputPercent: 100,
    },
    nextEventId: 1,
  };
}

export function startPlanetServer(config: Config): PlanetServerHandle {
  const state = createServerState();
  const server = http.createServer((req, res) => {
    handleHttpRequest(req, res, config, state);
  });

  const wss = new WebSocketServer({ noServer: true });
  setupWebSockets(server, wss, config, state);

  const tickTimer = setInterval(() => {
    advancePlanet(state, config);
  }, config.tickMs);
  tickTimer.unref();

  server.listen(config.port, () => {
    console.log(`Kepler planet server listening on http://localhost:${config.port}`);
    console.log(`WebSocket stream available at ws://localhost:${config.port}/planet/stream`);
  });

  return {
    server,
    state,
    close: () => new Promise((resolve, reject) => {
      clearInterval(tickTimer);
      for (const client of state.clients.keys()) {
        client.close();
      }
      wss.close((wssError) => {
        if (wssError) {
          reject(wssError);
          return;
        }
        server.close((serverError) => {
          if (serverError) {
            reject(serverError);
            return;
          }
          resolve();
        });
      });
    }),
  };
}

function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: Config,
  state: ServerState,
): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${config.port}`}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'kepler-planet-server',
      planetId: 'kepler-442b',
      uptimeSeconds: Math.round(process.uptime()),
      tick: state.planet.tick,
      channels: state.channels.size,
      clients: state.clients.size,
      authRequired: true,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    if (!isAuthorized(req, config.sharedToken)) {
      sendUnauthorized(res);
      return;
    }

    const habitatId = url.searchParams.get('habitatId') || '';
    const since = Number.parseInt(url.searchParams.get('since') || '0', 10);
    const events = replayEvents(state, habitatId, Number.isFinite(since) ? since : 0);
    sendJson(res, 200, { events });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function setupWebSockets(
  server: http.Server,
  wss: WebSocketServer,
  config: Config,
  state: ServerState,
): void {
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      handleSocketMessage(ws, data.toString(), state, config);
    });

    ws.on('close', () => {
      removeClient(ws, state);
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${config.port}`}`);
    if (url.pathname !== '/planet/stream' || !isAuthorized(req, config.sharedToken)) {
      rejectUpgrade(socket);
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
}

function handleSocketMessage(
  ws: WebSocket,
  raw: string,
  state: ServerState,
  config: Config,
): void {
  const parsed = parseJsonMessage(raw);
  if (!parsed.ok) {
    sendSocketError(ws, parsed.error);
    return;
  }

  const existingClient = state.clients.get(ws);
  if (!existingClient) {
    if (!isHelloMessage(parsed.value)) {
      sendSocketError(ws, 'First message must be a valid hello envelope');
      return;
    }

    registerClient(ws, parsed.value, state);
    return;
  }

  if (!isModuleEnvelope(parsed.value)) {
    sendSocketError(ws, 'Message must be a module envelope');
    return;
  }

  relayModuleMessage(existingClient, parsed.value, state, config);
}

function registerClient(ws: WebSocket, hello: HelloMessage, state: ServerState): void {
  const channelKey = buildChannelKey(hello.planetId, hello.habitatId);
  const client: ClientContext = {
    ws,
    planetId: hello.planetId,
    habitatId: hello.habitatId,
    moduleId: hello.moduleId,
    role: hello.role || 'module',
    channelKey,
  };

  state.clients.set(ws, client);
  const channel = getChannel(state, channelKey);
  channel.add(client);

  ws.send(JSON.stringify({
    type: 'server.hello_ack',
    planetId: hello.planetId,
    habitatId: hello.habitatId,
    moduleId: hello.moduleId,
    channel: channelKey,
  }));
}

function relayModuleMessage(
  client: ClientContext,
  message: ModuleEnvelope,
  state: ServerState,
  config: Config,
): void {
  const event = appendEvent(state, config, {
    planetId: client.planetId,
    habitatId: client.habitatId,
    scope: message.scope,
    type: message.type,
    from: client.moduleId,
    to: message.to,
    payload: message.payload ?? {},
  });

  broadcastToChannel(state, client.channelKey, event, client.ws);
}

function advancePlanet(state: ServerState, config: Config): void {
  state.planet.tick += 1;
  const tick = state.planet.tick;
  const dustLevel = Number(((tick % 12) / 12).toFixed(2));
  const solarOutputPercent = Math.max(25, Math.round(100 - dustLevel * 60));

  state.planet.dustLevel = dustLevel;
  state.planet.solarOutputPercent = solarOutputPercent;

  for (const channelKey of state.channels.keys()) {
    const [planetId, habitatId] = splitChannelKey(channelKey);
    const tickEvent = appendEvent(state, config, {
      planetId,
      habitatId,
      scope: 'planet',
      type: 'planet.tick',
      from: 'kepler-442b',
      tick,
      payload: {
        tick,
        dustLevel,
        solarOutputPercent,
      },
    });
    broadcastToChannel(state, channelKey, tickEvent);

    if (tick % 3 === 0) {
      const dustEvent = appendEvent(state, config, {
        planetId,
        habitatId,
        scope: 'planet',
        type: 'planet.dust_update',
        from: 'kepler-442b',
        tick,
        payload: {
          tick,
          dustLevel,
          solarOutputPercent,
          message: 'Dust levels shifted; solar output adjusted.',
        },
      });
      broadcastToChannel(state, channelKey, dustEvent);
    }
  }
}

function appendEvent(
  state: ServerState,
  config: Config,
  event: Omit<EventEnvelope, 'id' | 'timestamp'>,
): EventEnvelope {
  const fullEvent: EventEnvelope = {
    id: state.nextEventId,
    timestamp: new Date().toISOString(),
    ...event,
  };
  state.nextEventId += 1;

  const habitatEvents = state.eventsByHabitat.get(event.habitatId) || [];
  habitatEvents.push(fullEvent);
  if (habitatEvents.length > config.replayLimit) {
    habitatEvents.splice(0, habitatEvents.length - config.replayLimit);
  }
  state.eventsByHabitat.set(event.habitatId, habitatEvents);

  return fullEvent;
}

function replayEvents(state: ServerState, habitatId: string, since: number): EventEnvelope[] {
  return (state.eventsByHabitat.get(habitatId) || []).filter((event) => event.id > since);
}

function broadcastToChannel(
  state: ServerState,
  channelKey: string,
  event: EventEnvelope,
  except?: WebSocket,
): void {
  const channel = state.channels.get(channelKey);
  if (!channel) {
    return;
  }

  const encoded = JSON.stringify(event);
  for (const client of channel) {
    if (client.ws === except || client.ws.readyState !== WebSocket.OPEN) {
      continue;
    }
    client.ws.send(encoded);
  }
}

function removeClient(ws: WebSocket, state: ServerState): void {
  const client = state.clients.get(ws);
  if (!client) {
    return;
  }

  state.clients.delete(ws);
  const channel = state.channels.get(client.channelKey);
  channel?.delete(client);
  if (channel?.size === 0) {
    state.channels.delete(client.channelKey);
  }
}

function sendSocketError(ws: WebSocket, error: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'server.error', error }));
  }
}

function getChannel(state: ServerState, channelKey: string): Set<ClientContext> {
  let channel = state.channels.get(channelKey);
  if (!channel) {
    channel = new Set();
    state.channels.set(channelKey, channel);
  }
  return channel;
}

function buildChannelKey(planetId: string, habitatId: string): string {
  return `${planetId}/${habitatId}`;
}

function splitChannelKey(channelKey: string): [string, string] {
  const separator = channelKey.indexOf('/');
  return [channelKey.slice(0, separator), channelKey.slice(separator + 1)];
}
