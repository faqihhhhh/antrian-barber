self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data?.text() || '' }
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'Kapsflow', {
    body: payload.body || 'Ada kabar terbaru tentang antrian Anda.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: '/tiket' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) return client.focus()
    }
    return self.clients.openWindow(event.notification.data?.url || '/')
  })())
})
