import { defineConfig } from 'astro/config'

export default defineConfig({
  output: 'static',
  vite: {
    server: {
      proxy: {
        '/v1/plans/pricing': 'http://localhost:8080',
      },
    },
  },
})
