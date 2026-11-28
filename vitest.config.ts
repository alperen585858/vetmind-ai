import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // #140: one worker for many files instead of a fresh one per file (measured faster);
    // tests must clean up their own globals (vi.restoreAllMocks / vi.unstubAllGlobals).
    isolate: false,
    include: ['src/**/*.test.ts'],
  },
})
