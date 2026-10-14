import { useEffect, useState } from 'react'

// Waktu sekarang (ms) yang diperbarui tiap interval. Untuk hitung mundur.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
