import type { Page } from '@playwright/test'

/** Protected-mode login (no demo role switch). */
export async function loginProtected(page: Page, email: string, password = 'demo1234') {
  await page.goto('/giris')
  await page.getByLabel(/E-posta/i).fill(email)
  await page.getByLabel(/Şifre/i).fill(password)
  await page.getByRole('button', { name: /Giriş yap/i }).click()
  await page.waitForURL((url) => !url.pathname.endsWith('/giris'), { timeout: 20_000 })
}

export async function loginProtectedVet(page: Page) {
  await loginProtected(page, 'vet@demo.local')
}

export async function loginProtectedExpert(page: Page) {
  await loginProtected(page, 'expert@demo.local')
}
