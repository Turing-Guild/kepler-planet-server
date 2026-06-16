import { loadConfig } from './config.js';
import { startPlanetServer } from './planetServer.js';

const config = loadConfig();

if (!config.sharedToken) {
  console.error('PLANET_SHARED_TOKEN is required.');
  process.exit(1);
}

startPlanetServer(config);
