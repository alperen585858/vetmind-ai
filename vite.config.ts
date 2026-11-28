import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Library chunks (issue #25). Pages are split with React.lazy (src/lib/lazyPage.ts); these
 * groups keep rarely-changing libraries in long-cached files and stop the bundler from
 * scattering icons into dozens of tiny chunks.
 *
 * Vite 8 bundles with Rolldown: a group also pulls in its modules' dependencies, so the
 * groups run in priority order. React is captured first; otherwise the charts group (recharts
 * imports React) would take React with it and charts would load on every page.
 */
const libraryGroups = [
  {
    name: 'react-vendor',
    test: /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)\//,
    priority: 40,
  },
  { name: 'icons', test: /\/node_modules\/lucide-react\//, priority: 30 },
  // recharts and its d3 helpers: only the dashboard / model performance pages need them.
  {
    name: 'charts',
    test: /\/node_modules\/(recharts|recharts-scale|react-smooth|victory-vendor|d3-[^/]+|internmap|decimal\.js-light)\//,
    priority: 20,
  },
  { name: 'dicom', test: /\/node_modules\/dicom-parser\//, priority: 10 },
]

export default defineConfig({
  plugins: [react()],
  build: {
    // No chunkSizeWarningLimit override: the default 500 KB warning is meaningful again.
    // First-load size is enforced by scripts/check-bundle.mjs (npm run check:bundle).
    rolldownOptions: {
      output: { codeSplitting: { groups: libraryGroups } },
    },
  },
  server: {
    proxy: {
      // VETMIND_API_PROXY lets a second dev stack (e.g. the vision backend) run side by side.
      '/api': process.env.VETMIND_API_PROXY || 'http://127.0.0.1:8000',
    },
  },
})
