import { useState, useCallback } from 'react';
import type { CatalogEntry } from '@/models';
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

export function CredentialForm({ entry, onSubmit, onCancel, error }: CredentialFormProps) {
  const credentialFields = Object.keys(entry.credential_schema.properties ?? {});
  const configFields = Object.keys(entry.config_schema.properties ?? {});
  const requiredFields = new Set(entry.credential_schema.required ?? []);

  const [credentialName, setCredentialName] = useState(`${entry.slug}-credentials`);
  const [credentials, setCredentials] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of credentialFields) {
      init[key] = '';
    }
    return init;
  });
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of configFields) {
      init[key] = '';
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

        {credentialFields.map(key => (
          <div key={key} className={styles.field}>
            <label className={styles.label}>
              {formatLabel(key)}
              {requiredFields.has(key) ? ' *' : ''}
            </label>
            <input
              className={styles.input}
              type="password"
              value={credentials[key] ?? ''}
              onChange={e => setCredentials(prev => ({ ...prev, [key]: e.target.value }))}
              placeholder={`Enter ${formatLabel(key).toLowerCase()}`}
            />
          </div>
        ))}

        {configFields.map(key => (
          <div key={key} className={styles.field}>
            <label className={styles.label}>{formatLabel(key)}</label>
            <input
              className={styles.input}
              type="text"
              value={config[key] ?? ''}
              onChange={e => setConfig(prev => ({ ...prev, [key]: e.target.value }))}
              placeholder={`Enter ${formatLabel(key).toLowerCase()}`}
            />
          </div>
        ))}

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
