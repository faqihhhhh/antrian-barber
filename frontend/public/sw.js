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
    let destination = event.notification.data?.url || '/tiket'
    try {
      const response = await fetch('/v1/me/tickets', { credentials: 'same-origin' })
      if (response.ok) {
        const tickets = await response.json()
        const active = Array.isArray(tickets) ? tickets.filter((ticket) => ['pending_payment', 'waiting', 'called', 'in_progress'].includes(ticket.status)) : []
        const target = active.find((ticket) => ticket.status === 'called') || active[0]
        if (target?.ticket_id) destination = `/tiket/${encodeURIComponent(target.ticket_id)}`
      }
    } catch {
      // Jika sesi atau jaringan tidak tersedia, buka daftar tiket.
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) {
        if ('navigate' in client) await client.navigate(destination)
        return client.focus()
      }
    }
    return self.clients.openWindow(event.notification.data?.url || '/tiket')
  })())
})
