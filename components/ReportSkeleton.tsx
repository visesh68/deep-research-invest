/**
 * Ghost of the real report shown while a run is in flight. A 10-second wait behind
 * a single progress line reads as a hang; the same wait behind the shape of the
 * document that is coming reads as work in progress.
 */
function Line({ w, h = 12 }: { w: string; h?: number }) {
  return <span className="skeleton block" style={{ width: w, height: h }} />;
}

function Block({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <section
      className="reveal border-t border-hairline pt-7"
      style={{ "--d": `${index * 110}ms` } as React.CSSProperties}
    >
      {children}
    </section>
  );
}

export default function ReportSkeleton() {
  return (
    <div aria-hidden="true" className="no-print mx-auto max-w-[860px] pb-10">
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 space-y-3">
          <Line w="42%" h={30} />
          <Line w="28%" h={13} />
        </div>
        <Line w="88px" h={34} />
      </div>
      <span className="skeleton mt-5 block h-0.5 w-full" />

      <div className="mt-8 space-y-8">
        <Block index={1}>
          <Line w="18%" h={10} />
          <div className="mt-4 space-y-2.5">
            <Line w="100%" />
            <Line w="97%" />
            <Line w="62%" />
          </div>
        </Block>

        <Block index={2}>
          <Line w="22%" h={10} />
          <div className="mt-4 grid grid-cols-1 gap-8 sm:grid-cols-2">
            {[0, 1].map((c) => (
              <div key={c} className="space-y-2.5">
                <Line w="34%" h={10} />
                <Line w="100%" />
                <Line w="92%" />
                <Line w="96%" />
              </div>
            ))}
          </div>
        </Block>

        <Block index={3}>
          <Line w="20%" h={10} />
          <div className="mt-4 grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-4 bg-paper px-4 py-3.5">
                <Line w="46%" h={10} />
                <Line w="26%" h={14} />
              </div>
            ))}
          </div>
        </Block>
      </div>
    </div>
  );
}
