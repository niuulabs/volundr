/**
 * All configurable constants for the TopologyCanvas renderer.
 * No magic numbers in the renderer — everything lives here.
 */
export const CANVAS_CONFIG = {
  /** World coordinate space. Mímir sits at (0, 0). */
  worldWidth: 4000,
  worldHeight: 3200,

  /** Zoom constraints and step factor. */
  minZoom: 0.3,
  maxZoom: 3.0,
  zoomStep: 1.12,

  /** Initial camera state — centred on Mímir at world origin. */
  initialCamX: 0,
  initialCamY: 0,
  initialZoom: 0.32,

  /** Keyboard pan step in world units per key press. */
  keyPanStep: 80,

  /** Layout: realm ring distance from Mímir (world origin). */
  realmRingRadius: 720,
  realmDefaultRadius: 290,

  /** Cluster layout within a realm. */
  clusterDefaultRadius: 160,
  clusterRingFactor: 0.50,

  /** Host placement on the outer ring of its realm. */
  hostRingFactor: 0.82,

  /** Service dots placed at this fraction of parent-container radius. */
  serviceRingFactor: 0.42,

  /** Sub-Mímir orbit radius around primary Mímir. */
  subMimirRingRadius: 170,

  /** Model fan-out radius from parent Bifröst anchor. */
  modelFanRadius: 65,

  /** Minimum gap enforced between placed hosts (world units). */
  hostCollisionGap: 22,

  /** Maximum collision-avoidance attempts per host. */
  hostCollisionAttempts: 36,

  /** Minimap canvas dimensions (CSS px). */
  minimapWidth: 220,
  minimapHeight: 165,

  /** rAF fallback interval in ms. */
  rafIntervalMs: 16,

  /** Node base sizes per entity type (world units = approx px at zoom 1). */
  nodeSizes: {
    mimir: 42,
    mimir_sub: 18,
    tyr: 13,
    bifrost: 11,
    volundr: 13,
    ravn_long: 9,
    ravn_raid: 7,
    skuld: 7,
    valkyrie: 10,
    raid: 50,
    host: 22,
    service: 4,
    model: 6,
    printer: 8,
    vaettir: 8,
    beacon: 5,
    default: 8,
  },

  /** Star field grid dimensions. */
  starGridCols: 28,
  starGridRows: 16,

  /** Rune ring counts for Mímir. */
  mimiOuterRuneCount: 18,
  mimiInnerRuneCount: 14,
} as const;

/**
 * Younger Futhark runes that orbit Mímir.
 *
 * ADL-flagged hate symbols are intentionally excluded:
 *   ᛟ (Othala), ᛊ (Sowilo), ᛏ (Tiwaz), ᛉ (Algiz), ᚺ/ᚻ (Hagalaz variants).
 * See: https://www.adl.org/resources/hate-symbol/odal-rune
 */
export const MIMIR_RUNES = [
  'ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚾ', 'ᛁ',
  'ᛃ', 'ᛈ', 'ᛒ', 'ᛖ', 'ᛗ', 'ᛚ', 'ᛜ', 'ᛞ',
] as const;
