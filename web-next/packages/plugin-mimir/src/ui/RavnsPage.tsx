import { useState } from 'react';
import { StateDot, Chip, RavnAvatar } from '@niuulabs/ui';
import { useRavns } from '../application/useRavns';
import type { RavnBinding } from '../domain/ravn-binding';
import { RAVN_DOT_STATE } from './mimir.constants';
import { formatDuration, formatTimestamp } from './format';
import './RavnsPage.css';

// ---------------------------------------------------------------------------
// Directory card
// ---------------------------------------------------------------------------

interface RavnCardProps {
  ravn: RavnBinding;
  onClick: () => void;
}

function RavnCard({ ravn, onClick }: RavnCardProps) {
  return (
    <article
      className="ravn-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      data-testid="ravn-item"
      aria-label={`Warden ${ravn.ravnId}`}
    >
      <div className="ravn-card__head">
        <RavnAvatar
          role={ravn.role}
          rune={ravn.ravnRune}
          state={RAVN_DOT_STATE[ravn.state]}
          pulse={ravn.state === 'active'}
          size={36}
        />
        <div className="ravn-card__identity">
          <span className="ravn-card__name">{ravn.ravnId}</span>
          <span
            className={`ravn-card__state ravn-card__state--${ravn.state}`}
            data-testid="ravn-state"
          >
            {ravn.state}
          </span>
        </div>
      </div>

      <div className="ravn-card__role-row">
        <Chip tone="muted">{ravn.role}</Chip>
      </div>

      <div className="ravn-card__mounts">
        {ravn.mountNames.map((m) => (
          <Chip key={m} tone={m === ravn.writeMount ? 'brand' : 'muted'}>
            {m === ravn.writeMount ? `✎ ${m}` : m}
          </Chip>
        ))}
      </div>

      {ravn.lastDream ? (
        <div className="ravn-card__dream" data-testid="ravn-dream">
          <span className="ravn-card__dream-time">
            {formatTimestamp(ravn.lastDream.timestamp)}
          </span>
          <span className="ravn-card__dream-stat">
            <strong>{ravn.lastDream.pagesUpdated}</strong> pages ·{' '}
            <strong>{ravn.lastDream.entitiesCreated}</strong> entities ·{' '}
            {formatDuration(ravn.lastDream.durationMs)}
          </span>
        </div>
      ) : (
        <div className="ravn-card__dream ravn-card__dream--none" data-testid="ravn-no-dream">
          no dream cycles yet
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Profile view
// ---------------------------------------------------------------------------

interface RavnProfileProps {
  ravn: RavnBinding;
  onBack: () => void;
}

function RavnProfile({ ravn, onBack }: RavnProfileProps) {
  return (
    <div className="ravn-profile" data-testid="ravn-profile">
      <button
        type="button"
        className="ravn-profile__back"
        onClick={onBack}
        aria-label="Back to wardens list"
      >
        ← Wardens
      </button>

      <div className="ravn-profile__hero">
        <RavnAvatar
          role={ravn.role}
          rune={ravn.ravnRune}
          state={RAVN_DOT_STATE[ravn.state]}
          pulse={ravn.state === 'active'}
          size={48}
        />
        <div className="ravn-profile__hero-info">
          <h2 className="ravn-profile__name">{ravn.ravnId}</h2>
          <div className="ravn-profile__hero-row">
            <Chip tone="muted">{ravn.role}</Chip>
            <span
              className={`ravn-card__state ravn-card__state--${ravn.state}`}
              data-testid="ravn-state"
            >
              {ravn.state}
            </span>
          </div>
        </div>
      </div>

      <div className="ravn-profile__grid">
        {/* Mount bindings */}
        <section className="ravn-profile__section">
          <h4 className="ravn-profile__section-title">Mount bindings</h4>
          <div className="ravn-profile__mount-list">
            {ravn.mountNames.map((m) => (
              <div key={m} className="ravn-profile__mount-row">
                <Chip tone={m === ravn.writeMount ? 'brand' : 'muted'}>
                  {m === ravn.writeMount ? `✎ ${m}` : m}
                </Chip>
                {m === ravn.writeMount && (
                  <span className="ravn-profile__mount-mode">write mount</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Dream stats */}
        {ravn.lastDream ? (
          <section className="ravn-profile__section" data-testid="ravn-dream">
            <h4 className="ravn-profile__section-title">Last dream</h4>
            <div className="ravn-profile__stats">
              <div className="ravn-profile__stat">
                <span className="ravn-profile__stat-lbl">time</span>
                <span className="ravn-profile__stat-val">
                  {formatTimestamp(ravn.lastDream.timestamp)}
                </span>
              </div>
              <div className="ravn-profile__stat">
                <span className="ravn-profile__stat-lbl">pages updated</span>
                <strong className="ravn-profile__stat-val">{ravn.lastDream.pagesUpdated}</strong>
              </div>
              <div className="ravn-profile__stat">
                <span className="ravn-profile__stat-lbl">entities created</span>
                <strong className="ravn-profile__stat-val">
                  {ravn.lastDream.entitiesCreated}
                </strong>
              </div>
              <div className="ravn-profile__stat">
                <span className="ravn-profile__stat-lbl">lint fixes</span>
                <strong className="ravn-profile__stat-val">{ravn.lastDream.lintFixes}</strong>
              </div>
              <div className="ravn-profile__stat">
                <span className="ravn-profile__stat-lbl">duration</span>
                <span className="ravn-profile__stat-val ravn-profile__stat-val--mono">
                  {formatDuration(ravn.lastDream.durationMs)}
                </span>
              </div>
            </div>
          </section>
        ) : (
          <section className="ravn-profile__section" data-testid="ravn-no-dream">
            <h4 className="ravn-profile__section-title">Last dream</h4>
            <p className="ravn-profile__no-dream">no dream cycles yet</p>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function RavnsPage() {
  const { data, isLoading, isError, error } = useRavns();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId ? (data ?? []).find((r) => r.ravnId === selectedId) : null;

  if (selected) {
    return (
      <div className="ravns-page">
        <RavnProfile ravn={selected} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="ravns-page">
      <h2 className="ravns-page__title">Ravns</h2>
      <p className="ravns-page__subtitle">Per-ravn mount bindings and last dream-cycle summary.</p>

      {isLoading && (
        <div className="ravns-page__status">
          <StateDot state="processing" pulse />
          <span>loading ravns…</span>
        </div>
      )}

      {isError && (
        <div className="ravns-page__status">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'ravns load failed'}</span>
        </div>
      )}

      {!isLoading && !isError && data?.length === 0 && (
        <p className="ravns-page__empty">No ravn bindings found.</p>
      )}

      {data && data.length > 0 && (
        <div className="ravn-directory">
          {data.map((ravn) => (
            <RavnCard key={ravn.ravnId} ravn={ravn} onClick={() => setSelectedId(ravn.ravnId)} />
          ))}
        </div>
      )}
    </div>
  );
}
