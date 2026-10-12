import createClient from 'openapi-fetch'
import type { paths } from './schema'

// Tipe request dan response semuanya berasal dari api/openapi.yaml, jadi
// salah ketik alamat atau field langsung ditandai TypeScript.
export const api = createClient<paths>({ baseUrl: window.location.origin })

// Error dari API selalu berbentuk { error: { code, message } }.
export class ApiError extends Error {
  code: string | undefined

  constructor(body: unknown, fallback = 'Terjadi kesalahan, coba lagi') {
    const e = (body as { error?: { code?: string; message?: string } } | undefined)?.error
    super(e?.message ?? fallback)
    this.code = e?.code
  }
}

// Pesan yang aman ditampilkan. Error selain ApiError hampir selalu berarti
// koneksi putus atau server tidak menjawab.
export function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Tidak bisa terhubung ke server. Periksa koneksi internet Anda.'
}