import { Alert, Button } from './ui'
import { usePushNotifications } from '../hooks/usePushNotifications'

export default function PushPrompt() {
  const push = usePushNotifications()
  if (!push.supported) return null
  if (push.active) {
    return (
      <section className="space-y-2 rounded-2xl border border-line bg-white p-4">
        <p className="text-sm text-body">Notifikasi giliran aktif di perangkat ini.</p>
        {push.disable.isError && <Alert>{push.disable.error.message}</Alert>}
        <Button type="button" variant="secondary" loading={push.disable.isPending} onClick={() => push.disable.mutate()}>
          Matikan notifikasi
        </Button>
      </section>
    )
  }
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
      <div>
        <h2 className="font-semibold">Dapatkan kabar saat giliran mendekat</h2>
        <p className="mt-1 text-sm text-body-muted">Notifikasi tetap bisa muncul saat halaman Kapsflow tidak sedang dibuka.</p>
      </div>
      {push.enable.isError && <Alert>{push.enable.error.message}</Alert>}
      <Button type="button" loading={push.enable.isPending} onClick={() => push.enable.mutate()}>
        Aktifkan notifikasi
      </Button>
    </section>
  )
}
