import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'

function supported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function decodeKey(value: string) {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function registerPush() {
  if (!supported()) throw new Error('Peramban ini belum mendukung notifikasi push.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Izin notifikasi belum diberikan. Ubah izin di pengaturan peramban.')

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    const { data, error, response } = await api.GET('/v1/tenants/push/public-key')
    if (!response.ok || !data) throw new ApiError(error)
    if (!data.public_key) throw new Error('Notifikasi belum tersedia di server.')
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeKey(data.public_key),
    })
  }

  const saved = subscription.toJSON()
  if (!saved.endpoint || !saved.keys?.p256dh || !saved.keys.auth) {
    throw new Error('Peramban tidak memberikan data subscription yang lengkap.')
  }
  const { error, response } = await api.POST('/v1/tenants/push/subscribe', {
    body: { endpoint: saved.endpoint, keys: { p256dh: saved.keys.p256dh, auth: saved.keys.auth } },
  })
  if (!response.ok) throw new ApiError(error)
}

export async function removePushSubscription() {
  if (!supported()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  const { error, response } = await api.POST('/v1/tenants/push/unsubscribe', { body: { endpoint: subscription.endpoint } })
  if (!response.ok) throw new ApiError(error)
  await subscription.unsubscribe()
}

export function usePushNotifications() {
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!supported()) return
    let cancelled = false
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!cancelled) setActive(!!subscription && Notification.permission === 'granted')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const enable = useMutation({
    mutationFn: registerPush,
    onSuccess: () => setActive(true),
  })
  const disable = useMutation({
    mutationFn: removePushSubscription,
    onSuccess: () => setActive(false),
  })
  return { supported: supported(), active, enable, disable }
}
