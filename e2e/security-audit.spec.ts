import { expect, test } from '@playwright/test'
import { loginAs } from './helpers/auth'

/**
 * Issue #106 — admin security / audit screen. Failed sign-ins use a made-up address, so no
 * demo account is rate-limited or changed by this test.
 */
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000/api/v1'

test('admin sees failed sign-ins flagged, filters by person and downloads CSV', async ({ page, request }) => {
  const actor = `brute-${Date.now().toString(36)}@e2e.test`
  for (let i = 0; i < 5; i++) {
    const res = await request.post(`${API}/auth/login`, { data: { email: actor, password: 'wrong-password-1' } })
    expect(res.status()).toBe(401)
  }

  await loginAs(page, 'admin@demo.local')
  await page.goto('/guvenlik')
  await expect(page.getByRole('heading', { name: 'Güvenlik / Audit' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Başarısız giriş (24 saat)')).toBeVisible()
  await expect(page.getByText(`${actor}: 15 dakika içinde 5 başarısız giriş`)).toBeVisible()

  // "Olayları göster" filters the list to that person and puts the filter in the URL.
  await page
    .getByRole('listitem')
    .filter({ hasText: `${actor}: 15 dakika` })
    .getByRole('button', { name: 'Olayları göster' })
    .click()
  await expect(page).toHaveURL(/kisi=brute-/)
  const list = page.getByRole('list', { name: 'Audit kayıtları' })
  await expect(list.getByRole('listitem')).toHaveCount(5)
  await expect(list.getByText('Şüpheli')).toHaveCount(5)
  await expect(list.getByText('Reddedildi')).toHaveCount(5)

  // Row details open in place.
  await list.getByRole('button').first().click()
  await expect(list.getByText('auth.login', { exact: true })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV indir' }).click()
  expect((await download).suggestedFilename()).toMatch(/^vetmind-audit-\d{8}-\d{4}\.csv$/)
  await expect(page.getByText('5 satır indirildi')).toBeVisible()

  await page.getByRole('button', { name: 'Temizle' }).click()
  await expect(page).not.toHaveURL(/kisi=/)
})

test('vet cannot open the security screen', async ({ page }) => {
  await loginAs(page, 'vet@demo.local')
  await page.goto('/guvenlik')
  await expect(page.getByRole('heading', { name: 'Güvenlik / Audit' })).toHaveCount(0)
})
