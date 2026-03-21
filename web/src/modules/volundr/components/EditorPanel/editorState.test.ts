import { describe, it, expect, beforeEach } from 'vitest';
import { isInitialized, markInitialized, resetEditorState } from './editorState';

describe('editorState', () => {
  beforeEach(() => {
    resetEditorState();
  });

  it('should start as not initialized', () => {
    expect(isInitialized()).toBe(false);
  });

  it('should mark as initialized', () => {
    markInitialized();

    expect(isInitialized()).toBe(true);
  });

  it('should reset state', () => {
    markInitialized();
    resetEditorState();

    expect(isInitialized()).toBe(false);
  });
});
