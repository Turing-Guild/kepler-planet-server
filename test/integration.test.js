import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import WebSocket from 'ws';
import { startPlanetServer } from '../dist/planetServer.js';

const token = 'test-token';
let activeServer;

afterEach(async () => {
  if (activeServer) {
    await activeServer.close();
    activeServer = undefined;
  }
});

describe('planet server integration', () => {
  it('relays habitat messages only inside the same channel', async () => {
    activeServer = startPlanetServer({
      port: 9877,
      sharedToken: token,
      tickMs: 100000,
      replayLimit: 50,
    });
    await waitForHealth(9877);

    const alphaA = await connectClient(9877, 'habitat-alpha', 'alpha-a');
    const alphaB = await connectClient(9877, 'habitat-alpha', 'alpha-b');
    const beta = await connectClient(9877, 'habitat-beta', 'beta-a');

    const alphaMessage = nextTypedMessage(alphaB, 'module.message');
    const betaUnexpected = rejectOnTypedMessage(beta, 'module.message', 150);

    alphaA.send(JSON.stringify({
      scope: 'habitat',
      type: 'module.message',
      payload: { text: 'hello alpha' },
    }));

    const received = await alphaMessage;
    assert.equal(received.habitatId, 'habitat-alpha');
    assert.deepEqual(received.payload, { text: 'hello alpha' });
    await betaUnexpected;

    alphaA.close();
    alphaB.close();
    beta.close();
  });

  it('replays events after the requested id', async () => {
    activeServer = startPlanetServer({
      port: 9878,
      sharedToken: token,
      tickMs: 100000,
      replayLimit: 50,
    });
    await waitForHealth(9878);

    const alphaA = await connectClient(9878, 'habitat-alpha', 'alpha-a');
    const alphaB = await connectClient(9878, 'habitat-alpha', 'alpha-b');
    const alphaMessage = nextTypedMessage(alphaB, 'module.status');

    alphaA.send(JSON.stringify({
      scope: 'habitat',
      type: 'module.status',
      payload: { batteryPercent: 72 },
    }));

    const received = await alphaMessage;
    const response = await fetch('http://127.0.0.1:9878/events?habitatId=habitat-alpha&since=0', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.events.some((event) => event.id === received.id), true);

    alphaA.close();
    alphaB.close();
  });

  it('rejects missing token for replay endpoint', async () => {
    activeServer = startPlanetServer({
      port: 9879,
      sharedToken: token,
      tickMs: 100000,
      replayLimit: 50,
    });
    await waitForHealth(9879);

    const response = await fetch('http://127.0.0.1:9879/events?habitatId=habitat-alpha&since=0');
    assert.equal(response.status, 401);
  });

  it('renders documentation pages over HTTP', async () => {
    activeServer = startPlanetServer({
      port: 9880,
      sharedToken: token,
      tickMs: 100000,
      replayLimit: 50,
    });
    await waitForHealth(9880);

    const response = await fetch('http://127.0.0.1:9880/docs/architecture/module-catalog');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);

    const body = await response.text();
    assert.match(body, /Trusted Module Catalog/);
    assert.match(body, /Kepler Planet Server/);

    const headResponse = await fetch('http://127.0.0.1:9880/docs', { method: 'HEAD' });
    assert.equal(headResponse.status, 200);
    assert.match(headResponse.headers.get('content-type'), /text\/html/);
  });
});

async function connectClient(port, habitatId, moduleId) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/planet/stream`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await onceOpen(ws);
  ws.send(JSON.stringify({
    type: 'hello',
    planetId: 'kepler-442b',
    habitatId,
    moduleId,
    role: 'test',
  }));
  await nextServerAck(ws);
  return ws;
}

function onceOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function nextServerAck(ws) {
  return nextMessageWhere(ws, (message) => message.type === 'server.hello_ack');
}

function nextTypedMessage(ws, type) {
  return nextMessageWhere(ws, (message) => message.type === type);
}

function rejectOnTypedMessage(ws, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handleMessage);
      resolve();
    }, timeoutMs);

    function handleMessage(data) {
      const message = JSON.parse(data.toString());
      if (message.type === type) {
        clearTimeout(timer);
        reject(new Error(`Unexpected ${type} message`));
      }
    }

    ws.on('message', handleMessage);
  });
}

function nextMessageWhere(ws, predicate) {
  return new Promise((resolve) => {
    function handleMessage(data) {
      const message = JSON.parse(data.toString());
      if (predicate(message)) {
        ws.off('message', handleMessage);
        resolve(message);
      }
    }

    ws.on('message', handleMessage);
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error(`Server on port ${port} did not become healthy`);
}
