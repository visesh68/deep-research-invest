/**
 * Ascending bars in a navy tile. Geometric rather than illustrative so it holds up
 * at favicon size, and monochrome-safe — the violet bar is identity, not meaning.
 */
export default function Logo({ className = "size-9" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      className={className}
      role="img"
      aria-label="Thesis"
      fill="none"
    >
      <rect width="36" height="36" rx="9" fill="var(--navy)" />
      <rect x="9" y="21.5" width="4" height="6.5" rx="1.6" fill="#fff" fillOpacity="0.5" />
      <rect x="16" y="16" width="4" height="12" rx="1.6" fill="#fff" fillOpacity="0.78" />
      <rect x="23" y="8.5" width="4" height="19.5" rx="1.6" fill="var(--accent-lift)" />
    </svg>
  );
}
