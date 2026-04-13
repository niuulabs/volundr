import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPersonas } from '../api/client';
import type { PersonaSummary, PersonaFilter } from '../api/types';
import { PersonaCard } from '../components/PersonaCard';
import { cn } from '@/modules/shared/utils/classnames';
import styles from './PersonasView.module.css';

const FILTERS: { key: PersonaFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'builtin', label: 'Built-in' },
  { key: 'custom', label: 'Custom' },
];

export function PersonasView() {
  const navigate = useNavigate();
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [loadedFilter, setLoadedFilter] = useState<PersonaFilter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PersonaFilter>('all');

  const loading = loadedFilter !== filter;

  useEffect(() => {
    listPersonas(filter)
      .then(data => {
        setPersonas(data);
        setError(null);
        setLoadedFilter(filter);
      })
      .catch(() => {
        setError('Failed to load personas');
        setLoadedFilter(filter);
      });
  }, [filter]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.filterBar}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={cn(styles.filterButton, filter === f.key && styles.filterButtonActive)}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button className={styles.newButton} onClick={() => navigate('/ravn/personas/~new')}>
          New Persona
        </button>
      </div>

      {loading && <div className={styles.status}>Loading personas…</div>}

      {!loading && error && <div className={styles.error}>{error}</div>}

      {!loading && !error && personas.length === 0 && (
        <div className={styles.status}>No personas found.</div>
      )}

      {!loading && !error && personas.length > 0 && (
        <div className={styles.grid}>
          {personas.map(persona => (
            <PersonaCard key={persona.name} persona={persona} />
          ))}
        </div>
      )}
    </div>
  );
}
