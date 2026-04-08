import { useState, useCallback } from 'react';
import { Plus, Trash2, KeyRound } from 'lucide-react';
import { volundrService } from '@/modules/volundr/adapters';
import { useTokens } from '@/modules/volundr/hooks/useTokens';
import { NewTokenOverlay } from './NewTokenOverlay';
import styles from './AccessTokensSection.module.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AccessTokensSection() {
  const { tokens, loading, createToken, revokeToken, refresh } = useTokens(volundrService);

  const [showForm, setShowForm] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [revokeErrors, setRevokeErrors] = useState<Record<string, string>>({});

  const handleCreate = useCallback(async () => {
    if (!tokenName.trim()) {
      return;
    }
    try {
      setCreating(true);
      setCreateError(null);
      const result = await createToken(tokenName.trim());
      setRawToken(result.token);
      setTokenName('');
      setShowForm(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setCreating(false);
    }
  }, [tokenName, createToken]);

  const handleRevoke = useCallback(
    async (id: string) => {
      setRevokeErrors(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        await revokeToken(id);
      } catch (err) {
        setRevokeErrors(prev => ({
          ...prev,
          [id]: err instanceof Error ? err.message : 'Failed to revoke token',
        }));
      }
    },
    [revokeToken]
  );

  const handleOverlayDone = useCallback(async () => {
    setRawToken(null);
    await refresh();
  }, [refresh]);

  if (loading) {
    return <div className={styles.loading}>Loading tokens...</div>;
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Access Tokens</h2>
          <p className={styles.subtitle}>Personal access tokens for API authentication.</p>
        </div>
        <button className={styles.newButton} onClick={() => setShowForm(true)} type="button">
          <Plus className={styles.newButtonIcon} />
          New Token
        </button>
      </div>

      {showForm && (
        <div className={styles.createForm}>
          <input
            className={styles.nameInput}
            type="text"
            placeholder="Token name"
            value={tokenName}
            onChange={e => setTokenName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleCreate();
              }
            }}
            autoFocus
          />
          <button
            className={styles.createButton}
            onClick={handleCreate}
            disabled={!tokenName.trim() || creating}
            type="button"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
          <button
            className={styles.cancelButton}
            onClick={() => {
              setShowForm(false);
              setTokenName('');
              setCreateError(null);
            }}
            type="button"
          >
            Cancel
          </button>
          {createError && <p className={styles.error}>{createError}</p>}
        </div>
      )}

      {tokens.length === 0 ? (
        <div className={styles.emptyState}>
          <KeyRound className={styles.emptyIcon} />
          <p className={styles.emptyText}>
            No access tokens. Create one to allow external services like Tyr to authenticate as you.
          </p>
        </div>
      ) : (
        <div className={styles.tokenList}>
          {tokens.map(token => (
            <div key={token.id} className={styles.tokenRow}>
              <div className={styles.tokenInfo}>
                <span className={styles.tokenName}>{token.name}</span>
                <span className={styles.tokenMeta}>
                  Created {formatDate(token.createdAt)}
                  {token.lastUsedAt && ` · Last used ${formatDate(token.lastUsedAt)}`}
                </span>
              </div>
              <div className={styles.tokenActions}>
                <button
                  className={styles.revokeButton}
                  onClick={() => handleRevoke(token.id)}
                  type="button"
                  aria-label={`Revoke ${token.name}`}
                >
                  <Trash2 className={styles.revokeIcon} />
                  Revoke
                </button>
              </div>
              {revokeErrors[token.id] && (
                <p className={styles.rowError}>{revokeErrors[token.id]}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {rawToken && <NewTokenOverlay token={rawToken} onDone={handleOverlayDone} />}
    </div>
  );
}
