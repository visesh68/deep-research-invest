export default function ThesisSummary({ summary }: { summary: string }) {
  return (
    <p className="font-serif-display reveal text-[19px] leading-[1.62] text-ink">
      {summary}
    </p>
  );
}
