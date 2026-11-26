import { expect, test } from '@playwright/test'
import { loginAsVet } from './helpers/auth'

// #68: additional clinical information is its own list with author, role and a readable date;
// the original complaint / history fields never show a raw "[<time> · <user>]" stamp.
test('vet adds clinical information after sending; history stays clean', async ({ page, request }) => {
  const response = await request.post('http://127.0.0.1:8000/api/v1/cases', {
    data: {
      patient_name: `Not-${Date.now().toString(36)}`,
      species: 'canine',
      modality: 'MR',
      anatomical_region: 'BRAIN',
      clinical_history: 'Arka bacaklarda güçsüzlük',
      scenario: 'brain_mri_suspected',
    },
  })
  await expect(response).toBeOK()
  const { case_id } = await response.json()
  // Notes are for cases already sent: run the (mock) analysis so the case leaves draft.
  await expect(await request.post(`http://127.0.0.1:8000/api/v1/cases/${case_id}/analyze`)).toBeOK()

  await loginAsVet(page)
  await page.goto(`/vakalar/${case_id}`)
  const notes = page.getByTestId('clinical-notes')
  await expect(notes.getByText('Klinik öyküye ek bilgi')).toBeVisible({ timeout: 20_000 })
  await expect(notes.getByText(/atanmış uzmana bildirim gider/)).toBeVisible()

  const body = `Derin ağrı bugün kayboldu ${Date.now().toString(36)}`
  await page.getByTestId('clinical-note-input').fill(body)
  await page.getByTestId('clinical-note-save').click()

  const entry = page.getByTestId('clinical-note').filter({ hasText: body })
  await expect(entry).toBeVisible({ timeout: 15_000 })
  await expect(entry).toContainText('Dr. Elif Kaya · Veteriner hekim')
  await expect(entry).toContainText(/\d{1,2} \S+ \d{4} · \d{2}:\d{2}/)
  await expect(entry).not.toContainText('anonymous')
  await expect(entry).not.toContainText('@')

  // The note never leaks into the complaint / history rows as a raw stamp.
  await page.reload()
  await expect(page.getByTestId('clinical-note').filter({ hasText: body })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/\[\d{4}-\d{2}-\d{2}T/)).toHaveCount(0)
  await expect(page.getByText('Arka bacaklarda güçsüzlük').first()).toBeVisible()
})
