export interface SparklineProps {
  /** Array of data points — last 24 are used. */
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Inline SVG sparkline. Renders a polyline from the provided values.
 * Normalises the range to fill the viewport height.
 */
export function Sparkline({ values, width = 48, height = 16, className }: SparklineProps) {
  const pts = values.slice(-24);
  if (pts.length < 2) return null;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;

  const stepX = width / (pts.length - 1);
  const points = pts
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className={className}
      style={{ opacity: 0.5 }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
