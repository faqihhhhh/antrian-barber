import { Link, Route, Routes } from 'react-router'
import RequireLogin from './auth/RequireLogin'
import AturUlangPassword from './pages/AturUlangPassword'
import Beranda from './pages/Beranda'
import Daftar from './pages/Daftar'
import LupaPassword from './pages/LupaPassword'
import Masuk from './pages/Masuk'
import VerifikasiEmail from './pages/VerifikasiEmail'

function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 text-center">
      <h1 className="text-2xl font-bold">Halaman tidak ditemukan</h1>
      <Link to="/" className="mt-4 text-sm font-semibold underline">
        Kembali ke beranda
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/masuk" element={<Masuk />} />
      <Route path="/daftar" element={<Daftar />} />
      <Route path="/verifikasi-email" element={<VerifikasiEmail />} />
      <Route path="/lupa-password" element={<LupaPassword />} />
      <Route path="/atur-ulang-password" element={<AturUlangPassword />} />
      <Route
        path="/"
        element={
          <RequireLogin>
            <Beranda />
          </RequireLogin>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}