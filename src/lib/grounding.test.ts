import { describe, expect, it } from 'vitest'
import { parseWarning, parseWarnings, splitCitations } from './grounding'

describe('parseWarning', () => {
  it('maps backend grounding warnings to Turkish categories', () => {
    expect(parseWarning('Grounding: 2 uncited statement(s) in impression: "A"; "B".')).toMatchObject({
      kind: 'uncited',
      title: '2 kaynaksız ifade',
      section: 'Değerlendirme',
      detail: '"A"; "B"',
    })
    expect(
      parseWarning('Grounding: findings cites unknown reference(s) S4, F9 — not in the findings/passages given to the model.'),
    ).toMatchObject({ kind: 'unknown_ref', section: 'Bulgular', detail: 'S4, F9 modele verilen bulgu/kaynak listesinde yok.' })
    expect(
      parseWarning('Grounding: impression contains a definitive diagnosis statement ("Kesin tanı"); drafts must keep findings hedged.'),
    ).toMatchObject({ kind: 'overclaim', title: 'Kesin tanı ifadesi', section: 'Değerlendirme' })
    expect(parseWarning('Grounding: imaging finding(s) not mentioned in the draft: F2 (find-2).')).toMatchObject({
      kind: 'omitted',
      detail: 'F2 (find-2)',
    })
    expect(parseWarning('Structured findings originated from a MOCK imaging adapter.').kind).toBe('system')
    expect(parseWarning('Grounding: 1 differential(s) without citation: "Gliom".')).toMatchObject({
      kind: 'uncited',
      title: '1 dayanaksız ayırıcı tanı',
      section: 'Ayırıcı tanılar',
    })
    expect(
      parseWarning('Grounding: model left section(s) empty: findings, impression — placeholder or auto-listed findings were inserted; write these sections manually.'),
    ).toMatchObject({ kind: 'omitted', detail: 'Bulgular, Değerlendirme — yer tutucu metin ya da otomatik bulgu listesi eklendi; bu bölümleri elle yazın.' })
    expect(parseWarning('Grounding: differentials cites unknown reference(s) S7 — not in the findings/passages given to the model.')).toMatchObject({
      kind: 'unknown_ref',
      section: 'Ayırıcı tanılar',
    })
  })

  it('maps verifier verdicts', () => {
    expect(
      parseWarning('Verification: impression sentence is contradicted (overstated_certainty): "Kesin meningiom [F1]." — Bulgu şüpheli.'),
    ).toMatchObject({
      kind: 'overclaim',
      title: 'Kanıtla çelişen ifade · abartılmış kesinlik',
      section: 'Değerlendirme',
      detail: '“Kesin meningiom [F1].” — Bulgu şüpheli.',
    })
    expect(parseWarning('Verification: findings sentence is partially_supported (unsupported_claim): "Kitle ve ödem [F1]."')).toMatchObject({
      kind: 'uncited',
      title: 'Kısmen desteklenen ifade',
      detail: '“Kitle ve ödem [F1].”',
    })
  })

  it('sorts the most serious issues first', () => {
    const kinds = parseWarnings([
      'Report source is MOCK.',
      'Grounding: imaging finding(s) not mentioned in the draft: F2 (x).',
      'Grounding: impression contains a certainty statement ("kesinlikle"); drafts must keep findings hedged.',
    ]).map((w) => w.kind)
    expect(kinds).toEqual(['overclaim', 'omitted', 'system'])
  })
})

describe('splitCitations', () => {
  it('splits text and grouped markers', () => {
    expect(splitCitations('Kitle [F1]. Meningiom olası [F1, S2].')).toEqual([
      { type: 'text', value: 'Kitle ' },
      { type: 'cite', aliases: ['F1'] },
      { type: 'text', value: '. Meningiom olası ' },
      { type: 'cite', aliases: ['F1', 'S2'] },
      { type: 'text', value: '.' },
    ])
    expect(splitCitations('Atıf yok [X1].')).toEqual([{ type: 'text', value: 'Atıf yok [X1].' }])
  })
})

describe('draftToSections differentials', () => {
  it('lists LLM differentials with likelihood and citations', async () => {
    const { draftToSections } = await import('./backend')
    const section = { text: 't', cited_finding_ids: [] }
    const sections = draftToSections({
      report_id: 'r',
      case_id: 'c',
      status: 'draft',
      synthetic: true,
      clinically_validated: false,
      generation: { provider_id: 'p', model_id: 'm', model_version: 'v', generated_at: '' },
      technique: section,
      findings: section,
      impression: section,
      recommendations: section,
      validation_warnings: [],
      differentials: [
        { name: 'Meningiom', likelihood: 'high', supporting: [], against: [], citations: ['F1', 'S2'], finding_ids: [] },
        { name: 'Gliom', likelihood: 'low', supporting: [], against: [], citations: [], finding_ids: [] },
      ],
    })
    expect(sections.ayiriciTanilar).toBe('1. Meningiom — Yüksek olasılık [F1, S2]\n2. Gliom — Düşük olasılık')
  })
})
