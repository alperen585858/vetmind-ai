import { expect, type Page } from '@playwright/test'

/** Unique address per run: the e2e backend keeps users for the whole run. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@e2e.test`
}

export async function fillRegister(
  page: Page,
  opts: { name?: string; email: string; password: string; confirm?: string; role?: 'owner' | 'vet' },
) {
  await page.goto('/kayit')
  if (opts.name) await page.getByLabel('Ad soyad').fill(opts.name)
  await page.getByLabel('E-posta').fill(opts.email)
  await page.getByLabel('Şifre', { exact: true }).fill(opts.password)
  await page.getByLabel('Şifre (tekrar)').fill(opts.confirm ?? opts.password)
  if (opts.role) await page.getByLabel('Rol').selectOption(opts.role)
  await page.getByRole('button', { name: 'Kayıt ol ve devam et' }).click()
}

/** Sign out from Ayarlar (the account card button, not the sidebar one). */
export async function signOutFromSettings(page: Page) {
  await page.goto('/ayarlar')
  const button = page.getByRole('main').getByRole('button', { name: 'Çıkış yap' })
  await expect(button).toBeVisible({ timeout: 20_000 })
  await button.click()
  await page.waitForURL(/\/giris$/, { timeout: 15_000 })
}
