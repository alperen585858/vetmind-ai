import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createTranslator } from '../../i18n'
import type { VetCase } from '../../shared/types'
import { isUrgentCase, sortWorklist } from './ExpertWorklistTable'
import { reasonIsValid } from './workspace/ReviewModals'
import { countReportableEvidence } from './workspace/useWorkspaceData'
import { WorkspaceViewer } from './workspace/WorkspaceViewer'

vi.mock('../../shared/shell/LocaleContext', () => ({
  useLocale: () => ({ locale: 'tr', t: createTranslator('tr') }),
}))

const HOUR = 3_600_000

function row(id: string, priority: VetCase['priority'], extra: Partial<VetCase> = {}): VetCase {
  return { id, priority, createdAt: '2026-11-20T10:00:00Z', reviewDueAt: null, ...extra } as VetCase
}

describe('expert worklist', () => {
  it('treats STAT and Acil as urgent', () => {
    expect(isUrgentCase(row('a', 'STAT'))).toBe(true)
    expect(isUrgentCase(row('b', 'Acil'))).toBe(true)
    expect(isUrgentCase(row('c', 'Yüksek'))).toBe(false)
    expect(isUrgentCase(row('d', 'Normal'))).toBe(false)
  })

  it('newest order: priority first, then the most recently arrived case', () => {
    const items = [
      row('old-normal', 'Normal', { createdAt: '2026-11-01T00:00:00Z' }),
      row('new-normal', 'Normal', { createdAt: '2026-11-25T00:00:00Z' }),
      row('stat', 'STAT', { createdAt: '2026-10-01T00:00:00Z' }),
      row('high', 'Yüksek'),
    ]
    expect(sortWorklist(items).map((c) => c.id)).toEqual(['stat', 'high', 'new-normal', 'old-normal'])
  })

  it('urgent order: least time left first within a priority, cases without a due time last', () => {
    const now = Date.now()
    const items = [
      row('later', 'Normal', { reviewDueAt: new Date(now + 10 * HOUR).toISOString() }),
      row('none', 'Normal'),
      row('soon', 'Normal', { reviewDueAt: new Date(now + 1 * HOUR).toISOString() }),
    ]
    expect(sortWorklist(items, 'urgent').map((c) => c.id)).toEqual(['soon', 'later', 'none'])
  })

  it('does not mutate the input list', () => {
    const items = [row('n', 'Normal'), row('s', 'STAT')]
    sortWorklist(items)
    expect(items.map((c) => c.id)).toEqual(['n', 's'])
  })
})

describe('review decisions', () => {
  it('revision / reject need a 10+ character reason and at least one reason code', () => {
    expect(reasonIsValid('Yetersiz bulgu açıklaması', ['missing_finding'])).toBe(true)
    expect(reasonIsValid('kısa', ['missing_finding'])).toBe(false)
    expect(reasonIsValid('   boşluklu      ', ['wrong_finding'])).toBe(false)
    expect(reasonIsValid('Yeterince uzun gerekçe', [])).toBe(false)
  })

  it('counts only accepted or edited evidence marked for the report', () => {
    const c = {
      backendFindings: {
        findings: [
          {
            evidence_references: [
              { include_in_report: true, review_status: 'accepted' },
              { include_in_report: true, review_status: 'edited' },
              { include_in_report: true, review_status: 'rejected' },
              { include_in_report: false, review_status: 'accepted' },
            ],
          },
          { evidence_references: [{ include_in_report: true, review_status: 'pending' }] },
          {},
        ],
      },
    } as unknown as VetCase
    expect(countReportableEvidence(c)).toBe(2)
    expect(countReportableEvidence(undefined)).toBe(0)
  })
})

describe('WorkspaceViewer', () => {
  it('shows the "no images" panel instead of the viewer when the case has no frames', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceViewer, {
        error: null,
        frames: [],
        loadingFrames: false,
        overlaysVisible: true,
        onToggleOverlays: () => {},
        overlays: [],
        focusSopUid: null,
        focusRequestId: 0,
        onActiveFrameChange: () => {},
        vhsEnabled: false,
        vhsSpecies: undefined,
        annotateEnabled: false,
        selectedEvidenceId: null,
        onAnnotateCommit: undefined,
      }),
    )
    const t = createTranslator('tr')
    expect(html).toContain(t('review.workspace.noImagesTitle'))
    expect(html).not.toContain(t('review.overlayOn'))
  })
})
