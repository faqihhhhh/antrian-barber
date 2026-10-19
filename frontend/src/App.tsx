import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router'
import RequireLogin from './auth/RequireLogin'
import AppShell from './components/AppShell'
import { Spinner } from './components/ui'
import AturUlangPassword from './pages/AturUlangPassword'
import Daftar from './pages/Daftar'
import LupaPassword from './pages/LupaPassword'
import Masuk from './pages/Masuk'
import HalamanOutlet from './pages/Outlet'
import Tiket from './pages/Tiket'
import TiketSaya from './pages/TiketSaya'
import VerifikasiEmail from './pages/VerifikasiEmail'

const Admin = lazy(() => import('./pages/Admin'))
const Kapster = lazy(() => import('./pages/Kapster'))
const Beranda = lazy(() => import('./pages/Beranda'))
const Pemilik = lazy(() => import('./pages/Pemilik'))
const PemilikStaf = lazy(() => import('./pages/PemilikStaf'))
const PemilikPembayaran = lazy(() => import('./pages/PemilikPembayaran'))
const PemilikStatistik = lazy(() => import('./pages/PemilikStatistik'))
const PemilikUlasan = lazy(() => import('./pages/PemilikUlasan'))
const PemilikLangganan = lazy(() => import('./pages/PemilikLangganan'))
const PemilikSaaS = lazy(() => import('./pages/PemilikSaaS'))
const PemilikMulai = lazy(() => import('./pages/PemilikMulai'))

function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-5 text-center">
      <h1 className="text-2xl font-bold">Halaman tidak ditemukan</h1>
      <Link to="/" className="mt-4 inline-flex min-h-11 items-center px-2 text-sm font-semibold underline">
        Kembali ke beranda
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/masuk" element={<Masuk />} />
        <Route path="/daftar" element={<Daftar />} />
        <Route path="/verifikasi-email" element={<VerifikasiEmail />} />
        <Route path="/lupa-password" element={<LupaPassword />} />
        <Route path="/atur-ulang-password" element={<AturUlangPassword />} />
        <Route path="/o/:slug" element={<HalamanOutlet />} />
        <Route path="/o/:slug/pesan" element={<HalamanOutlet />} />
        {/* URL lama tetap berfungsi untuk tautan yang sudah terlanjur dibagikan. */}
        <Route path="/b/:slug" element={<HalamanOutlet />} />

        <Route element={<RequireLogin><AppShell /></RequireLogin>}>
          <Route index element={<Beranda />} />
          <Route path="tiket" element={<TiketSaya />} />
          <Route path="tiket/:ticketId" element={<Tiket />} />
          <Route path="admin" element={<Admin />} />
          <Route path="kelola/:tenantId/:outletId" element={<Admin />} />
          <Route path="kelola/:tenantId/sesi/:sessionId" element={<Admin />} />
          <Route path="pemilik" element={<Pemilik />} />
          <Route path="pemilik/staf" element={<PemilikStaf />} />
          <Route path="pemilik/pembayaran" element={<PemilikPembayaran />} />
          <Route path="pemilik/statistik" element={<PemilikStatistik />} />
          <Route path="pemilik/ulasan" element={<PemilikUlasan />} />
          <Route path="pemilik/langganan" element={<PemilikLangganan />} />
          <Route path="pemilik-saas" element={<PemilikSaaS />} />
          <Route path="mulai-bisnis" element={<PemilikMulai />} />
          <Route path="kapster" element={<Kapster />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
