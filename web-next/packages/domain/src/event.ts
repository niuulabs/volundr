import { z } from 'zod';

/**
 * An event specification — a named event with a typed payload schema.
 *
 * The `schema` maps field names to their types (string representations:
 * `"string"`, `"number"`, `"boolean"`, `"object"`, `"array"`, `"any"`).
 *
 * @canonical Ravn — EVENT_CATALOG, ProducesSection schema editor.
 * @consumers Tyr (workflow validation — `no_producer` / `no_consumer` rules),
 *            Observatory (event log decoration).
 */
export const eventSpecSchema = z.object({
  name: z.string().min(1),
  schema: z.record(z.string(), z.string()),
});

export type EventSpec = z.infer<typeof eventSpecSchema>;

/**
 * The full event catalog — all produceable event names and their schemas.
 *
 * @canonical Ravn — EVENT_CATALOG in `data.jsx`.
 * @consumers Tyr (workflow validation, EventPicker),
 *            Observatory (event log type column).
 */
export const eventCatalogSchema = z.array(eventSpecSchema);

export type EventCatalog = z.infer<typeof eventCatalogSchema>;
