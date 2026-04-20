import type { EdgeKind } from '../../domain';
import './ConnectionLegend.css';

interface LegendEntry {
  kind: EdgeKind;
  label: string;
}

/** Labels match the web2 prototype connection legend exactly. */
const EDGE_LEGEND: LegendEntry[] = [
  { kind: 'solid', label: 'Týr → Völundr' },
  { kind: 'dashed-anim', label: 'Týr ⇝ raid coord' },
  { kind: 'dashed-long', label: 'Bifröst → ext. model' },
  { kind: 'soft', label: 'ravn → Mímir' },
  { kind: 'raid', label: 'raid cohesion' },
];

export function ConnectionLegend() {
  return (
    <ul className="obs-conn-legend" aria-label="Connection types">
      {EDGE_LEGEND.map(({ kind, label }) => (
        <li
          key={kind}
          className="obs-conn-legend__item"
          data-kind={kind}
          data-testid={`legend-${kind}`}
        >
          <svg className="obs-conn-legend__line-svg" width={36} height={14} aria-hidden="true">
            <EdgeLine kind={kind} />
          </svg>
          <span className="obs-conn-legend__label">{label}</span>
        </li>
      ))}
    </ul>
  );
}

function EdgeLine({ kind }: { kind: EdgeKind }) {
  const y = 7;
  const base = {
    x1: 2,
    y1: y,
    x2: 34,
    y2: y,
    strokeLinecap: 'round' as const,
  };

  if (kind === 'solid') {
    return <line {...base} stroke="rgba(147,197,253,0.8)" strokeWidth={1.4} />;
  }

  if (kind === 'dashed-anim') {
    return (
      <line {...base} stroke="rgba(125,211,252,0.9)" strokeWidth={1.4} strokeDasharray="3 3">
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
    return (
      <line {...base} stroke="rgba(147,197,253,0.7)" strokeWidth={1.2} strokeDasharray="6 4" />
    );
  }

  if (kind === 'soft') {
    return (
      <line
        {...base}
        stroke="rgba(224,242,254,0.55)"
        strokeWidth={0.9}
        strokeLinecap="round"
      />
    );
  }

  // raid — dots + line
  return (
    <g>
      <circle cx={8} cy={y} r={3} fill="rgba(125,211,252,0.9)" />
      <circle cx={28} cy={y} r={3} fill="rgba(125,211,252,0.9)" />
      <line x1={11} y1={y} x2={25} y2={y} stroke="rgba(125,211,252,0.6)" strokeWidth={1} />
    </g>
  );
}
