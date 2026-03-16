import { describe, it, expect, beforeEach } from 'vitest';
import {
  isInitialized,
  getInitializedSessionId,
  markInitialized,
  resetEditorState,
} from './editorState';

describe('editorState', () => {
  beforeEach(() => {
    resetEditorState();
  });

  it('should start as not initialized', () => {
    expect(isInitialized()).toBe(false);
    expect(getInitializedSessionId()).toBeNull();
  });

  it('should mark as initialized with session ID', () => {
    markInitialized('session-abc');

    expect(isInitialized()).toBe(true);
    expect(getInitializedSessionId()).toBe('session-abc');
  });

  it('should reset state', () => {
    markInitialized('session-abc');
    resetEditorState();

    expect(isInitialized()).toBe(false);
    expect(getInitializedSessionId()).toBeNull();
  });

  it('should overwrite session ID on second markInitialized', () => {
    markInitialized('session-1');
    markInitialized('session-2');

    expect(getInitializedSessionId()).toBe('session-2');
  });
});
