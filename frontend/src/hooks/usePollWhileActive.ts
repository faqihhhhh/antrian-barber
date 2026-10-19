import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MY_TICKETS_KEY } from './useMyTickets'

// Memeriksa ulang daftar tiket tiap intervalMs selama enabled = true.
export function usePollWhileActive(enabled: boolean, intervalMs: number) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    const poll = () => {
      if (document.visibilityState === 'visible') {
        void queryClient.invalidateQueries({ queryKey: MY_TICKETS_KEY })
      }
    }
    const id = window.setInterval(poll, intervalMs)
    document.addEventListener('visibilitychange', poll)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [enabled, intervalMs, queryClient])
}
