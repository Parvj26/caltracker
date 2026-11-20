/**
 * A small trend line (decoration: the numbers beside it say the same), drawn with the design tokens. `invert` draws a
 * falling series as rising (assisted lifts, where less help is progress).
 */
export function Sparkline({ values, invert = false, className }: { values: readonly number[]; invert?: boolean; className?: string | undefined }) {
  const W = 64;
  const H = 24;
  const PAD = 3;
  if (values.length < 2) return <span className={className} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => PAD + (i / (values.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => {
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return PAD + (invert ? t : 1 - t) * (H - 2 * PAD);
  };
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className={className} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" data-testid="sparkline">
      <polyline points={points} fill="none" stroke="var(--ct-ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
