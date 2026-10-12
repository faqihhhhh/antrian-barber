import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { Alert, Spinner } from '../components/ui'
import { messageOf } from '../api/client'
import { useMe } from './useMe'

// Pembungkus untuk halaman yang butuh login. Belum masuk: diarahkan ke /masuk
// dan kembali ke halaman semula setelah berhasil.
export default function RequireLogin({ children }: { children: ReactNode }) {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) return <Spinner />
  if (me.isError) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <Alert>{messageOf(me.error)}</Alert>
      </main>
    )
  }
  if (!me.data) return <Navigate to="/masuk" replace state={{ from: location.pathname }} />
  return <>{children}</>
}