import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
