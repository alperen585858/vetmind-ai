import { expect, test } from '@playwright/test'
import { loginAsVet } from './helpers/auth'

// #70: the case Q&A is vet <-> radiologist only; documents are added from the Belgeler module.
test('vet asks the radiologist from the case and adds a document under Belgeler', async ({ page, request }) => {
  const response = await request.post('http://127.0.0.1:8000/api/v1/cases', {
    data: {
      patient_name: `QA-${Date.now().toString(36)}`,
      species: 'canine',
      modality: 'MR',
      anatomical_region: 'BRAIN',
      clinical_history: 'Synthetic Q&A fixture',
      scenario: 'brain_mri_suspected',
    },
  })
  await expect(response).toBeOK()
  const { case_id } = await response.json()

  await loginAsVet(page)
  await page.goto(`/vakalar/${case_id}`)
  const overview = page.getByRole('tabpanel', { name: 'Klinik Özet' })
  await expect(overview.getByText('Uzmanla soru-cevap')).toBeVisible({ timeout: 20_000 })
  await expect(overview.getByText(/Uzmana soru sorun veya düzeltme isteyin/)).toBeVisible()
  await expect(overview.getByText('Kime', { exact: true })).toHaveCount(0)
  await expect(overview.getByRole('button', { name: /Belge ekle/ })).toHaveCount(0)

  const question = `Kontrastlı seri önerir misiniz? ${Date.now().toString(36)}`
  await overview.getByTestId('info-request-input').fill(question)
  await overview.getByTestId('info-request-send').click()
  await expect(overview.getByText(question)).toBeVisible({ timeout: 15_000 })
  await expect(overview.getByText(/Açık/).first()).toBeVisible()

  await page.goto(`/vakalar/${case_id}?tab=belgeler`)
  await expect(page.getByText('Henüz belge yüklenmemiş')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('add-document-input').setInputFiles({
    name: 'kan-tahlili.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('ALT 120 U/L, kreatinin normal.'),
  })
  await expect(page.getByText('kan-tahlili.txt').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/ALT 120 U\/L/)).toBeVisible()
})
