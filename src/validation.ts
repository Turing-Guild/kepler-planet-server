import type { HelloMessage, ModuleEnvelope } from './types.js';

export function isHelloMessage(value: unknown): value is HelloMessage {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === 'hello'
    && isIdentifier(value.planetId)
    && isIdentifier(value.habitatId)
    && isIdentifier(value.moduleId)
    && (value.role === undefined || typeof value.role === 'string');
}

export function isModuleEnvelope(value: unknown): value is ModuleEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return (value.scope === 'habitat' || value.scope === 'module')
    && typeof value.type === 'string'
    && value.type.startsWith('module.')
    && (value.to === undefined || isIdentifier(value.to));
}

export function parseJsonMessage(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: 'Invalid JSON message' };
  }
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 80
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
