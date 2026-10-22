import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
