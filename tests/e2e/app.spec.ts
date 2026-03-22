import { test, expect, _electron as electron } from '@playwright/test'

test('app launches and shows envsetup shell', async () => {
  const app = await electron.launch({ args: ['.'] })
  const page = await app.firstWindow()

  await expect(page.getByText('EnvSetup')).toBeVisible()
  await expect(page.getByText('Templates')).toBeVisible()

  await app.close()
})
