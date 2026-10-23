export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <span role="img" aria-label="Trimwait" className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg">
      <img
        src={compact ? '/icons/icon-192.png' : light ? '/trimwait-logo-light.png' : '/trimwait-logo.png'}
        alt=""
        className={compact ? 'size-8 object-contain' : 'h-8 w-[156px] object-contain'}
      />
    </span>
  )
}
