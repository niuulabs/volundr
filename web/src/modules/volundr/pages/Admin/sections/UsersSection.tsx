import { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, RefreshCw, Users } from 'lucide-react';
import type { VolundrProvisioningResult, VolundrUser } from '@/modules/volundr/models';
import type { IVolundrService } from '@/modules/volundr/ports';
import { cn } from '@/utils/classnames';
import styles from './UsersSection.module.css';

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

interface UsersSectionProps {
  service: IVolundrService;
}

export function UsersSection({ service }: UsersSectionProps) {
  const [users, setUsers] = useState<VolundrUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [reprovisioningUserId, setReprovisioningUserId] = useState<string | null>(null);
  const [reprovisionResult, setReprovisionResult] = useState<
    Record<string, VolundrProvisioningResult>
  >({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await service.listUsers();
        if (!cancelled) {
          setUsers(data);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [service]);

  const filtered = useMemo(() => {
    if (!search.trim()) {
      return users;
    }
    const q = search.toLowerCase();
    return users.filter(
      u =>
        u.email.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.status.toLowerCase().includes(q) ||
        (u.tenantId && u.tenantId.toLowerCase().includes(q))
    );
  }, [users, search]);

  const handleReprovision = useCallback(
    async (userId: string) => {
      setReprovisioningUserId(userId);
      try {
        const result = await service.reprovisionUser(userId);
        setReprovisionResult(prev => ({ ...prev, [userId]: result }));
      } finally {
        setReprovisioningUserId(null);
      }
    },
    [service]
  );

  if (loading) {
    return <div className={styles.loadingSpinner}>Loading users...</div>;
  }

  return (
    <div className={styles.section}>
      <input
        type="text"
        placeholder="Search users..."
        className={styles.searchInput}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Users className={styles.emptyStateIcon} />
          <span className={styles.emptyStateText}>
            {search.trim() ? 'No users match your search' : 'No users found'}
          </span>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Email</th>
              <th className={styles.th}>Display Name</th>
              <th className={styles.th}>Tenant</th>
              <th className={styles.th}>Status</th>
              <th className={styles.th}>Created</th>
              <th className={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(user => (
              <tr key={user.id}>
                <td className={styles.td}>{user.email}</td>
                <td className={styles.td}>{user.displayName}</td>
                <td className={styles.td}>
                  {user.tenantId ? (
                    <span className={styles.tenantLabel}>{user.tenantId}</span>
                  ) : (
                    <span className={styles.noTenant}>--</span>
                  )}
                </td>
                <td className={styles.td}>
                  <span className={styles.statusBadge} data-status={user.status}>
                    {user.status}
                  </span>
                  {user.status === 'failed' && user.provisionError && (
                    <span className={styles.provisionError}>{user.provisionError}</span>
                  )}
                </td>
                <td className={styles.td}>{formatDate(user.createdAt)}</td>
                <td className={styles.td}>
                  <button
                    type="button"
                    className={styles.reprovisionButton}
                    disabled={reprovisioningUserId === user.id}
                    onClick={() => handleReprovision(user.id)}
                  >
                    {reprovisioningUserId === user.id ? (
                      <Loader2 className={cn(styles.reprovisionIcon, styles.spinning)} />
                    ) : (
                      <RefreshCw className={styles.reprovisionIcon} />
                    )}
                    Reprovision
                  </button>
                  {reprovisionResult[user.id] && (
                    <span
                      className={styles.reprovisionResultBadge}
                      data-status={reprovisionResult[user.id].success ? 'success' : 'failed'}
                    >
                      {reprovisionResult[user.id].success ? 'OK' : 'Failed'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
