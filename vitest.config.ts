import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
    include: ['tests/unit/**/*.test.ts', 'tests/renderer/**/*.test.tsx'],
    exclude: ['tests/e2e/**'],
    setupFiles: ['./tests/setup.ts'],
  },
})
