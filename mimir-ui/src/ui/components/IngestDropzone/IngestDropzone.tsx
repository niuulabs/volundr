import { useState, useRef, useCallback } from 'react';
import type { IngestSourceType } from '@/domain';
import styles from './IngestDropzone.module.css';

interface DropzoneInstance {
  name: string;
  writeEnabled: boolean;
}

interface IngestDropzoneProps {
  instances: DropzoneInstance[];
  activeInstanceName: string;
  onIngest: (
    instanceName: string,
    title: string,
    content: string,
    sourceType: IngestSourceType,
    originUrl?: string,
  ) => Promise<void>;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

function detectSourceType(file: File): IngestSourceType {
  if (file.type === 'text/html' || file.name.endsWith('.html') || file.name.endsWith('.htm')) {
    return 'web';
  }
  return 'document';
}

export function IngestDropzone({ instances, activeInstanceName, onIngest }: IngestDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [targetInstance, setTargetInstance] = useState(activeInstanceName);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [originUrl, setOriginUrl] = useState('');
  const [sourceType, setSourceType] = useState<IngestSourceType>('document');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const writeableInstances = instances.filter((i) => i.writeEnabled);
  const selectedInstance = instances.find((i) => i.name === targetInstance);
  const canSubmit = !submitting && title.trim().length > 0 && content.trim().length > 0 && selectedInstance?.writeEnabled;

  const resetForm = () => {
    setTitle('');
    setContent('');
    setOriginUrl('');
    setSourceType('document');
    setError(null);
  };

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const text = await readFileAsText(file);
      const detectedType = detectSourceType(file);
      setTitle((prev) => prev || file.name.replace(/\.[^.]+$/, ''));
      setContent(text);
      setSourceType(detectedType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
    }
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (!file) {
      return;
    }
    await loadFile(file);
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    await loadFile(file);
    e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      await onIngest(
        targetInstance,
        title.trim(),
        content,
        sourceType,
        originUrl.trim() || undefined,
      );
      setSuccess(true);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.dropzone}>
      <div
        className={styles.dropArea}
        data-dragging={isDragging}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Drop a file or click to browse"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          className={styles.hiddenInput}
          onChange={handleFileInput}
          accept=".txt,.md,.html,.htm,.json,.csv"
          tabIndex={-1}
          aria-hidden="true"
        />
        <span className={styles.dropIcon} aria-hidden="true">⬆</span>
        <span className={styles.dropLabel}>
          {isDragging ? 'Drop to load file' : 'Drop a file here or click to browse'}
        </span>
        <span className={styles.dropHint}>txt, md, html, json, csv</span>
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ingest-instance">
              Instance
            </label>
            <select
              id="ingest-instance"
              className={styles.select}
              value={targetInstance}
              onChange={(e) => setTargetInstance(e.target.value)}
              disabled={submitting}
            >
              {writeableInstances.map((inst) => (
                <option key={inst.name} value={inst.name}>
                  {inst.name}
                </option>
              ))}
              {writeableInstances.length === 0 && (
                <option disabled value="">
                  No write-enabled instances
                </option>
              )}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ingest-source-type">
              Source type
            </label>
            <select
              id="ingest-source-type"
              className={styles.select}
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as IngestSourceType)}
              disabled={submitting}
            >
              <option value="document">Document</option>
              <option value="web">Web</option>
              <option value="conversation">Conversation</option>
              <option value="text">Text</option>
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ingest-title">
            Title
          </label>
          <input
            id="ingest-title"
            className={styles.input}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title…"
            disabled={submitting}
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ingest-url">
            Origin URL <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="ingest-url"
            className={styles.input}
            type="url"
            value={originUrl}
            onChange={(e) => setOriginUrl(e.target.value)}
            placeholder="https://…"
            disabled={submitting}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ingest-content">
            Content
          </label>
          <textarea
            id="ingest-content"
            className={styles.textarea}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste or drop content here…"
            disabled={submitting}
            required
            rows={8}
          />
        </div>

        {error && (
          <p className={styles.errorMessage} role="alert">{error}</p>
        )}

        {success && (
          <p className={styles.successMessage} aria-live="polite">
            Ingest submitted successfully.
          </p>
        )}

        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.resetButton}
            onClick={resetForm}
            disabled={submitting}
          >
            Reset
          </button>
          <button
            type="submit"
            className={styles.submitButton}
            disabled={!canSubmit}
            aria-busy={submitting}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  );
}
