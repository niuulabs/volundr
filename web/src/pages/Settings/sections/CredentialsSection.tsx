import { useState, useCallback } from 'react';
import { Plus, Trash2, X, ShieldAlert } from 'lucide-react';
import type { SecretTypeInfo, CredentialCreateRequest, StoredCredential } from '@/models';
import { useCredentials as useCredentialsStore } from '@/hooks/useCredentials';
import type { IVolundrService } from '@/ports';
import styles from '../Settings.module.css';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TYPE_LABELS: Record<string, string> = {
  api_key: 'API Key',
  oauth_token: 'OAuth Token',
  git_credential: 'Git Credential',
  ssh_key: 'SSH Key',
  tls_cert: 'TLS Cert',
  generic: 'Generic',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/* ------------------------------------------------------------------ */
/* Credential Form (private)                                           */
/* ------------------------------------------------------------------ */

interface CredentialFormProps {
  types: SecretTypeInfo[];
  onSubmit: (req: CredentialCreateRequest) => Promise<void>;
  onClose: () => void;
}

function CredentialForm({ types, onSubmit, onClose }: CredentialFormProps) {
  const [step, setStep] = useState<'type' | 'data'>('type');
  const [selectedType, setSelectedType] = useState<SecretTypeInfo | null>(null);
  const [name, setName] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [genericEntries, setGenericEntries] = useState<Array<{ key: string; value: string }>>([
    { key: '', value: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectType = useCallback((typeInfo: SecretTypeInfo) => {
    setSelectedType(typeInfo);
    setStep('data');
    setFieldValues({});
    setGenericEntries([{ key: '', value: '' }]);
  }, []);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setFieldValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedType || !name.trim()) {
      return;
    }

    let data: Record<string, string>;

    if (selectedType.type === 'generic') {
      data = {};
      for (const entry of genericEntries) {
        if (entry.key.trim()) {
          data[entry.key.trim()] = entry.value;
        }
      }
    } else {
      data = { ...fieldValues };
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        secretType: selectedType.type,
        data,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create credential');
    } finally {
      setSubmitting(false);
    }
  }, [selectedType, name, fieldValues, genericEntries, onSubmit]);

  const canSubmit = name.trim().length > 0 && selectedType !== null && !submitting;

  return (
    <div className={styles.formOverlay}>
      <div className={styles.formPanel}>
        <div className={styles.formHeader}>
          <span className={styles.formTitle}>
            {step === 'type' ? 'Select Type' : 'Add Credential'}
          </span>
          <button type="button" className={styles.formCloseButton} onClick={onClose}>
            <X className={styles.formCloseIcon} />
          </button>
        </div>

        <div className={styles.formBody}>
          {step === 'type' ? (
            <div className={styles.typeGrid}>
              {types.map(t => (
                <button
                  key={t.type}
                  type="button"
                  className={styles.typeCard}
                  onClick={() => handleSelectType(t)}
                >
                  <div className={styles.typeCardLabel}>{t.label}</div>
                  <div className={styles.typeCardDesc}>{t.description}</div>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className={styles.formField}>
                <label className={styles.formLabel}>
                  Name
                  <span className={styles.formLabelRequired}>*</span>
                </label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="my-api-key"
                  pattern="^[a-z0-9_\-]+$"
                />
              </div>

              {selectedType &&
                selectedType.type !== 'generic' &&
                selectedType.fields.map(field => (
                  <div key={field.key} className={styles.formField}>
                    <label className={styles.formLabel}>
                      {field.label}
                      {field.required && <span className={styles.formLabelRequired}>*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        className={styles.formTextarea}
                        value={fieldValues[field.key] ?? ''}
                        onChange={e => handleFieldChange(field.key, e.target.value)}
                      />
                    ) : (
                      <input
                        type={field.type}
                        className={styles.formInput}
                        value={fieldValues[field.key] ?? ''}
                        onChange={e => handleFieldChange(field.key, e.target.value)}
                      />
                    )}
                  </div>
                ))}

              {selectedType?.type === 'generic' && (
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Key-Value Pairs</label>
                  {genericEntries.map((entry, idx) => (
                    <div key={idx} className={styles.kvRow}>
                      <input
                        type="text"
                        className={styles.kvInput}
                        placeholder="Key"
                        value={entry.key}
                        onChange={e => {
                          const next = [...genericEntries];
                          next[idx] = { ...next[idx], key: e.target.value };
                          setGenericEntries(next);
                        }}
                      />
                      <input
                        type="password"
                        className={styles.kvInput}
                        placeholder="Value"
                        value={entry.value}
                        onChange={e => {
                          const next = [...genericEntries];
                          next[idx] = { ...next[idx], value: e.target.value };
                          setGenericEntries(next);
                        }}
                      />
                      {genericEntries.length > 1 && (
                        <button
                          type="button"
                          className={styles.kvRemoveButton}
                          onClick={() => {
                            setGenericEntries(genericEntries.filter((_, i) => i !== idx));
                          }}
                        >
                          <X className={styles.kvRemoveIcon} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className={styles.kvAddButton}
                    onClick={() => setGenericEntries([...genericEntries, { key: '', value: '' }])}
                  >
                    <Plus className={styles.kvAddIcon} />
                    Add pair
                  </button>
                </div>
              )}

              {error && <div className={styles.formError}>{error}</div>}
            </>
          )}
        </div>

        {step === 'data' && (
          <div className={styles.formFooter}>
            <button type="button" className={styles.cancelButton} onClick={() => setStep('type')}>
              Back
            </button>
            <button
              type="button"
              className={styles.submitButton}
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CredentialsSection                                                   */
/* ------------------------------------------------------------------ */

interface CredentialsSectionProps {
  service: IVolundrService;
}

export function CredentialsSection({ service }: CredentialsSectionProps) {
  const {
    credentials,
    types,
    loading,
    createCredential,
    deleteCredential,
    filterByType,
    activeFilter,
    searchQuery,
    setSearchQuery,
  } = useCredentialsStore(service);

  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StoredCredential | null>(null);

  const handleCreate = useCallback(
    async (req: CredentialCreateRequest) => {
      await createCredential(req);
      setShowForm(false);
    },
    [createCredential]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    await deleteCredential(deleteTarget.name);
    setDeleteTarget(null);
  }, [deleteTarget, deleteCredential]);

  return (
    <>
      <div className={styles.contentHeader}>
        <div className={styles.toolbar}>
          <input
            type="text"
            placeholder="Search credentials..."
            className={styles.searchInput}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button
            type="button"
            className={styles.filterChip}
            data-active={activeFilter === null ? 'true' : undefined}
            onClick={() => filterByType(null)}
          >
            All
          </button>
          {types.map(t => (
            <button
              key={t.type}
              type="button"
              className={styles.filterChip}
              data-active={activeFilter === t.type ? 'true' : undefined}
              onClick={() => filterByType(t.type)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className={styles.addButton} onClick={() => setShowForm(true)}>
          <Plus className={styles.addButtonIcon} />
          Add Credential
        </button>
      </div>

      {loading ? (
        <div className={styles.loadingSpinner}>Loading...</div>
      ) : credentials.length === 0 ? (
        <div className={styles.emptyState}>
          <ShieldAlert className={styles.emptyStateIcon} />
          <span className={styles.emptyStateText}>No credentials stored</span>
        </div>
      ) : (
        <div className={styles.credentialGrid}>
          {credentials.map(cred => (
            <div key={cred.id} className={styles.credentialCard}>
              <div className={styles.credentialInfo}>
                <span className={styles.credentialName}>{cred.name}</span>
                <div className={styles.credentialMeta}>
                  <span className={styles.typeBadge} data-type={cred.secretType}>
                    {TYPE_LABELS[cred.secretType] ?? cred.secretType}
                  </span>
                  <span>
                    {cred.keys.length} key{cred.keys.length !== 1 ? 's' : ''}
                  </span>
                  <span>{formatDate(cred.createdAt)}</span>
                </div>
              </div>
              <div className={styles.credentialActions}>
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={() => setDeleteTarget(cred)}
                >
                  <Trash2 className={styles.deleteButtonIcon} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <CredentialForm types={types} onSubmit={handleCreate} onClose={() => setShowForm(false)} />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmPanel}>
            <p className={styles.confirmText}>
              Delete credential <strong>{deleteTarget.name}</strong>? This action cannot be undone.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.confirmDeleteButton}
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
