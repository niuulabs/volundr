const RFC1123_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validate a session name against RFC 1123 DNS label rules.
 * Returns a user-friendly error string, or null if valid.
 *
 * Rules:
 *  - Lowercase letters (a-z), digits (0-9), and hyphens (-) only
 *  - Must start and end with a letter or digit
 *  - Max 63 characters
 */
export function validateSessionName(name: string): string | null {
  if (!name) return null; // empty is handled by required

  if (name.length > 63) {
    return 'Must be at most 63 characters (Kubernetes hostname limit)';
  }

  if (name !== name.toLowerCase()) {
    return 'Must be lowercase — try "' + name.toLowerCase() + '"';
  }

  if (name.includes(' ')) {
    return 'Spaces are not allowed — use hyphens instead';
  }

  if (name.startsWith('-')) {
    return 'Must start with a letter or digit, not a hyphen';
  }

  if (name.endsWith('-')) {
    return 'Must end with a letter or digit, not a hyphen';
  }

  if (/[^a-z0-9-]/.test(name)) {
    const bad = name.match(/[^a-z0-9-]/g);
    const chars = [...new Set(bad)].map(c => `"${c}"`).join(', ');
    return `Invalid character${bad && bad.length > 1 ? 's' : ''}: ${chars} — only lowercase letters, digits, and hyphens are allowed`;
  }

  if (!RFC1123_RE.test(name)) {
    return 'Must be a valid hostname (lowercase letters, digits, and hyphens only)';
  }

  return null;
}
