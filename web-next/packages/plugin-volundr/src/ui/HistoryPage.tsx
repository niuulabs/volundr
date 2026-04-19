import { useState } from 'react';
import { StateDot, Chip } from '@niuulabs/ui';
import type { Session } from '../domain/session';
import { useHistory } from './useHistory';
import type { HistoryOutcome } from './useHistory';
import './HistoryPage.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function outcomeState(state: Session['state']): 'idle' | 'failed' {
  return state === 'terminated' ? 'idle' : 'failed';
}

function outcomeLabel(state: Session['state']): string {
  return state === 'terminated' ? 'terminated' : 'failed';
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function durationMs(startedAt: string, terminatedAt: string | undefined): string {
  if (!terminatedAt) return '—';
  const ms = new Date(terminatedAt).getTime() - new Date(startedAt).getTime();
  const secs = Math.floor(ms / 1_000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

// ---------------------------------------------------------------------------
// HistoryPage
// ---------------------------------------------------------------------------

export function HistoryPage() {
  const [ravnId, setRavnId] = useState('');
  const [personaName, setPersonaName] = useState('');
  const [sagaId, setSagaId] = useState('');
  const [outcome, setOutcome] = useState<HistoryOutcome | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data, isLoading, isError, error } = useHistory({
    ravnId: ravnId || undefined,
    personaName: personaName || undefined,
    sagaId: sagaId || undefined,
    outcome: outcome || undefined,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
  });

  const hasFilters = Boolean(ravnId || personaName || sagaId || outcome || dateFrom || dateTo);

  function clearFilters() {
    setRavnId('');
    setPersonaName('');
    setSagaId('');
    setOutcome('');
    setDateFrom('');
    setDateTo('');
  }

  return (
    <div className="history-page">
      <h2 className="history-page__title">Session History</h2>

      <p className="history-page__subtitle">
        Terminated and failed sessions — filterable by raven, persona, saga, outcome, and date.
      </p>

      {/* Filter bar */}
      <div className="history-page__filters" role="search" aria-label="History filters">
        <input
          className="history-page__filter-input"
          type="text"
          placeholder="Filter by raven ID…"
          value={ravnId}
          onChange={(e) => setRavnId(e.target.value)}
          aria-label="Filter by raven ID"
        />
        <input
          className="history-page__filter-input"
          type="text"
          placeholder="Filter by persona…"
          value={personaName}
          onChange={(e) => setPersonaName(e.target.value)}
          aria-label="Filter by persona"
        />
        <input
          className="history-page__filter-input"
          type="text"
          placeholder="Filter by saga ID…"
          value={sagaId}
          onChange={(e) => setSagaId(e.target.value)}
          aria-label="Filter by saga"
        />

        <div className="history-page__outcome-group" role="group" aria-label="Filter by outcome">
          {(['', 'terminated', 'failed'] as const).map((o) => (
            <button
              key={o || 'all'}
              className={[
                'history-page__outcome-btn',
                outcome === o ? 'history-page__outcome-btn--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setOutcome(o)}
              aria-pressed={outcome === o}
              data-outcome={o || 'all'}
            >
              {o === '' ? 'All' : o}
            </button>
          ))}
        </div>

        <div className="history-page__date-row">
          <input
            className="history-page__filter-input"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="From date"
          />
          <span className="history-page__date-sep">to</span>
          <input
            className="history-page__filter-input"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="To date"
          />
        </div>

        {hasFilters && (
          <button className="history-page__clear" onClick={clearFilters} aria-label="Clear filters">
            Clear filters
          </button>
        )}
      </div>

      {isLoading && (
        <div className="history-page__status">
          <StateDot state="processing" pulse />
          <span>loading history…</span>
        </div>
      )}

      {isError && (
        <div className="history-page__status">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'failed to load history'}</span>
        </div>
      )}

      {!isLoading && !isError && data.length === 0 && (
        <p className="history-page__empty">No terminated sessions match the current filters.</p>
      )}

      {data.length > 0 && (
        <table className="history-page__table" aria-label="Terminated sessions">
          <thead>
            <tr>
              <th scope="col">Outcome</th>
              <th scope="col">Session ID</th>
              <th scope="col">Raven</th>
              <th scope="col">Persona</th>
              <th scope="col">Saga</th>
              <th scope="col">Terminated</th>
              <th scope="col">Duration</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((session) => (
              <tr key={session.id} className="history-page__row" data-testid="history-row">
                <td>
                  <div className="history-page__outcome">
                    <StateDot state={outcomeState(session.state)} />
                    <Chip tone={session.state === 'terminated' ? 'default' : 'critical'}>
                      {outcomeLabel(session.state)}
                    </Chip>
                  </div>
                </td>
                <td>
                  <span className="history-page__id">{session.id}</span>
                </td>
                <td className="history-page__ravn">{session.ravnId}</td>
                <td>{session.personaName}</td>
                <td>{session.sagaId ?? '—'}</td>
                <td className="history-page__date">{formatDate(session.terminatedAt)}</td>
                <td className="history-page__duration">
                  {durationMs(session.startedAt, session.terminatedAt)}
                </td>
                <td>
                  <a
                    href={`/volundr/history/${session.id}`}
                    className="history-page__detail-link"
                    aria-label={`View details for session ${session.id}`}
                  >
                    Details →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
