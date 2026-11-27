import { expect, test } from '@playwright/test'
import { loginAsVet } from './helpers/auth'

test('legacy messages link opens the clinical summary and imaging remains accessible', async ({ page, request }) => {
  const response = await request.post('http://127.0.0.1:8000/api/v1/cases', {
    data: {
      patient_name: 'Navigation demo',
      species: 'canine',
      modality: 'MR',
      anatomical_region: 'BRAIN',
      clinical_history: 'Synthetic navigation fixture',
      scenario: 'brain_mri_suspected',
      owner_name: 'Demo Owner',
      owner_email: 'navigation@example.com',
      owner_email_consent: false,
    },
  })
  await expect(response).toBeOK()
  const { case_id } = await response.json()

  await loginAsVet(page)
  await page.goto(`/vakalar/${case_id}?tab=mesajlar&ref=list`)
  await expect(page.getByRole('tab', { name: 'Klinik Özet' })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(`/vakalar/${case_id}?tab=genel&ref=list`)

  const banner = page.getByRole('region', { name: 'Hasta temel bilgileri' })
  await expect(banner.getByRole('heading', { name: 'Navigation demo' })).toBeVisible()
  await expect(banner.getByRole('button', { name: 'DICOM görüntüle' })).toHaveCount(0)
  await expect(banner.getByRole('button', { name: 'Mesajlar' })).toHaveCount(0)

  const overview = page.getByRole('tabpanel', { name: 'Klinik Özet' })
  const history = overview.getByRole('button', { name: 'İşlem geçmişi' })
  await expect(history).toBeHidden()
  await overview.locator('summary').filter({ hasText: 'Diğer vaka modülleri' }).click()
  await expect(history).toBeVisible()
  await expect(overview.getByRole('button', { name: 'Mesajlar', exact: true })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Görüntüleme' }).click()
  const imaging = page.getByRole('tabpanel', { name: 'Görüntüleme' })
  await expect(imaging).toBeVisible()
  // #74: the case viewer shows only the case's own study; no sample or local-file paths.
  await expect(imaging.getByTestId('case-study-source')).toHaveText('DICOM yok')
  for (const name of ['Örnek', 'Örnek yükle', 'Vakadan yükle', 'Dosya', 'Dosya seç', 'Klasör']) {
    await expect(imaging.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(imaging.locator('input[type="file"]')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Görüntüleme' })).toHaveAttribute('aria-selected', 'true')
})
