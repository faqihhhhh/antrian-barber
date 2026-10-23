// localStorage bisa melempar error (mode privat, penyimpanan diblokir), jadi
// semua akses dibungkus try/catch. Aplikasi tetap jalan kalau gagal.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // diabaikan
  }
}

const NAME_KEY = 'trimwait.nama'
const OUTLET_KEY = 'trimwait.outlet'

export const savedName = () => read(NAME_KEY) ?? ''
export const saveName = (name: string) => write(NAME_KEY, name)

// Outlet terakhir yang dibuka pelanggan. Dipakai Beranda untuk tombol "kembali memesan".
export const lastOutlet = () => read(OUTLET_KEY)
export const saveLastOutlet = (slug: string) => write(OUTLET_KEY, slug)
