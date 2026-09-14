/**
 * The footnote markers that follow a cited claim.
 *
 * Shared rather than duplicated so a price quote in the masthead and a bullet in
 * the body cite identically — same target, same affordance, one place to change.
 */
export default function CiteMarks({ sourceIds }: { sourceIds: number[] }) {
  if (sourceIds.length === 0) return null;
  return (
    <span className="ml-1 inline-flex gap-0.5 align-super">
      {sourceIds.map((id) => (
        <a
          key={id}
          href={`#src-${id}`}
          className="nums rounded-[3px] bg-accent-bg px-1 text-[10px] font-medium text-accent no-underline transition-colors duration-150 hover:bg-accent hover:text-white"
          aria-label={`Source ${id}`}
        >
          {id}
        </a>
      ))}
    </span>
  );
}
