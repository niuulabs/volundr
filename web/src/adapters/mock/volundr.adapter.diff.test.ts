import { describe, it, expect } from 'vitest';
import { MockVolundrService } from './volundr.adapter';

describe('MockVolundrService.getSessionDiff', () => {
  const service = new MockVolundrService();

  it('returns diff data with hunks for a regular file', async () => {
    const diff = await service.getSessionDiff('session-1', 'src/main.ts', 'last-commit');

    expect(diff.filePath).toBe('src/main.ts');
    expect(diff.hunks.length).toBeGreaterThan(0);
  });

  it('returns add-only hunks for test files', async () => {
    const diff = await service.getSessionDiff('session-1', 'src/component.test.ts', 'last-commit');

    expect(diff.filePath).toBe('src/component.test.ts');
    expect(diff.hunks.length).toBe(1);

    const hunk = diff.hunks[0];
    expect(hunk.oldStart).toBe(0);
    expect(hunk.oldCount).toBe(0);

    // All lines should be additions
    for (const line of hunk.lines) {
      expect(line.type).toBe('add');
      expect(line.newLine).toBeDefined();
    }
  });

  it('returns hunks with context, add, and remove lines for non-test files', async () => {
    const diff = await service.getSessionDiff('session-1', 'src/component.tsx', 'default-branch');

    expect(diff.filePath).toBe('src/component.tsx');
    expect(diff.hunks.length).toBe(2);

    const types = new Set(diff.hunks.flatMap(h => h.lines.map(l => l.type)));
    expect(types.has('context')).toBe(true);
    expect(types.has('add')).toBe(true);
    expect(types.has('remove')).toBe(true);
  });

  it('includes line numbers on context and add lines', async () => {
    const diff = await service.getSessionDiff('session-1', 'src/component.tsx', 'last-commit');

    const contextLine = diff.hunks[0].lines.find(l => l.type === 'context');
    expect(contextLine?.oldLine).toBeDefined();
    expect(contextLine?.newLine).toBeDefined();

    const addLine = diff.hunks[0].lines.find(l => l.type === 'add');
    expect(addLine?.newLine).toBeDefined();
  });

  it('includes line numbers on remove lines', async () => {
    const diff = await service.getSessionDiff('session-1', 'src/component.tsx', 'last-commit');

    const removeLine = diff.hunks[0].lines.find(l => l.type === 'remove');
    expect(removeLine?.oldLine).toBeDefined();
  });

  it('works with different base values', async () => {
    const diffA = await service.getSessionDiff('session-1', 'src/main.ts', 'last-commit');
    const diffB = await service.getSessionDiff('session-1', 'src/main.ts', 'default-branch');

    // Mock returns same data regardless of base, but both should work
    expect(diffA.filePath).toBe(diffB.filePath);
    expect(diffA.hunks.length).toBeGreaterThan(0);
    expect(diffB.hunks.length).toBeGreaterThan(0);
  });

  it('works with different session IDs', async () => {
    const diff = await service.getSessionDiff('any-session-id', 'src/file.ts', 'last-commit');
    expect(diff.filePath).toBe('src/file.ts');
    expect(diff.hunks.length).toBeGreaterThan(0);
  });

  it('returns correct hunk metadata', async () => {
    const diff = await service.getSessionDiff('session-1', 'src/component.tsx', 'last-commit');

    const firstHunk = diff.hunks[0];
    expect(firstHunk.oldStart).toBe(1);
    expect(firstHunk.oldCount).toBe(8);
    expect(firstHunk.newStart).toBe(1);
    expect(firstHunk.newCount).toBe(10);
  });
});
