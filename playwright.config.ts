import { defineConfig, devices } from '@playwright/test'

const protectedE2e = process.env.E2E_PROTECTED === '1'

/**
 * Browser E2E — system Google Chrome (channel: chrome).
 * Backend uses an isolated sqlite + quarantine under e2e/.data (not production data).
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry on CI absorbs rare network/startup hiccups; a broken test still fails.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Protected runs get their own folders so a later run never wipes an earlier failure's traces.
  outputDir: protectedE2e ? 'test-results-protected' : 'test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: protectedE2e ? 'e2e-report-protected' : 'e2e-report' }]],
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
      testIgnore: [/protected\.spec\.ts/],
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile-chrome',
      testMatch: /demo-journey\.spec\.ts/,
      use: { ...devices['Pixel 5'], channel: 'chrome' },
    },
    ...(protectedE2e
      ? [
          {
            name: 'e2e-protected',
            testMatch: /protected\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 800 } },
          },
        ]
      : []),
  ],
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : [
        {
          // Cross-platform (Windows/macOS/Linux/CI): wipes e2e/.data and starts uvicorn from
          // backend/.venv; E2E_PROTECTED=1 switches to auth-on protected mode.
          command: 'node scripts/e2e-backend.mjs',
          url: 'http://127.0.0.1:8000/api/v1/health',
          // Prefer a process we control so storage wipe always applies.
          reuseExistingServer: false,
          timeout: 90_000,
        },
        {
          command: 'npx vite --host 127.0.0.1 --port 5173 --strictPort',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: false,
          timeout: 90_000,
        },
      ],
})
