import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from './ui'

export function ExpandableList<T>({
  items,
  getKey,
  renderItem,
  initialCount = 3,
}: {
  items: T[]
  getKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  initialCount?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const visibleItems = expanded ? items : items.slice(0, initialCount)

  return <>
    {visibleItems.map((item) => <div key={getKey(item)}>{renderItem(item)}</div>)}
    {items.length > initialCount && <Button
      type="button"
      variant="ghost"
      className="border border-line-strong"
      onClick={() => setExpanded((current) => !current)}
      aria-expanded={expanded}
    >
      {expanded ? 'Tampilkan lebih sedikit' : `Lihat selengkapnya (${items.length - initialCount})`}
    </Button>}
  </>
}
