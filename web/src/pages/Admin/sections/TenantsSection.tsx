import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type { VolundrMember, VolundrProvisioningResult, VolundrTenant } from '@/models';
import type { IVolundrService } from '@/ports';
import { cn } from '@/utils/classnames';
import styles from './TenantsSection.module.css';

function formatDate(iso: string | undefined): string {
  if (!iso) {
    return '--';
  }
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface TenantsSectionProps {
  service: IVolundrService;
}

export function TenantsSection({ service }: TenantsSectionProps) {
  const [tenants, setTenants] = useState<VolundrTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VolundrTenant | null>(null);
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    setLoading(true);
    try {
      const data = await service.getTenants();
      setTenants(data);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  const handleCreate = useCallback(
    async (data: { name: string; tier: string; maxSessions: number; maxStorageGb: number }) => {
      await service.createTenant(data);
      setShowForm(false);
      await loadTenants();
    },
    [service, loadTenants]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    await service.deleteTenant(deleteTarget.id);
    setDeleteTarget(null);
    await loadTenants();
  }, [deleteTarget, service, loadTenants]);

  const toggleExpand = useCallback((tenantId: string) => {
    setExpandedTenant(prev => (prev === tenantId ? null : tenantId));
  }, []);

  if (loading) {
    return <div className={styles.loadingSpinner}>Loading tenants...</div>;
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <span />
        <button type="button" className={styles.addButton} onClick={() => setShowForm(true)}>
          <Plus className={styles.addButtonIcon} />
          Create Tenant
        </button>
      </div>

      {tenants.length === 0 ? (
        <div className={styles.emptyState}>
          <Building2 className={styles.emptyStateIcon} />
          <span className={styles.emptyStateText}>No tenants found</span>
        </div>
      ) : (
        <div className={styles.grid}>
          {tenants.map(tenant => (
            <div key={tenant.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <button
                  type="button"
                  className={styles.expandToggle}
                  onClick={() => toggleExpand(tenant.id)}
                >
                  {expandedTenant === tenant.id ? (
                    <ChevronDown className={styles.expandIcon} />
                  ) : (
                    <ChevronRight className={styles.expandIcon} />
                  )}
                  <span className={styles.cardName}>{tenant.name}</span>
                </button>
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={() => setDeleteTarget(tenant)}
                >
                  <Trash2 className={styles.deleteButtonIcon} />
                </button>
              </div>
              <span className={styles.cardPath}>{tenant.path}</span>
              <div className={styles.cardMeta}>
                <span className={styles.tierBadge} data-tier={tenant.tier}>
                  {tenant.tier}
                </span>
                <span>{tenant.maxSessions} sessions</span>
                <span>{tenant.maxStorageGb} GB</span>
                <span>{formatDate(tenant.createdAt)}</span>
              </div>

              {expandedTenant === tenant.id && (
                <TenantDetails tenant={tenant} service={service} onUpdated={loadTenants} />
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && <TenantForm onSubmit={handleCreate} onClose={() => setShowForm(false)} />}

      {deleteTarget && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmPanel}>
            <p className={styles.confirmText}>
              Delete tenant <strong>{deleteTarget.name}</strong>? This action cannot be undone.
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tenant Details (Members, Editable Settings, Reprovision)           */
/* ------------------------------------------------------------------ */

interface TenantDetailsProps {
  tenant: VolundrTenant;
  service: IVolundrService;
  onUpdated: () => Promise<void>;
}

function TenantDetails({ tenant, service, onUpdated }: TenantDetailsProps) {
  const [members, setMembers] = useState<VolundrMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const [editTier, setEditTier] = useState(tenant.tier);
  const [editMaxSessions, setEditMaxSessions] = useState(tenant.maxSessions);
  const [editMaxStorageGb, setEditMaxStorageGb] = useState(tenant.maxStorageGb);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [reprovisioning, setReprovisioning] = useState(false);
  const [reprovisionResults, setReprovisionResults] = useState<VolundrProvisioningResult[] | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setMembersLoading(true);
      try {
        const data = await service.getTenantMembers(tenant.id);
        if (!cancelled) {
          setMembers(data);
        }
      } finally {
        if (!cancelled) {
          setMembersLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [service, tenant.id]);

  const hasChanges =
    editTier !== tenant.tier ||
    editMaxSessions !== tenant.maxSessions ||
    editMaxStorageGb !== tenant.maxStorageGb;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await service.updateTenant(tenant.id, {
        tier: editTier,
        maxSessions: editMaxSessions,
        maxStorageGb: editMaxStorageGb,
      });
      await onUpdated();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [service, tenant.id, editTier, editMaxSessions, editMaxStorageGb, onUpdated]);

  const handleReprovision = useCallback(async () => {
    setReprovisioning(true);
    setReprovisionResults(null);
    try {
      const results = await service.reprovisionTenant(tenant.id);
      setReprovisionResults(results);
    } finally {
      setReprovisioning(false);
    }
  }, [service, tenant.id]);

  return (
    <div className={styles.detailsPanel}>
      {/* Editable Settings */}
      <div className={styles.detailsSection}>
        <h4 className={styles.detailsSectionTitle}>Settings</h4>
        <div className={styles.settingsGrid}>
          <div className={styles.settingsField}>
            <label className={styles.settingsLabel}>Tier</label>
            <select
              className={styles.settingsSelect}
              value={editTier}
              onChange={e => setEditTier(e.target.value)}
            >
              <option value="developer">Developer</option>
              <option value="team">Team</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div className={styles.settingsField}>
            <label className={styles.settingsLabel}>Max Sessions</label>
            <input
              type="number"
              className={styles.settingsInput}
              value={editMaxSessions}
              onChange={e => setEditMaxSessions(Number(e.target.value))}
              min={1}
            />
          </div>
          <div className={styles.settingsField}>
            <label className={styles.settingsLabel}>Max Storage (GB)</label>
            <input
              type="number"
              className={styles.settingsInput}
              value={editMaxStorageGb}
              onChange={e => setEditMaxStorageGb(Number(e.target.value))}
              min={1}
            />
          </div>
        </div>
        {saveError && <div className={styles.errorText}>{saveError}</div>}
        <div className={styles.settingsActions}>
          <button
            type="button"
            className={cn(styles.saveButton, !hasChanges && styles.saveButtonDisabled)}
            disabled={!hasChanges || saving}
            onClick={handleSave}
          >
            <Save className={styles.actionIcon} />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Members */}
      <div className={styles.detailsSection}>
        <h4 className={styles.detailsSectionTitle}>Members</h4>
        {membersLoading ? (
          <div className={styles.detailsLoading}>Loading members...</div>
        ) : members.length === 0 ? (
          <div className={styles.detailsEmpty}>No members found</div>
        ) : (
          <table className={styles.membersTable}>
            <thead>
              <tr>
                <th className={styles.membersTh}>Email</th>
                <th className={styles.membersTh}>Role</th>
                <th className={styles.membersTh}>Granted</th>
              </tr>
            </thead>
            <tbody>
              {members.map(member => (
                <tr key={member.userId}>
                  <td className={styles.membersTd}>{member.userId}</td>
                  <td className={styles.membersTd}>
                    <span className={styles.roleBadge}>{member.role}</span>
                  </td>
                  <td className={styles.membersTd}>{formatDate(member.grantedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reprovision */}
      <div className={styles.detailsSection}>
        <div className={styles.reprovisionRow}>
          <button
            type="button"
            className={styles.reprovisionButton}
            disabled={reprovisioning}
            onClick={handleReprovision}
          >
            {reprovisioning ? (
              <Loader2 className={cn(styles.actionIcon, styles.spinning)} />
            ) : (
              <RefreshCw className={styles.actionIcon} />
            )}
            {reprovisioning ? 'Reprovisioning...' : 'Reprovision All Users'}
          </button>
        </div>

        {reprovisionResults && reprovisionResults.length > 0 && (
          <div className={styles.reprovisionResults}>
            {reprovisionResults.map(result => (
              <div
                key={result.userId}
                className={styles.reprovisionResult}
                data-success={result.success}
              >
                <span className={styles.reprovisionUserId}>{result.userId}</span>
                <span
                  className={styles.reprovisionStatus}
                  data-status={result.success ? 'success' : 'failed'}
                >
                  {result.success ? 'OK' : 'Failed'}
                </span>
                {result.errors.length > 0 && (
                  <span className={styles.reprovisionErrors}>{result.errors.join(', ')}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {reprovisionResults && reprovisionResults.length === 0 && (
          <div className={styles.detailsEmpty}>No users to reprovision</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tenant Create Form                                                  */
/* ------------------------------------------------------------------ */

interface TenantFormProps {
  onSubmit: (data: {
    name: string;
    tier: string;
    maxSessions: number;
    maxStorageGb: number;
  }) => Promise<void>;
  onClose: () => void;
}

function TenantForm({ onSubmit, onClose }: TenantFormProps) {
  const [name, setName] = useState('');
  const [tier, setTier] = useState('developer');
  const [maxSessions, setMaxSessions] = useState(10);
  const [maxStorageGb, setMaxStorageGb] = useState(50);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        tier,
        maxSessions,
        maxStorageGb,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tenant');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, name, tier, maxSessions, maxStorageGb, onSubmit]);

  return (
    <div className={styles.formOverlay}>
      <div className={styles.formPanel}>
        <div className={styles.formHeader}>
          <span className={styles.formTitle}>Create Tenant</span>
          <button type="button" className={styles.formCloseButton} onClick={onClose}>
            <X className={styles.formCloseIcon} />
          </button>
        </div>

        <div className={styles.formBody}>
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
              placeholder="My Team"
            />
          </div>

          <div className={styles.formField}>
            <label className={styles.formLabel}>Tier</label>
            <select
              className={styles.formSelect}
              value={tier}
              onChange={e => setTier(e.target.value)}
            >
              <option value="developer">Developer</option>
              <option value="team">Team</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          <div className={styles.formField}>
            <label className={styles.formLabel}>Max Sessions</label>
            <input
              type="number"
              className={styles.formInput}
              value={maxSessions}
              onChange={e => setMaxSessions(Number(e.target.value))}
              min={1}
            />
          </div>

          <div className={styles.formField}>
            <label className={styles.formLabel}>Max Storage (GB)</label>
            <input
              type="number"
              className={styles.formInput}
              value={maxStorageGb}
              onChange={e => setMaxStorageGb(Number(e.target.value))}
              min={1}
            />
          </div>

          {error && <div className={styles.formError}>{error}</div>}
        </div>

        <div className={styles.formFooter}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            Cancel
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
      </div>
    </div>
  );
}
