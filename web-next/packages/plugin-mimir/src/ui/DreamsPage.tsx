import { StateDot, Chip } from '@niuulabs/ui';
import { useDreams } from '../application/useDreams';
import type { DreamCycle } from '../domain/lint';
import './DreamsPage.css';

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

interface DreamRowProps {
  cycle: DreamCycle;
}

function DreamRow({ cycle }: DreamRowProps) {
  const totalActivity = cycle.pagesUpdated + cycle.entitiesCreated + cycle.lintFixes;

  return (
    <li className="dreams-page__cycle" data-testid="dream-cycle">
      <div className="dreams-page__cycle-header">
        <span className="dreams-page__cycle-time">{formatTimestamp(cycle.timestamp)}</span>
        <Chip tone="muted">{cycle.ravn}</Chip>
        <span className="dreams-page__cycle-duration">{formatDuration(cycle.durationMs)}</span>
      </div>

      <div className="dreams-page__cycle-mounts">
        {cycle.mounts.map((m) => (
          <Chip key={m} tone="muted">
            {m}
          </Chip>
        ))}
      </div>

      <div className="dreams-page__cycle-stats">
        <span
          className={[
            'dreams-page__cycle-stat',
            cycle.pagesUpdated > 0 ? 'dreams-page__cycle-stat--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-testid="dream-pages"
        >
          <strong>{cycle.pagesUpdated}</strong> pages updated
        </span>
        <span
          className={[
            'dreams-page__cycle-stat',
            cycle.entitiesCreated > 0 ? 'dreams-page__cycle-stat--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-testid="dream-entities"
        >
          <strong>{cycle.entitiesCreated}</strong> entities created
        </span>
        <span
          className={[
            'dreams-page__cycle-stat',
            cycle.lintFixes > 0 ? 'dreams-page__cycle-stat--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-testid="dream-fixes"
        >
          <strong>{cycle.lintFixes}</strong> lint fixes
        </span>
        {totalActivity === 0 && (
          <span className="dreams-page__cycle-stat dreams-page__cycle-stat--idle">
            no changes
          </span>
        )}
      </div>
    </li>
  );
}

export function DreamsPage() {
  const { data, isLoading, isError, error } = useDreams();

  return (
    <div className="dreams-page">
      <h2 className="dreams-page__title">Dreams</h2>
      <p className="dreams-page__subtitle">
        Dream-cycle history — idle-time synthesis passes that update pages, create entities, and
        apply lint fixes.
      </p>

      {isLoading && (
        <div className="dreams-page__status">
          <StateDot state="processing" pulse />
          <span>loading dream cycles…</span>
        </div>
      )}

      {isError && (
        <div className="dreams-page__status">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'dream cycles load failed'}</span>
        </div>
      )}

      {!isLoading && !isError && data?.length === 0 && (
        <p className="dreams-page__empty">No dream cycles recorded yet.</p>
      )}

      {data && data.length > 0 && (
        <ul className="dreams-page__list" aria-label="Dream cycle history">
          {data.map((cycle) => (
            <DreamRow key={cycle.id} cycle={cycle} />
          ))}
        </ul>
      )}
    </div>
  );
}
