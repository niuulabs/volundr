import { describe, it, expect } from 'vitest';
import { getValkyrieForRealm, VALKYRIE_REGISTRY } from './valkyries';

describe('getValkyrieForRealm', () => {
  it('should return valkyrie info for a known realm', () => {
    const result = getValkyrieForRealm('valhalla');
    expect(result).toEqual(VALKYRIE_REGISTRY['valhalla']);
  });

  it('should return null for an unknown realm', () => {
    const result = getValkyrieForRealm('unknown-realm');
    expect(result).toBeNull();
  });
});
