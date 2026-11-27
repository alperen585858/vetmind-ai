import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { expect, it, vi } from 'vitest'
import { createTranslator } from '../../i18n'
import { summaryToVetCase } from '../../shared/lib/caseMapper'
import CaseDetail from './CaseDetailPage'

const patient = summaryToVetCase({
  case_id: 'case-navigation',
  patient_name: 'Pax',
  species: 'canine',
  modality: 'MR',
  anatomical_region: 'BRAIN',
  status: 'awaiting_review',
  created_at: '2026-11-23T10:00:00Z',
  unread_messages: 3,
})
vi.mock('../../shared/shell/AppContext', () => ({
  useApp: () => ({ role: 'vet', getCase: () => patient }),
}))
vi.mock('../../shared/shell/LocaleContext', () => ({
  useLocale: () => ({ locale: 'tr', t: createTranslator('tr') }),
}))

it('renders the clinical overview for an old messages link even with unread messages', () => {
  const html = renderToStaticMarkup(createElement(StaticRouter, {
    location: '/vakalar/case-navigation?tab=mesajlar',
    children: createElement(CaseDetail),
  }))

  expect(html).toContain('id="case-panel-genel"')
  expect(html).toContain('Klinik Özet')
  expect(html).toContain('Görüntüleme')
  expect(html).not.toContain('3 okunmamış mesaj')
  expect(html).not.toContain('>Mesajlar<')
  expect(html).not.toContain('>DICOM görüntüle<')
})

it('shows one tab row with Report, Documents and History; no hidden module box (#73)', () => {
  const html = renderToStaticMarkup(createElement(StaticRouter, {
    location: '/vakalar/case-navigation?tab=gecmis',
    children: createElement(CaseDetail),
  }))
  const tabs = [...html.matchAll(/role="tab"[^>]*>(?:<svg[\s\S]*?<\/svg>)?\s*([^<]+)</g)].map((m) => m[1].trim())
  expect(tabs).toEqual(['Klinik Özet', 'Görüntüleme', 'AI Bulguları', 'Rapor', 'Kaynaklar', 'Belgeler', 'Geçmiş'])
  expect(html).toContain('id="case-panel-gecmis"')
  expect(html).not.toContain('Diğer vaka modülleri')
  expect(html).not.toContain('Klinik Özete dön')
  // #69: the progress box is gone from the overview; the timeline lives on History.
  expect(html).not.toContain('Vaka ilerleme')
})

it('the overview shows translated modality/region and no status rows (#71)', () => {
  const html = renderToStaticMarkup(createElement(StaticRouter, {
    location: '/vakalar/case-navigation',
    children: createElement(CaseDetail),
  }))
  expect(html).toContain('MR · Beyin')
  expect(html).not.toContain('MR · BRAIN')
  expect(html).not.toContain('Study UID')
  expect(html).not.toContain('Sınıflandırma')
  expect(html).not.toContain('DICOM görüntüleyiciye git')
  expect(html).not.toContain('Durum Zaman Çizelgesi')
})
