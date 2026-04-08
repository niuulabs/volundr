import { useState, useEffect } from 'react';
import styles from './PageEditor.module.css';

interface EditablePage {
  path: string;
  content: string;
}

interface PageEditorProps {
  page: EditablePage | null;
  onSave: (path: string, content: string) => Promise<void>;
  writeEnabled: boolean;
}

export function PageEditor({ page, onSave, writeEnabled }: PageEditorProps) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  useEffect(() => {
    setDraft(page?.content ?? '');
    setSaveError(null);
    setSavedPath(null);
  }, [page?.path, page?.content]);

  if (!page) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>Select a page to edit</span>
      </div>
    );
  }

  if (!writeEnabled) {
    return (
      <div className={styles.readOnly}>
        <div className={styles.readOnlyBanner}>
          <span className={styles.readOnlyIcon} aria-hidden="true">⊘</span>
          <span>This instance is read-only. Switch to a write-enabled instance to edit pages.</span>
        </div>
        <pre className={styles.readOnlyContent}>{page.content}</pre>
      </div>
    );
  }

  const isDirty = draft !== page.content;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(page.path, draft);
      setSavedPath(page.path);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (!saving && isDirty) {
        handleSave();
      }
    }
  };

  const showSavedConfirmation = savedPath === page.path && !isDirty && !saving;

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <span className={styles.pagePath}>{page.path}</span>
        <div className={styles.toolbarActions}>
          {saveError && (
            <span className={styles.errorMessage} role="alert">{saveError}</span>
          )}
          {showSavedConfirmation && (
            <span className={styles.savedMessage} aria-live="polite">Saved</span>
          )}
          {isDirty && !saving && (
            <span className={styles.dirtyIndicator} aria-label="Unsaved changes">●</span>
          )}
          <button
            className={styles.saveButton}
            onClick={handleSave}
            disabled={saving || !isDirty}
            aria-busy={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <textarea
        className={styles.textarea}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSavedPath(null);
        }}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        aria-label={`Edit ${page.path}`}
      />
    </div>
  );
}
