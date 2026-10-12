import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'

export function useResendVerification(email: string) {
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/v1/auth/resend-verification', { body: { email } })
      if (!response.ok) throw new ApiError(error)
    },
  })
}