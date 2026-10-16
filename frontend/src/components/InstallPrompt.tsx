import { useEffect, useState } from 'react'

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const needsIOSInstall = /iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone()

  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as InstallEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setInstallEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed) return null
  if (!installEvent && needsIOSInstall) {
    return (
      <aside className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md border-t border-stone-200 bg-white p-4 text-sm shadow-lg">
        Di iPhone atau iPad, tekan Bagikan lalu pilih <strong>Tambahkan ke Layar Utama</strong> untuk memasang Kapsflow.
      </aside>
    )
  }
  if (!installEvent) return null
  return (
    <aside className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-md items-center justify-between gap-4 border-t border-stone-200 bg-white p-4 shadow-lg">
      <p className="text-sm font-medium">Pasang Kapsflow agar mudah dibuka di HP.</p>
      <button
        type="button"
        className="shrink-0 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
        onClick={async () => {
          await installEvent.prompt()
          const choice = await installEvent.userChoice
          if (choice.outcome === 'accepted') setInstalled(true)
          setInstallEvent(null)
        }}
      >
        Pasang
      </button>
    </aside>
  )
}
