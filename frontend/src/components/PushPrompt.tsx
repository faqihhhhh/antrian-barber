import { Alert, Button } from './ui'
import { usePushNotifications } from '../hooks/usePushNotifications'

export default function PushPrompt() {
  const push = usePushNotifications()
  if (!push.supported) return null
  if (push.active) {
    return <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Notifikasi giliran aktif di perangkat ini.</p>
  }
  return (
    <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
      <div>
        <h2 className="font-semibold">Dapatkan kabar saat giliran mendekat</h2>
        <p className="mt-1 text-sm text-stone-600">Notifikasi tetap bisa muncul saat halaman Kapsflow tidak sedang dibuka.</p>
      </div>
      {push.enable.isError && <Alert>{push.enable.error.message}</Alert>}
      <Button type="button" loading={push.enable.isPending} onClick={() => push.enable.mutate()}>
        Aktifkan notifikasi
      </Button>
    </section>
  )
}
