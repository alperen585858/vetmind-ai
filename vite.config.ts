import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    proxy: {
      // VETMIND_API_PROXY lets a second dev stack (e.g. the vision backend) run side by side.
      '/api': process.env.VETMIND_API_PROXY || 'http://127.0.0.1:8000',
    },
  },
})
