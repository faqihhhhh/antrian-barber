import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { components } from '../api/schema'

export type MeContext = components['schemas']['MeContext']

// data: undefined = sedang memuat, null = belum masuk, objek = sudah masuk.
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<MeContext | null> => {
      const { data, error, response } = await api.GET('/v1/me')
      if (response.status === 401) return null
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    staleTime: 60_000,
  })
}