import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginAsVet } from './helpers/auth'

/** Issue #113 — plain-language owner note: create, edit, approve, download PDF (mock provider). */
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000/api/v1'

async function scenarioCase(request: APIRequestContext, approve: boolean): Promise<string> {
  const created = await request.post(`${API}/cases`, {
    data: {
      patient_name: `Sahip-${Date.now().toString(36)}`,
      species: 'canine',
      modality: 'MR',
      anatomical_region: 'BRAIN',
      scenario: 'brain_mri_suspected',
      clinical_history: 'Synthetic owner-summary E2E.',
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const caseId = (await created.json()).case_id as string
  expect((await request.post(`${API}/cases/${caseId}/analyze`)).ok()).toBeTruthy()
  if (approve) {
    const res = await request.post(`${API}/cases/${caseId}/review`, { data: { reviewer_id: 'expert-demo', action: 'approve' } })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
  return caseId
}

test('vet creates, edits, approves and downloads the owner summary', async ({ page, request }) => {
  const caseId = await scenarioCase(request, true)
  await loginAsVet(page)
  await page.goto(`/vakalar/${caseId}`)
  await expect(page.getByRole('heading', { name: 'Sahip için özet' })).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Sahip için özet oluştur' }).click()
  const box = page.getByLabel('Sahip için özet metni')
  await expect(box).toHaveValue(/Ne görüldü\?/)
  await expect(page.getByText('Şablonla hazırlandı')).toBeVisible()
  await expect(page.getByText(/tanı veya tedavi önerisi değildir/)).toBeVisible()
  // No PDF before approval.
  await expect(page.getByRole('button', { name: 'PDF indir' })).toHaveCount(0)

  await box.fill(`${await box.inputValue()}\n\nKontrol için iki hafta sonra kliniğe gelin.`)
  await page.getByRole('button', { name: 'Değişiklikleri kaydet' }).click()
  await expect(page.getByText('Düzenlendi')).toBeVisible()

  await page.getByRole('button', { name: 'Onayla', exact: true }).click()
  await expect(page.getByText('Sahip özeti onaylandı')).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PDF indir' }).click()
  expect((await download).suggestedFilename()).toBe(`sahip-bilgilendirme-${caseId}.pdf`)
})

test('before approval the card explains the summary comes after the report is approved', async ({ page, request }) => {
  const caseId = await scenarioCase(request, false)
  await loginAsVet(page)
  await page.goto(`/vakalar/${caseId}`)
  await expect(page.getByText('Rapor onaylandıktan sonra burada hayvan sahibi için')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Sahip için özet oluştur' })).toHaveCount(0)
})
