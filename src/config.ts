export interface Config {
  port: number;
  sharedToken: string;
  tickMs: number;
  replayLimit: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: parseInteger(env.PORT, 8787),
    sharedToken: env.PLANET_SHARED_TOKEN || '',
    tickMs: parseInteger(env.PLANET_TICK_MS, 5000),
    replayLimit: parseInteger(env.PLANET_REPLAY_LIMIT, 500),
  };
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
