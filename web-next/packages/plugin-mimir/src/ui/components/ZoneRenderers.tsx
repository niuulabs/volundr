import { Fragment } from 'react';
import { resolveWikilink } from '../../domain';
import { WikilinkPill } from './WikilinkPill';
import type { Zone, ZoneKeyFacts, ZoneRelationships, ZoneAssessment, ZoneTimeline } from '../../domain/page';
import type { PageMeta } from '../../domain/page';

interface ZoneRendererProps {
  zone: Zone;
  pages: PageMeta[];
  onNavigate: (path: string) => void;
}

function KeyFactsZone({ zone, pages, onNavigate }: ZoneRendererProps & { zone: ZoneKeyFacts }) {
  return (
    <ul>
      {zone.items.map((item, i) => {
        const parts = item.split(/(\[\[[^\]]+]])/g);
        return (
          <li key={i}>
            {parts.map((part, j) => {
              if (part.startsWith('[[') && part.endsWith(']]')) {
                const slug = part.slice(2, -2);
                const target = resolveWikilink(slug, pages);
                return (
                  <WikilinkPill
                    key={j}
                    slug={slug}
                    broken={target.broken}
                    onNavigate={onNavigate}
                  />
                );
              }
              return <Fragment key={j}>{part}</Fragment>;
            })}
          </li>
        );
      })}
    </ul>
  );
}

function RelationshipsZone({
  zone,
  pages,
  onNavigate,
}: ZoneRendererProps & { zone: ZoneRelationships }) {
  return (
    <ul>
      {zone.items.map((rel, i) => {
        const target = resolveWikilink(rel.slug, pages);
        return (
          <li key={i}>
            <WikilinkPill
              slug={rel.slug}
              broken={target.broken}
              onNavigate={onNavigate}
            />
            {rel.note && (
              <span className="mm-rel-note">— {rel.note}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AssessmentZone({ zone }: { zone: ZoneAssessment }) {
  return <p>{zone.text}</p>;
}

function TimelineZone({ zone }: { zone: ZoneTimeline }) {
  return (
    <div>
      {zone.items.map((entry, i) => (
        <div key={i} className="mm-timeline-entry">
          <span className="mm-timeline-date">{entry.date}</span>
          <span className="mm-timeline-note">{entry.note}</span>
        </div>
      ))}
      {zone.items.length === 0 && (
        <p className="mm-timeline-empty">no timeline entries yet</p>
      )}
    </div>
  );
}

export function ZoneBodyReadonly({
  zone,
  allPages,
  onNavigate,
}: {
  zone: Zone;
  allPages: PageMeta[];
  onNavigate: (path: string) => void;
}) {
  switch (zone.kind) {
    case 'key-facts':
      return <KeyFactsZone zone={zone} pages={allPages} onNavigate={onNavigate} />;
    case 'relationships':
      return <RelationshipsZone zone={zone} pages={allPages} onNavigate={onNavigate} />;
    case 'assessment':
      return <AssessmentZone zone={zone} />;
    case 'timeline':
      return <TimelineZone zone={zone} />;
  }
}

export function zoneToEditableText(zone: Zone): string {
  switch (zone.kind) {
    case 'key-facts':
      return zone.items.join('\n');
    case 'relationships':
      return zone.items.map((r) => `[[${r.slug}]] — ${r.note}`).join('\n');
    case 'assessment':
      return zone.text;
    case 'timeline':
      return zone.items.map((t) => `${t.date}: ${t.note}`).join('\n');
  }
}
