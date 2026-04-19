import { useState } from 'react';
import { Chip, StateDot } from '@niuulabs/ui';
import { useEntities } from '../application/useEntities';
import { ENTITY_KINDS } from '../domain/entity';
import type { EntityKind } from '../domain/entity';
import './EntitiesPage.css';

const KIND_ICONS: Record<EntityKind, string> = {
  person: '👤',
  org: '🏢',
  concept: '💡',
  project: '📦',
  component: '⚙️',
  technology: '🔧',
};

export function EntitiesPage() {
  const [filterKind, setFilterKind] = useState<EntityKind | undefined>(undefined);
  const { entities, grouped, isLoading, isError, error } = useEntities(filterKind);

  const kindsWithEntities = filterKind
    ? [filterKind]
    : ENTITY_KINDS.filter((k) => (grouped[k]?.length ?? 0) > 0);

  return (
    <div className="entities-page">
      <h2 className="entities-page__title">Entities</h2>

      <div
        className="entities-page__filter"
        role="group"
        aria-label="Filter by entity type"
      >
        <button
          className={[
            'entities-page__filter-btn',
            filterKind == null ? 'entities-page__filter-btn--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => setFilterKind(undefined)}
          aria-pressed={filterKind == null}
        >
          All
        </button>
        {ENTITY_KINDS.map((k) => (
          <button
            key={k}
            className={[
              'entities-page__filter-btn',
              filterKind === k ? 'entities-page__filter-btn--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setFilterKind(filterKind === k ? undefined : k)}
            aria-pressed={filterKind === k}
            data-kind={k}
          >
            {KIND_ICONS[k]} {k}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="entities-page__status">
          <StateDot state="processing" pulse />
          <span>loading entities…</span>
        </div>
      )}

      {isError && (
        <div className="entities-page__status">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'entities load failed'}</span>
        </div>
      )}

      {!isLoading && !isError && entities.length === 0 && (
        <p className="entities-page__empty">No entities found.</p>
      )}

      {kindsWithEntities.map((kind) => {
        const group = grouped[kind] ?? [];
        if (group.length === 0) return null;
        return (
          <section key={kind} className="entities-page__group">
            <h3 className="entities-page__group-title">
              {KIND_ICONS[kind]} {kind}
              <Chip tone="muted">{group.length}</Chip>
            </h3>
            <ul className="entities-page__list" aria-label={`${kind} entities`}>
              {group.map((entity) => (
                <li key={entity.path} className="entities-page__item" data-testid="entity-item">
                  <div className="entities-page__item-header">
                    <span className="entities-page__item-title">{entity.title}</span>
                    {entity.relationshipCount > 0 && (
                      <Chip tone="muted">{entity.relationshipCount} links</Chip>
                    )}
                  </div>
                  <p className="entities-page__item-summary">{entity.summary}</p>
                  <span className="entities-page__item-path">{entity.path}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
