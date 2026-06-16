import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isHelloMessage, isModuleEnvelope } from '../dist/validation.js';

describe('message validation', () => {
  it('accepts a valid hello envelope', () => {
    assert.equal(isHelloMessage({
      type: 'hello',
      planetId: 'kepler-442b',
      habitatId: 'habitat-17',
      moduleId: 'power-module',
      role: 'system',
    }), true);
  });

  it('rejects invalid identifiers', () => {
    assert.equal(isHelloMessage({
      type: 'hello',
      planetId: 'kepler 442b',
      habitatId: 'habitat-17',
      moduleId: 'power-module',
    }), false);
  });

  it('accepts habitat module messages', () => {
    assert.equal(isModuleEnvelope({
      scope: 'habitat',
      type: 'module.message',
      payload: { text: 'hello' },
    }), true);
  });
});
