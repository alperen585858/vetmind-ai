import { expect, type Page } from '@playwright/test'

export async function openDicomUpload(page: Page) {
  await page.goto('/dicom-yukle')
  await expect(page.getByRole('heading', { name: /DICOM Yükleme/i })).toBeVisible({ timeout: 15_000 })
}

/** Load Brain MRI synthetic fixtures into the viewer (does not analyze yet). */
export async function loadBrainMriDemo(page: Page) {
  await page.getByRole('button', { name: /Brain MRI/i }).first().click()
  const viewer = page.getByRole('application', { name: 'DICOM görüntüleyici' })
  await expect(viewer).toBeVisible({ timeout: 30_000 })
  await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 30_000 })
  await expect(viewer.getByText(/Im:\s*\d+/).first()).toBeVisible({ timeout: 15_000 })
}

export async function navigateSlices(page: Page) {
  const viewer = page.getByRole('application', { name: 'DICOM görüntüleyici' })
  const overlay = viewer.getByText(/Im:\s*\d+/)
  await expect(overlay.first()).toBeVisible({ timeout: 15_000 })
  const before = (await overlay.first().textContent()) ?? ''
  await page.getByRole('button', { name: 'Sonraki dilim' }).first().click()
  await expect
    .poll(async () => (await overlay.first().textContent()) ?? '', { timeout: 10_000 })
    .not.toBe(before)
  await page.getByRole('button', { name: 'Önceki dilim' }).first().click()
}

export async function fillConsentAndPatient(page: Page, patientName: string) {
  await page.getByLabel(/Hasta adı/i).fill(patientName)
  const consent = page.locator('label').filter({ hasText: /DICOM verisinin klinik ön değerlendirme/i })
  await consent.locator('input[type="checkbox"]').check()
}

/** Metadata preview → accept suggestion → run mock analysis → land on processing. */
export async function confirmAndRunDemoAnalysis(page: Page, patientName: string) {
  await fillConsentAndPatient(page, patientName)

  const previewBtn = page.getByRole('button', { name: /Demo metadata önizle|Metadata önizle/i }).first()
  if (await previewBtn.isEnabled()) {
    await previewBtn.click()
    await expect(page.getByText(/Sınıflandırma|MR\s*\/\s*BRAIN|Metadata hazır/i).first()).toBeVisible({
      timeout: 25_000,
    })
  }

  const accept = page.getByText('Öneriyi kabul et')
  if (await accept.count()) {
    const box = accept.locator('xpath=preceding-sibling::input[1]')
    if (await box.count()) await box.check()
    else await page.locator('label').filter({ hasText: 'Öneriyi kabul et' }).locator('input').check()
  }

  const analyzeBtn = page.getByRole('button', { name: 'Demo analize devam et' })
  await expect(analyzeBtn).toBeEnabled({ timeout: 20_000 })
  await analyzeBtn.click()
  // Deterministic readiness: navigate to processing OR surface a toast error (no sleep).
  const processing = page.waitForURL(/\/vakalar\/case-[a-z0-9]+\/isleme/, { timeout: 60_000 })
  const errorToast = page
    .getByText(/Analiz başlatılamadı|Backend.*ulaşılamıyor|DICOM.*başarısız/i)
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
    .then(() => {
      throw new Error('Demo analyze failed before navigation (error toast visible)')
    })
  await Promise.race([processing, errorToast])
  const caseId = page.url().match(/vakalar\/(case-[a-z0-9]+)/)?.[1]
  if (!caseId) throw new Error('case id missing from processing URL')
  return caseId
}

export async function expectMockProcessing(page: Page) {
  await expect(page.getByText(/DEMO\s*\/\s*MOCK ANALYSIS/i)).toBeVisible({ timeout: 20_000 })
}

export async function openExpertReviewForCase(page: Page, caseId: string) {
  await page.goto(`/vakalar/${caseId}/inceleme`)
  // Hydration after full navigation (memory state is empty on hard goto).
  await expect(
    page.getByText(/Uzman İnceleme|Uzman inceleme yükleniyor/i).first(),
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /Onayla ve Yayınla/i })).toBeVisible({
    timeout: 30_000,
  })
}

export async function approveReport(page: Page) {
  await page.getByRole('button', { name: /Onayla ve Yayınla/i }).click()
  await page.waitForURL(/\/raporlar\//, { timeout: 30_000 })
}

export async function openCaseHistory(page: Page, caseId: string) {
  await page.goto(`/vakalar/${caseId}?tab=gecmis`)
  await expect(page.getByText(/Rapor sürümleri|İşlem Geçmişi|sürüm/i).first()).toBeVisible({
    timeout: 20_000,
  })
}
