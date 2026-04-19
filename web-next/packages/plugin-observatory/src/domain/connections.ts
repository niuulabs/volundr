/**
 * The five visual edge kinds used on the topology canvas.
 *
 * @canonical Observatory — connection-line taxonomy, README §Connection-line taxonomy.
 */
export const CONNECTION_KINDS = ['solid', 'dashed-anim', 'dashed-long', 'soft', 'raid'] as const;

export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export function isConnectionKind(value: string): value is ConnectionKind {
  return (CONNECTION_KINDS as readonly string[]).includes(value);
}

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  kind: ConnectionKind;
}

/** Visual properties for each connection kind — used by the canvas renderer. */
export const CONNECTION_VISUAL: Record<
  ConnectionKind,
  { dash: string | null; width: number; meaning: string }
> = {
  solid: { dash: null, width: 1.4, meaning: 'Control (Týr → Völundr)' },
  'dashed-anim': { dash: '3 3', width: 1.4, meaning: 'Active dispatch (Týr ⇝ raid coord)' },
  'dashed-long': { dash: '6 4', width: 1.2, meaning: 'External model (Bifröst → provider)' },
  soft: { dash: null, width: 0.9, meaning: 'Read channel (ravn → Mímir)' },
  raid: { dash: null, width: 1.0, meaning: 'Raid cohesion' },
};
