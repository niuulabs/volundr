import type { LintReport } from '../domain/types';

/**
 * Port: lint engine — run checks and apply auto-fixes.
 */
export interface ILintEngine {
  /** Run lint across all pages, optionally scoped to a mount. */
  getLint(mountName?: string): Promise<LintReport>;
  /** Apply auto-fixes for the given issue ids (all if omitted). */
  lintFix(issueIds?: string[]): Promise<LintReport>;
}
