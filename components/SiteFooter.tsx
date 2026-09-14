const REPO = "https://github.com/visesh68/deep-research-invest";

const LINKS = [
  { href: `${REPO}/tree/main/transcripts`, label: "Run transcripts", hint: "Full agent traces" },
  { href: `${REPO}/blob/main/docs/HLD.md`, label: "Design docs", hint: "How it is built" },
  { href: REPO, label: "Source", hint: "GitHub" },
];

export default function SiteFooter() {
  return (
    <footer className="no-print mt-10 border-t border-hairline pt-6">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {LINKS.map((l, i) => (
            <li key={l.href} className="reveal" style={{ "--i": i + 1 } as React.CSSProperties}>
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-baseline gap-1.5 text-[13px] text-ink-2 transition-colors duration-200 hover:text-accent"
              >
                <span className="link-underline">{l.label}</span>
                <span className="text-[11px] text-muted-2 transition-colors duration-200 group-hover:text-accent/70">
                  {l.hint}
                </span>
                <svg viewBox="0 0 10 10" className="size-2 shrink-0 stroke-current" aria-hidden="true">
                  <path d="M2.5 7.5 7.5 2.5M3.6 2.5h3.9v3.9" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-2">
          Every local run writes a full trace — prompts, searches, tokens, timings.
        </p>
      </div>
    </footer>
  );
}
