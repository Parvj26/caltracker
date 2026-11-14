/**
 * A thin chevron (‹ or ›) drawn as a line icon. The text glyphs render as heavy "( )" in iPhone Safari's system font,
 * so arrows use this instead. Decorative: the control around it carries the name.
 */
export function ChevronIcon({ direction, size = 20 }: { direction: 'left' | 'right'; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-chevron={direction}
    >
      <path d={direction === 'left' ? 'M14.5 6 8.5 12l6 6' : 'M9.5 6l6 6-6 6'} />
    </svg>
  );
}
