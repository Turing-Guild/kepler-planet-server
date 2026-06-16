import type { WebSocket } from 'ws';

export interface HelloMessage {
  type: 'hello';
  planetId: string;
  habitatId: string;
  moduleId: string;
  role?: string;
}

export interface ModuleEnvelope {
  scope: 'habitat' | 'module';
  type: 'module.status' | 'module.message' | string;
  to?: string;
  payload?: unknown;
}

export interface EventEnvelope {
  id: number;
  timestamp: string;
  planetId: string;
  habitatId: string;
  scope: 'planet' | 'habitat' | 'module' | 'instructor';
  type: string;
  from: string;
  to?: string;
  tick?: number;
  payload: unknown;
}

export interface ClientContext {
  ws: WebSocket;
  planetId: string;
  habitatId: string;
  moduleId: string;
  role: string;
  channelKey: string;
}

export interface PlanetState {
  tick: number;
  dustLevel: number;
  solarOutputPercent: number;
}
