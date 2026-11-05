import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const publicAppURL = (process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, '')

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'trimwait-public-url-meta',
      transformIndexHtml(html) {
        return html.replaceAll('__TRIMWAIT_PUBLIC_URL__', publicAppURL)
      },
    },
  ],
  server: {
    // Frontend dan API satu origin: tidak butuh CORS, dan cookie sesi aman.
    proxy: {
      '/v1': 'http://localhost:8080',
    },
  },
})
