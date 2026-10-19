import { useEffect, useRef, useState } from 'react'
import type { components } from '../api/schema'

export type SessionSnapshot = components['schemas']['SessionSnapshot']

// Mendengarkan kondisi antrian lewat Server-Sent Events. EventSource otomatis
// menyambung ulang kalau koneksi putus, jadi tidak perlu kode retry sendiri.
//
// onSnapshot dipanggil setiap ada pembaruan (termasuk yang pertama saat terhubung).
export function useQueueStream(
  sessionId: string | null | undefined,
  onSnapshot?: (s: SessionSnapshot) => void,
  onOpen?: () => void,
) {
  const [state, setState] = useState<{ id: string; snapshot: SessionSnapshot } | null>(null)
  const [connectedId, setConnectedId] = useState<string | null>(null)

  // Simpan callback di ref supaya koneksi tidak dibuka ulang tiap render.
  const callback = useRef(onSnapshot)
  const opened = useRef(onOpen)
  useEffect(() => {
    callback.current = onSnapshot
  })
  useEffect(() => {
    opened.current = onOpen
  })

  useEffect(() => {
    if (!sessionId || typeof EventSource === 'undefined') return
    const es = new EventSource(`/v1/public/queue-sessions/${sessionId}/stream`)
    es.onopen = () => {
      setConnectedId(sessionId)
      opened.current?.()
    }
    es.onerror = () => setConnectedId((cur) => (cur === sessionId ? null : cur))
    es.onmessage = (ev) => {
      try {
        const snapshot = JSON.parse(ev.data) as SessionSnapshot
        setState({ id: sessionId, snapshot })
        callback.current?.(snapshot)
      } catch {
        // event yang bukan JSON diabaikan
      }
    }
    return () => es.close()
  }, [sessionId])

  return {
    // Hanya dikembalikan kalau cocok dengan sesi yang sedang dilihat.
    snapshot: state && state.id === sessionId ? state.snapshot : null,
    connected: connectedId !== null && connectedId === sessionId,
  }
}
