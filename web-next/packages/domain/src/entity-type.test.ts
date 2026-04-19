import { describe, it, expect } from 'vitest';
import {
  entityShapeSchema,
  entityCategorySchema,
  entityBorderSchema,
  entityFieldTypeSchema,
  entityFieldSchema,
  entityTypeSchema,
} from './entity-type.js';

const VALID_ENTITY_FIELD = {
  key: 'status',
  label: 'Status',
  type: 'select' as const,
  required: true,
  options: ['healthy', 'degraded', 'down'],
};

const VALID_ENTITY_TYPE = {
  id: 'realm',
  label: 'Realm',
  rune: 'ᚱ',
  icon: 'globe',
  shape: 'ring' as const,
  color: 'brand',
  size: 50,
  border: 'solid' as const,
  canContain: ['cluster', 'host', 'service'],
  parentTypes: [],
  category: 'topology' as const,
  description: 'A logical grouping of clusters, hosts, and services',
  fields: [VALID_ENTITY_FIELD, { key: 'location', label: 'Location', type: 'string' as const }],
};

describe('entityShapeSchema', () => {
  it('accepts all valid shapes', () => {
    const shapes = [
      'ring',
      'ring-dashed',
      'rounded-rect',
      'diamond',
      'triangle',
      'hex',
      'chevron',
      'square',
      'square-sm',
      'pentagon',
      'halo',
      'mimir',
      'mimir-small',
      'dot',
    ];
    for (const shape of shapes) {
      expect(entityShapeSchema.parse(shape)).toBe(shape);
    }
  });

  it('rejects invalid shapes', () => {
    expect(() => entityShapeSchema.parse('circle')).toThrow();
  });
});

describe('entityCategorySchema', () => {
  it('accepts all valid categories', () => {
    const categories = [
      'topology',
      'hardware',
      'agent',
      'coordinator',
      'knowledge',
      'infrastructure',
      'device',
      'composite',
    ];
    for (const cat of categories) {
      expect(entityCategorySchema.parse(cat)).toBe(cat);
    }
  });

  it('rejects invalid categories', () => {
    expect(() => entityCategorySchema.parse('misc')).toThrow();
  });
});

describe('entityBorderSchema', () => {
  it('accepts all valid border styles', () => {
    for (const border of ['solid', 'dashed']) {
      expect(entityBorderSchema.parse(border)).toBe(border);
    }
  });

  it('rejects invalid border styles', () => {
    expect(() => entityBorderSchema.parse('dotted')).toThrow();
  });
});

describe('entityFieldTypeSchema', () => {
  it('accepts all valid field types', () => {
    for (const type of ['string', 'number', 'select', 'tags']) {
      expect(entityFieldTypeSchema.parse(type)).toBe(type);
    }
  });

  it('rejects invalid field types', () => {
    expect(() => entityFieldTypeSchema.parse('boolean')).toThrow();
  });
});

describe('entityFieldSchema', () => {
  it('round-trips a full field definition', () => {
    const parsed = entityFieldSchema.parse(VALID_ENTITY_FIELD);
    expect(parsed).toEqual(VALID_ENTITY_FIELD);
  });

  it('round-trips without optional fields', () => {
    const minimal = { key: 'name', label: 'Name', type: 'string' as const };
    expect(entityFieldSchema.parse(minimal)).toEqual(minimal);
  });

  it('preserves data through JSON round-trip', () => {
    const json = JSON.stringify(VALID_ENTITY_FIELD);
    const parsed = entityFieldSchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed)).toBe(json);
  });

  it('rejects empty key', () => {
    expect(() => entityFieldSchema.parse({ ...VALID_ENTITY_FIELD, key: '' })).toThrow();
  });

  it('rejects empty label', () => {
    expect(() => entityFieldSchema.parse({ ...VALID_ENTITY_FIELD, label: '' })).toThrow();
  });

  it('rejects invalid type', () => {
    expect(() => entityFieldSchema.parse({ ...VALID_ENTITY_FIELD, type: 'boolean' })).toThrow();
  });
});

describe('entityTypeSchema', () => {
  it('round-trips a full entity type', () => {
    const parsed = entityTypeSchema.parse(VALID_ENTITY_TYPE);
    expect(parsed).toEqual(VALID_ENTITY_TYPE);
  });

  it('round-trips with empty arrays', () => {
    const input = {
      ...VALID_ENTITY_TYPE,
      canContain: [],
      parentTypes: [],
      fields: [],
    };
    const parsed = entityTypeSchema.parse(input);
    expect(parsed).toEqual(input);
  });

  it('preserves data through JSON round-trip', () => {
    const json = JSON.stringify(VALID_ENTITY_TYPE);
    const parsed = entityTypeSchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed)).toBe(json);
  });

  it('rejects missing required fields', () => {
    const { id, ...noId } = VALID_ENTITY_TYPE;
    void id;
    expect(() => entityTypeSchema.parse(noId)).toThrow();
  });

  it('rejects invalid shape', () => {
    expect(() => entityTypeSchema.parse({ ...VALID_ENTITY_TYPE, shape: 'circle' })).toThrow();
  });

  it('rejects invalid category', () => {
    expect(() => entityTypeSchema.parse({ ...VALID_ENTITY_TYPE, category: 'misc' })).toThrow();
  });

  it('rejects invalid border', () => {
    expect(() => entityTypeSchema.parse({ ...VALID_ENTITY_TYPE, border: 'dotted' })).toThrow();
  });

  it('rejects non-positive size', () => {
    expect(() => entityTypeSchema.parse({ ...VALID_ENTITY_TYPE, size: 0 })).toThrow();
  });

  it('rejects invalid field in fields array', () => {
    expect(() =>
      entityTypeSchema.parse({
        ...VALID_ENTITY_TYPE,
        fields: [{ key: '', label: 'X', type: 'string' }],
      }),
    ).toThrow();
  });
});
