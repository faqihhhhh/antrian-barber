import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { MY_TICKETS_KEY, type MyTicket } from '../hooks/useMyTickets'
import { Alert, Button } from './ui'

const RATING_WORD = ['', 'Kurang puas', 'Biasa saja', 'Cukup baik', 'Puas', 'Sangat puas']

export default function ReviewForm({ ticket }: { ticket: MyTicket }) {
  const queryClient = useQueryClient()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')

  const submit = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/v1/tenants/{tenantID}/tickets/{ticketID}/review', {
        params: { path: { tenantID: ticket.tenant_id, ticketID: ticket.ticket_id } },
        body: { rating, comment: comment.trim() || undefined },
      })
      if (!response.ok) throw new ApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_TICKETS_KEY }),
  })

  return (
    <form
      className="space-y-4 rounded-3xl border border-stone-200 bg-white p-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (rating > 0) submit.mutate()
      }}
    >
      <div>
        <h2 className="text-lg font-bold">Bagaimana layanannya?</h2>
        <p className="text-sm text-stone-600">Penilaian Anda membantu {ticket.outlet_name} menjaga mutu layanan.</p>
      </div>

      <div role="radiogroup" aria-label="Nilai layanan" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} bintang`}
            onClick={() => setRating(n)}
            className={`h-12 w-12 rounded-xl text-2xl leading-none transition focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 ${
              n <= rating ? 'text-amber-500' : 'text-stone-300'
            }`}
          >
            ★
          </button>
        ))}
      </div>
      <p className="h-5 text-sm text-stone-700" aria-live="polite">
        {RATING_WORD[rating]}
      </p>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-700">Catatan (boleh dikosongkan)</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={1000}
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
        />
      </label>

      {submit.isError && <Alert>{messageOf(submit.error)}</Alert>}
      <Button type="submit" disabled={rating === 0} loading={submit.isPending}>
        Kirim penilaian
      </Button>
    </form>
  )
}
