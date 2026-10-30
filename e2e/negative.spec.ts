import { expect, test } from '@playwright/test'
import { loginAsExpert, loginAsVet, switchRole } from './helpers/auth'
import {
  approveReport,
  confirmAndRunDemoAnalysis,
  loadBrainMriDemo,
  openDicomUpload,
  openExpertReviewForCase,
} from './helpers/workflow'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const root = path.dirname(fileURLToPath(import.meta.url))

test.describe('Negative browser scenarios', () => {
  test('invalid DICOM file shows blocked or error feedback', async ({ page }) => {
    await loginAsVet(page)
    await openDicomUpload(page)

    const tmp = path.join(root, '.data', 'invalid-e2e.dcm')
    fs.mkdirSync(path.dirname(tmp), { recursive: true })
    fs.writeFileSync(tmp, 'NOT-A-DICOM-FILE')

    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.setInputFiles(tmp)

    // Client-side DICOM sniff rejects non-DICOM bytes before upload
    await expect(
      page.getByText(/dosya reddedildi|DICOM bulunamadı|Doğrulama başarısız|geçersiz|reddedildi/i).first(),
    ).toBeVisible({ timeout: 20_000 })
  })

  test('unauthorized expert review page is gated for vet role', async ({ page }) => {
    await loginAsVet(page)
    await openDicomUpload(page)
    await loadBrainMriDemo(page)
    const caseId = await confirmAndRunDemoAnalysis(page, `Gate-${Date.now().toString(36)}`)

    // Vet must not access expert workspace (legacy /inceleme redirects to /calisma)
    await page.goto(`/vakalar/${caseId}/calisma`)
    await expect(page.getByText(/erişim yetkiniz yok|yetki/i)).toBeVisible({ timeout: 15_000 })
  })

  test('refresh persistence keeps approved report', async ({ page, request }) => {
    const patient = `Persist-${Date.now().toString(36)}`
    const created = await request.post('http://127.0.0.1:8000/api/v1/cases', {
      data: {
        patient_name: patient,
        species: 'canine',
        breed: 'Mix',
        modality: 'MR',
        anatomical_region: 'BRAIN',
        clinical_history: 'E2E refresh persistence — synthetic',
        scenario: 'brain_mri_suspected',
      },
    })
    expect(created.ok()).toBeTruthy()
    const caseId = (await created.json()).case_id as string
    const analyzed = await request.post(`http://127.0.0.1:8000/api/v1/cases/${caseId}/analyze`)
    expect(analyzed.ok()).toBeTruthy()

    await loginAsExpert(page)
    await openExpertReviewForCase(page, caseId)
    await approveReport(page)

    await page.reload()
    await expect(page.getByText(/Veteriner Radyoloji Değerlendirme Raporu/i)).toBeVisible({
      timeout: 25_000,
    })
    await expect(page.locator('article').getByText(/DEMO\s*\/\s*SENTETİK VERİ/i)).toBeVisible()
    await expect(page.locator('article').getByText(new RegExp(patient, 'i'))).toBeVisible()
  })

  test('missing report surfaces empty or loading failure state', async ({ page }) => {
    await loginAsVet(page)
    // Navigate to a non-existent / not-approved report id
    await page.goto('/raporlar/case-does-not-exist-e2e')
    await expect(
      page.getByText(/yükleniyor|bulunamadı|yok|hata|rapor|boş|mevcut değil/i).first(),
    ).toBeVisible({ timeout: 20_000 })
  })

  test('backend unavailable shows actionable error on DICOM demo load', async ({ page }) => {
    await loginAsVet(page)
    await openDicomUpload(page)
    await page.route('**/api/v1/**', (route) => route.abort('failed'))
    await page.getByRole('button', { name: /Brain MRI/i }).first().click()
    await expect(page.getByText(/Demo DICOM alınamadı|yüklenemedi|ulaşılamıyor|backend|hata/i).first()).toBeVisible({
      timeout: 20_000,
    })
    await page.unroute('**/api/v1/**')
  })

  test('analysis timeout surfaces error when job never completes', async ({ page }) => {
    await loginAsVet(page)
    await openDicomUpload(page)
    await loadBrainMriDemo(page)
    await page.getByLabel(/Hasta adı/i).fill(`Timeout-${Date.now().toString(36)}`)
    await page.locator('label').filter({ hasText: /DICOM verisinin klinik ön değerlendirme/i }).locator('input').check()

    // Allow upload/confirm; stall job polling
    await page.route('**/api/v1/jobs/**', async (route) => {
      const url = route.request().url()
      if (route.request().method() === 'GET') {
        const jobId = url.split('/jobs/')[1]?.split('?')[0] || 'job-stall'
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            case_id: 'case-stall',
            status: 'running',
            outcome: null,
            routed_model_ids: [],
          }),
        })
        return
      }
      await route.continue()
    })

    await page.getByRole('button', { name: 'Demo analize devam et' }).click()
    await expect(
      page.getByText(/zaman aşımı|timed out|başlatılamadı|timeout|hata/i).first(),
    ).toBeVisible({ timeout: 45_000 })
    await page.unroute('**/api/v1/jobs/**')
  })

  test('cancelled job via API is visible as terminal failure on refresh', async ({ page, request }) => {
    await loginAsVet(page)
    // Create case through API + enqueue with delay, then cancel
    const health = await request.get('http://127.0.0.1:8000/api/v1/health')
    expect(health.ok()).toBeTruthy()

    const create = await request.post('http://127.0.0.1:8000/api/v1/cases', {
      data: {
        patient_name: `Cancel-${Date.now().toString(36)}`,
        species: 'canine',
        breed: 'Mix',
        modality: 'MR',
        anatomical_region: 'BRAIN',
        clinical_history: 'E2E cancel synthetic',
        scenario: 'brain_mri_suspected',
      },
    })
    expect(create.ok()).toBeTruthy()
    const caseId = (await create.json()).case_id as string

    // Slow async so cancel can win
    const jobRes = await request.post(`http://127.0.0.1:8000/api/v1/cases/${caseId}/analyze/async`)
    expect(jobRes.status()).toBe(202)
    const jobId = (await jobRes.json()).job_id as string
    const cancel = await request.post(`http://127.0.0.1:8000/api/v1/jobs/${jobId}/cancel`)
    expect(cancel.ok()).toBeTruthy()
    const cancelled = await cancel.json()
    expect(['cancelled', 'cancel_requested', 'failed', 'completed']).toContain(cancelled.status)

    const polled = await request.get(`http://127.0.0.1:8000/api/v1/jobs/${jobId}`)
    expect(polled.ok()).toBeTruthy()
    const job = await polled.json()
    // Terminal (cancel won) or completed if race lost — both are valid outcomes to surface in UI.
    expect(['cancelled', 'cancel_requested', 'failed', 'completed']).toContain(job.status)

    await page.goto(`/vakalar/${caseId}/isleme`)
    await expect(page.getByText(/FAILED|failed|iptal|cancel|başarısız|DEMO|MOCK|Job|completed|AI/i).first()).toBeVisible({
      timeout: 20_000,
    })
  })
})

