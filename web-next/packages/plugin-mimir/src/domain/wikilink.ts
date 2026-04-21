/**
 * Mímir wikilink resolution.
 *
 * Pages reference each other with wikilink syntax: [[slug]]. A wikilink is
 * "resolved" when a page exists whose path contains the slug. When no match
 * is found the link is broken — this triggers a L05 lint issue.
 */

import type { PageMeta } from './page';

const WIKILINK_RE = /\[\[([^\]]+)]]/g;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WikilinkTarget {
  slug: string;
  /** The resolved page, or null when the link is broken. */
  page: PageMeta | null;
  broken: boolean;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** A single part produced by {@link splitWikilinks}. */
export type WikilinkPart = { kind: 'text'; value: string } | { kind: 'link'; slug: string };

/**
 * Split text into interleaved plain-text and wikilink parts for inline rendering.
 *
 * e.g. `"see [[arch/overview]] for more"` →
 * ```
 * [
 *   { kind: 'text', value: 'see ' },
 *   { kind: 'link', slug: 'arch/overview' },
 *   { kind: 'text', value: ' for more' },
 * ]
 * ```
 */
export function splitWikilinks(text: string): WikilinkPart[] {
  const parts: WikilinkPart[] = [];
  const re = /\[\[([^\]]+)]]/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    if (match.index > last) {
      parts.push({ kind: 'text', value: text.slice(last, match.index) });
    }
    parts.push({ kind: 'link', slug: match[1]!.trim() });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: 'text', value: text.slice(last) });
  }
  return parts;
}

/** Extract all [[slug]] patterns from a text string. */
export function parseWikilinks(text: string): string[] {
  const slugs: string[] = [];
  for (const match of text.matchAll(WIKILINK_RE)) {
    if (match[1] !== undefined) slugs.push(match[1].trim());
  }
  return slugs;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a single [[slug]] against the known page list.
 *
 * Resolution uses substring matching on the page path: a slug of
 * `arch/overview` resolves to a page at `/arch/overview`.
 */
export function resolveWikilink(slug: string, pages: PageMeta[]): WikilinkTarget {
  const page = pages.find((p) => p.path === `/${slug}` || p.path === slug) ?? null;
  return { slug, page, broken: page === null };
}

/** Resolve multiple slugs in one pass. */
export function resolveAll(slugs: string[], pages: PageMeta[]): WikilinkTarget[] {
  return slugs.map((slug) => resolveWikilink(slug, pages));
}

/**
 * Parse and resolve all wikilinks in a text string, returning only the
 * broken ones (those without a matching page). Used by the L05 lint rule.
 */
export function detectBrokenWikilinks(text: string, pages: PageMeta[]): WikilinkTarget[] {
  return resolveAll(parseWikilinks(text), pages).filter((t) => t.broken);
}
