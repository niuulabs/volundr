import { z } from 'zod';

/**
 * Visual shape primitive used in the topology canvas and registry editor.
 *
 * All 14 shapes are rendered as 20×20 SVG viewBox paths via `ShapeSvg`.
 *
 * @canonical Observatory — `data.jsx::ShapeSvg`, registry type definitions.
 * @consumers All plugins (PersonaAvatar uses a subset: role → shape mapping).
 */
export const entityShapeSchema = z.enum([
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
]);

export type EntityShape = z.infer<typeof entityShapeSchema>;

/**
 * Semantic category grouping entity types in the registry.
 *
 * @canonical Observatory — registry editor, "Types" tab groups.
 * @consumers All plugins (filter and group entities by category).
 */
export const entityCategorySchema = z.enum([
  'topology',
  'hardware',
  'agent',
  'coordinator',
  'knowledge',
  'infrastructure',
  'device',
  'composite',
]);

export type EntityCategory = z.infer<typeof entityCategorySchema>;

/**
 * Border style for entity shapes in the canvas.
 *
 * @canonical Observatory — topology canvas stroke rendering.
 * @consumers Observatory.
 */
export const entityBorderSchema = z.enum(['solid', 'dashed']);

export type EntityBorder = z.infer<typeof entityBorderSchema>;

/**
 * Field type for entity-type schema definitions.
 *
 * @canonical Observatory — registry editor, entity drawer property grids.
 * @consumers All plugins (entity detail rendering).
 */
export const entityFieldTypeSchema = z.enum(['string', 'number', 'select', 'tags']);

export type EntityFieldType = z.infer<typeof entityFieldTypeSchema>;

/**
 * A field definition within an entity type's schema.
 *
 * Fields appear as editable rows in the entity drawer and registry editor.
 * `select` fields include a set of valid `options`.
 *
 * @canonical Observatory — registry type definitions in `data.jsx`.
 * @consumers Observatory (entity drawer), all plugins (entity rendering).
 */
export const entityFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: entityFieldTypeSchema,
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

export type EntityField = z.infer<typeof entityFieldSchema>;

/**
 * An entity type in the Observatory type registry.
 *
 * Defines the visual, structural, and data schema for a class of entities
 * in the Niuu topology (realms, clusters, hosts, ravens, coordinators, etc.).
 *
 * The registry is versioned: edits bump `TypeRegistry.version` and
 * `TypeRegistry.updatedAt`. Containment rules (`canContain` / `parentTypes`)
 * form a DAG — cycles are rejected by the registry editor.
 *
 * @canonical Observatory — `DEFAULT_REGISTRY.types[]` in `data.jsx`,
 *            registry editor (Types / Containment / JSON tabs).
 * @consumers All plugins (topology canvas nodes, entity drawers,
 *            PersonaAvatar shape mapping, MountChip role glyph).
 */
export const entityTypeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rune: z.string().min(1),
  icon: z.string().min(1),
  shape: entityShapeSchema,
  color: z.string().min(1),
  size: z.number().positive(),
  border: entityBorderSchema,
  canContain: z.array(z.string()),
  parentTypes: z.array(z.string()),
  category: entityCategorySchema,
  description: z.string(),
  fields: z.array(entityFieldSchema),
});

export type EntityType = z.infer<typeof entityTypeSchema>;
