import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const e2eData = path.join(root, 'e2e', '.data')
const sqlitePath = path.join(e2eData, 'e2e.sqlite3')
const quarantineRoot = path.join(e2eData, 'quarantine')
const auditPath = path.join(e2eData, 'audit.jsonl')

/**
 * Browser E2E — system Google Chrome (channel: chrome).
 * Backend uses an isolated sqlite + quarantine under e2e/.data (not production data).
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile-chrome',
      testMatch: /demo-journey\.spec\.ts/,
      use: { ...devices['Pixel 5'], channel: 'chrome' },
    },
  ],
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : [
        {
          command: [
            'mkdir -p',
            JSON.stringify(e2eData),
            JSON.stringify(quarantineRoot),
            '&&',
            'cd backend &&',
            `VETMIND_STORAGE=sqlite`,
            `VETMIND_SQLITE_PATH=${JSON.stringify(sqlitePath)}`,
            `VETMIND_QUARANTINE_ROOT=${JSON.stringify(quarantineRoot)}`,
            `VETMIND_AUDIT_LOG_PATH=${JSON.stringify(auditPath)}`,
            `VETMIND_AUTH_ENABLED=0`,
            `VETMIND_ASYNC_DELAY_MS=200`,
            `VETMIND_RAG=lexical`,
            '.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000',
          ].join(' '),
          url: 'http://127.0.0.1:8000/api/v1/health',
          reuseExistingServer: !process.env.CI,
          timeout: 90_000,
        },
        {
          command: 'npx vite --host 127.0.0.1 --port 5173 --strictPort',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 90_000,
        },
      ],
})
