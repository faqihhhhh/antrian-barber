export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${light ? 'text-white' : 'text-ink'}`} aria-label="Kapsflow">
      <svg aria-hidden="true" viewBox="0 0 32 32" className="size-8 shrink-0" fill="none">
        <circle cx="7" cy="8" r="4" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="7" cy="24" r="4" stroke="currentColor" strokeWidth="2.5" />
        <path d="m10.5 10.5 16 15M10.5 21.5l16-15M14 16h13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {!compact && <span className="text-lg font-extrabold tracking-tight">Kapsflow</span>}
    </span>
  )
}
