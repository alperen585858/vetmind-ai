import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Library chunks (issue #25). Pages are split with React.lazy (src/lib/lazyPage.ts); these
 * groups keep rarely-changing libraries in long-cached files and stop Rollup from scattering
 * icons into dozens of tiny chunks.
 */
function libraryChunk(id: string): string | undefined {
  if (!id.includes('/node_modules/')) return undefined
  if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) {
    return 'react-vendor'
  }
  if (id.includes('/node_modules/lucide-react/')) return 'icons'
  // recharts and its d3 helpers: only the dashboard / model performance pages need them.
  if (/\/node_modules\/(recharts|recharts-scale|react-smooth|victory-vendor|d3-[^/]+|internmap|decimal\.js-light)\//.test(id)) {
    return 'charts'
  }
  if (id.includes('/node_modules/dicom-parser/')) return 'dicom'
  return undefined
}

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: { manualChunks: libraryChunk },
    },
  },
  server: {
    proxy: {
      // VETMIND_API_PROXY lets a second dev stack (e.g. the vision backend) run side by side.
      '/api': process.env.VETMIND_API_PROXY || 'http://127.0.0.1:8000',
    },
  },
})
