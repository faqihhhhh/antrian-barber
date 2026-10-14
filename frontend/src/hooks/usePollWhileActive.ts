import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MY_TICKETS_KEY } from './useMyTickets'

// Memeriksa ulang daftar tiket tiap intervalMs selama enabled = true.
export function usePollWhileActive(enabled: boolean, intervalMs: number) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: MY_TICKETS_KEY })
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [enabled, intervalMs, queryClient])
}
