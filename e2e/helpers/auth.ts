import type { Page } from '@playwright/test'

/** Demo login. Auth may be off; JWT is best-effort. */
export async function loginAs(page: Page, email: string, password = 'demo1234') {
  await page.goto('/giris')
  await page.getByLabel(/E-posta/i).fill(email)
  await page.getByLabel(/Şifre/i).fill(password)
  await page.getByRole('button', { name: /Giriş yap/i }).click()
  await page.waitForURL((url) => !url.pathname.endsWith('/giris'), { timeout: 20_000 })
}

export async function loginAsVet(page: Page) {
  await loginAs(page, 'vet@demo.local')
}

export async function loginAsExpert(page: Page) {
  await loginAs(page, 'expert@demo.local')
}

export async function loginAsOwner(page: Page) {
  await loginAs(page, 'owner@demo.local')
}

/** Switch demo role via Topbar (also refreshes JWT when backend auth is on). */
export async function switchRole(page: Page, roleLabel: RegExp | string) {
  await page.getByRole('button', { name: /Rol değiştir/i }).click()
  await page.getByRole('button', { name: roleLabel }).click()
  await page.waitForURL('/', { timeout: 15_000 })
}