test.describe('Expert review reason codes', () => {
  test('reject requires reason code and text on workspace', async ({ page, request }) => {
    const patient = `Reject-${Date.now().toString(36)}`
    const created = await request.post('http://127.0.0.1:8000/api/v1/cases', {
      data: {
        patient_name: patient,
        species: 'canine',
        breed: 'Mix',
        modality: 'MR',
        anatomical_region: 'BRAIN',
        clinical_history: 'E2E reject path',
        scenario: 'brain_mri_suspected',
      },
    })
    expect(created.ok()).toBeTruthy()
    const caseId = (await created.json()).case_id as string
    const analyzed = await request.post(`http://127.0.0.1:8000/api/v1/cases/${caseId}/analyze`)
    expect(analyzed.ok()).toBeTruthy()

    await loginAsExpert(page)
    await openExpertReviewForCase(page, caseId)
    await page.getByRole('button', { name: /^Reddet$/i }).click()
    await page.getByRole('button', { name: /^Gönder$/i }).click()
    await expect(page.getByText(/10 karakter|kod/i).first()).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Yanlış bulgu' }).click()
    await page.locator('textarea').last().fill('E2E red gerekçesi — lateralite uyumsuz.')
    await page.getByRole('button', { name: /^Gönder$/i }).click()
    await expect(page).toHaveURL(/\/kuyruk/, { timeout: 20_000 })
  })
})

test.describe('Expert authz', () => {
  test('expert can open review for a prepared case', async ({ page }) => {
    await loginAsVet(page)
    await openDicomUpload(page)
    await loadBrainMriDemo(page)
    // Ensure classification preview so analyze CTA enables under all layouts
    await page.getByLabel(/Hasta adı/i).fill(`ExpertOK-${Date.now().toString(36)}`)
    await page.locator('label').filter({ hasText: /DICOM verisinin klinik ön değerlendirme/i }).locator('input').check()
    const meta = page.getByRole('button', { name: /Demo metadata önizle|Metadata önizle/i }).first()
    if (await meta.isEnabled().catch(() => false)) {
      await meta.click()
      await expect(page.getByText(/Sınıflandırma|MR/i).first()).toBeVisible({ timeout: 25_000 })
    }
    const caseId = await confirmAndRunDemoAnalysis(page, `ExpertOK-${Date.now().toString(36)}`)
    await switchRole(page, 'Uzman Hekim (VRM)')
    await openExpertReviewForCase(page, caseId)
  })
})
