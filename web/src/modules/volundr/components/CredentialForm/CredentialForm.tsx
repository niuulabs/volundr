import { useState, useCallback } from 'react';
import type { CatalogEntry, SchemaProperty } from '@/modules/volundr/models';
import styles from './CredentialForm.module.css';

interface CredentialFormProps {
  entry: CatalogEntry;
  onSubmit: (
    credentialName: string,
    credentials: Record<string, string>,
    config: Record<string, string>
  ) => void;
  onCancel: () => void;
  error?: string;
}

function schemaInputType(prop: SchemaProperty | undefined): string {
  if (!prop) return 'text';
  switch (prop.type) {
    case 'password':
      return 'password';
    case 'url':
      return 'url';
    case 'email':
      return 'email';
    default:
      return 'text';
  }
}

interface TagInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

function TagInput({ value, onChange, placeholder }: TagInputProps) {
  const tags = value
    ? value
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
    : [];
  const [inputValue, setInputValue] = useState('');

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag || tags.includes(tag)) return;
    const next = [...tags, tag].join(', ');
    onChange(next);
  };

  const removeTag = (index: number) => {
    const next = tags.filter((_, i) => i !== index).join(', ');
    onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
      setInputValue('');
    }
    if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) {
      addTag(inputValue);
      setInputValue('');
    }
  };

  return (
    <div className={styles.tagContainer}>
      <div className={styles.tagList}>
        {tags.map((tag, i) => (
          <span key={tag} className={styles.tag}>
            {tag}
            <button
              type="button"
              className={styles.tagRemove}
              onClick={() => removeTag(i)}
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className={styles.tagInput}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={tags.length === 0 ? placeholder : ''}
        />
      </div>
    </div>
  );
}

export function CredentialForm({ entry, onSubmit, onCancel, error }: CredentialFormProps) {
  const credentialProps = entry.credential_schema.properties ?? {};
  const configProps = entry.config_schema.properties ?? {};
  const credentialFields = Object.keys(credentialProps);
  const configFields = Object.keys(configProps);
  const requiredFields = new Set(entry.credential_schema.required ?? []);

  const [credentialName, setCredentialName] = useState(`${entry.slug}-credentials`);
  const [credentials, setCredentials] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of credentialFields) {
      init[key] = credentialProps[key]?.default ?? '';
    }
    return init;
  });
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of configFields) {
      init[key] = configProps[key]?.default ?? '';
    }
    return init;
  });

  const allRequiredFilled = [...requiredFields].every(f => credentials[f]?.trim());

  const handleSubmit = useCallback(() => {
    if (!allRequiredFilled || !credentialName.trim()) {
      return;
    }
    onSubmit(credentialName.trim(), credentials, config);
  }, [allRequiredFilled, credentialName, credentials, config, onSubmit]);

  const labelFor = (key: string, prop: SchemaProperty | undefined): string =>
    prop?.label ?? formatLabel(key);

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <h3 className={styles.title}>Connect {entry.name}</h3>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.field}>
          <label className={styles.label}>Credential Name</label>
          <input
            className={styles.input}
            type="text"
            value={credentialName}
            onChange={e => setCredentialName(e.target.value)}
          />
          <div className={styles.hint}>A name to identify this credential in the vault</div>
        </div>

        {credentialFields.map(key => {
          const prop = credentialProps[key];
          return (
            <div key={key} className={styles.field}>
              <label className={styles.label}>
                {labelFor(key, prop)}
                {requiredFields.has(key) ? ' *' : ''}
              </label>
              <input
                className={styles.input}
                type={
                  prop?.type === 'password' || !prop?.type || prop.type === 'string'
                    ? 'password'
                    : schemaInputType(prop)
                }
                value={credentials[key] ?? ''}
                onChange={e => setCredentials(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={`Enter ${labelFor(key, prop).toLowerCase()}`}
              />
            </div>
          );
        })}

        {configFields.map(key => {
          const prop = configProps[key];
          const isArray = prop?.type === 'string[]';
          return (
            <div key={key} className={styles.field}>
              <label className={styles.label}>{labelFor(key, prop)}</label>
              {isArray ? (
                <>
                  <TagInput
                    value={config[key] ?? ''}
                    onChange={val => setConfig(prev => ({ ...prev, [key]: val }))}
                    placeholder={`Enter ${labelFor(key, prop).toLowerCase()}`}
                  />
                  <div className={styles.hint}>Separate with commas</div>
                </>
              ) : (
                <input
                  className={styles.input}
                  type={schemaInputType(prop)}
                  value={config[key] ?? ''}
                  onChange={e => setConfig(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={`Enter ${labelFor(key, prop).toLowerCase()}`}
                />
              )}
            </div>
          );
        })}

        <div className={styles.actions}>
          <button className={styles.cancelButton} onClick={onCancel}>
            Cancel
          </button>
          <button
            className={styles.submitButton}
            disabled={!allRequiredFilled || !credentialName.trim()}
            onClick={handleSubmit}
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}

function formatLabel(key: string): string {
  return key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
