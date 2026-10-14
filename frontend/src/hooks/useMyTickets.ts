import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { components } from '../api/schema'

export type MyTicket = components['schemas']['MyTicket']

export const MY_TICKETS_KEY = ['my-tickets'] as const

// Daftar tiket milik pelanggan yang sedang masuk. refetchMs mengatur seberapa
// sering diperiksa ulang ke server (cadangan kalau stream realtime putus).
export function useMyTickets(refetchMs: number | false = 15_000) {
  return useQuery({
    queryKey: MY_TICKETS_KEY,
    queryFn: async (): Promise<MyTicket[]> => {
      const { data, error, response } = await api.GET('/v1/me/tickets')
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    refetchInterval: refetchMs,
  })
}
