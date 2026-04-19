import type { EdgeKind } from '../../domain';
import './ConnectionLegend.css';

interface LegendEntry {
  kind: EdgeKind;
  label: string;
  description: string;
}

const EDGE_LEGEND: LegendEntry[] = [
  { kind: 'solid', label: 'Direct', description: 'coordinator link' },
  { kind: 'dashed-anim', label: 'Active', description: 'raid dispatch' },
  { kind: 'dashed-long', label: 'Async', description: 'memory access' },
  { kind: 'soft', label: 'Cache', description: 'weak reference' },
  { kind: 'raid', label: 'Coord', description: 'inter-raven' },
];

export function ConnectionLegend() {
  return (
    <ul className="obs-conn-legend" aria-label="Connection types">
      {EDGE_LEGEND.map(({ kind, label, description }) => (
        <li
          key={kind}
          className="obs-conn-legend__item"
          data-kind={kind}
          data-testid={`legend-${kind}`}
        >
          <svg className="obs-conn-legend__line-svg" width={32} height={12} aria-hidden="true">
            <EdgeLine kind={kind} />
          </svg>
          <span className="obs-conn-legend__label">{label}</span>
          <span className="obs-conn-legend__desc">{description}</span>
        </li>
      ))}
    </ul>
  );
}

function EdgeLine({ kind }: { kind: EdgeKind }) {
  const y = 6;
  const base = {
    x1: 2,
    y1: y,
    x2: 30,
    y2: y,
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
  };

  if (kind === 'solid') {
    return <line {...base} stroke="var(--color-text-primary)" />;
  }

  if (kind === 'dashed-anim') {
    return (
      <line {...base} stroke="var(--color-brand)" strokeDasharray="4 2">
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </line>
    );
  }

  if (kind === 'dashed-long') {
    return <line {...base} stroke="var(--color-text-secondary)" strokeDasharray="6 4" />;
  }

  if (kind === 'soft') {
    return (
      <line
        {...base}
        stroke="var(--color-text-muted)"
        strokeDasharray="1 3"
        strokeLinecap="round"
      />
    );
  }

  // raid — solid with midpoint marker
  return (
    <g>
      <line {...base} stroke="var(--color-accent-purple)" />
      <circle cx={16} cy={y} r={2} fill="var(--color-accent-purple)" />
    </g>
  );
}
