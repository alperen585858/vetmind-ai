import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Keep the default `isolate: true` (#140). `isolate: false` cut the run from ~1.4s to
    // ~0.5s, but files share one module cache then, so a `vi.mock` (e.g. LocaleContext in
    // CaseDetailPage.test.ts) is ignored when another file loaded the real module first:
    // tests fail depending on file order (`--sequence.shuffle --sequence.seed=3`).
  },
})
