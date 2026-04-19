/**
 * Canonical rune glyph assignments for Niuu entity kinds, system components,
 * and raven persona roles.
 *
 * Sourced from design/data.jsx (DS_RUNES + DEFAULT_REGISTRY.types[].rune).
 *
 * Forbidden runes — NOT included here (ADL-flagged appropriated hate symbols):
 *   ᛟ (Othala), ᛊ (Sowilo), ᛏ (Tiwaz), ᛉ (Algiz), ᚺ/ᚻ (Hagalaz)
 */

/** Rune per entity kind — matches DEFAULT_REGISTRY.types[].rune */
export const ENTITY_RUNES = {
  realm: 'ᛞ',
  cluster: 'ᚲ',
  host: 'ᚦ',
  ravn_long: 'ᚱ',
  ravn_raid: 'ᚲ',
  skuld: 'ᛜ',
  valkyrie: 'ᛒ',
  tyr: 'ᛃ',
  bifrost: 'ᚨ',
  volundr: 'ᚲ',
  mimir: 'ᛗ',
  mimir_sub: 'ᛗ',
  service: 'ᛦ',
  model: 'ᛖ',
  printer: 'ᛈ',
  vaettir: 'ᚹ',
  beacon: 'ᚠ',
  raid: 'ᚷ',
} as const;

export type EntityKind = keyof typeof ENTITY_RUNES;

/** Rune per top-level system component — matches DS_RUNES in the design reference */
export const SYSTEM_RUNES = {
  volundr: 'ᚲ',
  tyr: 'ᛃ',
  ravn: 'ᚱ',
  mimir: 'ᛗ',
  bifrost: 'ᚨ',
  sleipnir: 'ᛖ',
  buri: 'ᛜ',
  hlidskjalf: 'ᛞ',
  flokk: 'ᚠ',
  skuld: 'ᚾ',
  valkyrie: 'ᛒ',
} as const;

export type SystemComponent = keyof typeof SYSTEM_RUNES;

/**
 * Rune per raven persona role.
 * Assignments follow Elder Futhark semantics; all forbidden runes excluded.
 */
export const PERSONA_RUNES = {
  thought: 'ᛁ', // Isa — clarity, stillness, introspection
  memory: 'ᛚ', // Laguz — flow, depth, accumulated knowledge
  strength: 'ᚢ', // Uruz — raw endurance and force
  battle: 'ᚦ', // Thurisaz — directed striking force
  noise: 'ᚹ', // Wunjo — signal amid noise, communication
  valkyrie: 'ᛒ', // Berkanan — guardian, protection
} as const;

export type PersonaRole = keyof typeof PERSONA_RUNES;

/** The set of runes explicitly forbidden by the ADL (appropriated hate symbols) */
export const FORBIDDEN_RUNES = new Set(['ᛟ', 'ᛊ', 'ᛏ', 'ᛉ', 'ᚺ', 'ᚻ']);
