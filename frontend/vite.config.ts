import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Frontend dan API satu origin: tidak butuh CORS, dan cookie sesi aman.
    proxy: {
      '/v1': 'http://localhost:8080',
    },
  },
})
