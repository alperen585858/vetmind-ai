import { describe, expect, it } from 'vitest'
import { splitRecommendations } from './recommendations'

describe('splitRecommendations', () => {
  it('splits a numbered block into items without the source numbers', () => {
    const text =
      '1. Kaynak görüntülerin incelenmesi.\n2. Bulguların doğrulanması.\n3. Bölgeler hastalıksız sayılmasın.\n4. RAG pasajlarını inceleyin.'
    expect(splitRecommendations(text)).toEqual([
      'Kaynak görüntülerin incelenmesi.',
      'Bulguların doğrulanması.',
      'Bölgeler hastalıksız sayılmasın.',
      'RAG pasajlarını inceleyin.',
    ])
  })

  it('handles inline numbering, bullets and blank lines', () => {
    expect(splitRecommendations('1. BOS analizi 2. CRP ölçümü')).toEqual(['BOS analizi', 'CRP ölçümü'])
    expect(splitRecommendations('- Toraks grafisi\n\n• Cerrahi konsültasyon\n3) Kontrol MR')).toEqual([
      'Toraks grafisi',
      'Cerrahi konsültasyon',
      'Kontrol MR',
    ])
  })

  it('keeps plain text and numbers inside a sentence intact', () => {
    expect(splitRecommendations('Analizi 2. kez deneyin.')).toEqual(['Analizi 2. kez deneyin.'])
    expect(splitRecommendations('T13-L1 seviyesi için kontrol MR')).toEqual(['T13-L1 seviyesi için kontrol MR'])
    expect(splitRecommendations('')).toEqual([])
    expect(splitRecommendations(undefined)).toEqual([])
  })
})
