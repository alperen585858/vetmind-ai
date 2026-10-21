import type { VetCase } from '../types'

export interface Layer {
  key: string
  name: string
  start: number
  end: number
  logs: (c: VetCase) => string[]
}

const docNames = (c: VetCase) => (c.documents.length ? c.documents.map((d) => d.name) : ['klinik_form.json'])

export const LAYERS: Layer[] = [
  {
    key: 'data', name: 'Veri İşleme Katmanı', start: 0, end: 2000,
    logs: (c) => [
      ...docNames(c).map((n) => `${n} metne dönüştürülüyor…`),
      'Klinik varlık çıkarımı: bulgu, seviye, ilaç, laboratuvar değeri',
      `${c.documents.length || 1} belge işlendi, ${30 + c.documents.length * 6 - 1} klinik ifade çıkarıldı`,
    ],
  },
  {
    key: 'rag', name: 'Bilgi Erişim Katmanı (RAG)', start: 2000, end: 3800,
    logs: () => [
      'Sorgu vektörü oluşturuldu (vetmind-embed-tr-v1, 768 boyut)',
      'Nöroloji bilgi tabanında arama… (Qdrant, top-k = 20)',
      'Yeniden sıralama (re-ranking) uygulandı',
      '12 ilgili kaynak bulundu (benzerlik ≥ 0.78)',
    ],
  },
  {
    key: 'llm', name: 'LLM Analiz Katmanı', start: 3800, end: 6300,
    logs: (c) => [
      'Bağlam penceresi hazırlandı (6.412 token)',
      'Vaka özeti oluşturuluyor…',
      `Ayırıcı tanılar oluşturuluyor… (${c.ai?.differentials.length ?? 0} tanı)`,
      `Önerilen ek tetkikler hazırlandı (${c.ai?.recommendedTests.length ?? 0})`,
    ],
  },
  {
    key: 'verify', name: 'Doğrulama Katmanı', start: 6300, end: 7800,
    logs: (c) => {
      const v = c.ai?.validation ?? []
      const n = (k: string) => v.filter((x) => x.kind === k).length
      return [
        'İfadeler kaynak pasajlarla eşleştiriliyor…',
        `${n('ok')} ifade kaynakla doğrulandı, ${n('missing')} eksik bilgi tespit edildi`,
        ...(n('unsupported') ? [`${n('unsupported')} kaynakla desteklenmeyen ifade işaretlendi`] : []),
      ]
    },
  },
  {
    key: 'report', name: 'Rapor Oluşturma Katmanı', start: 7800, end: 8800,
    logs: () => ['Rapor şablonu dolduruldu (5 bölüm)', 'Yapılandırılmış rapor taslağı hazırlandı'],
  },
  {
    key: 'expert', name: 'Uzman Onay Katmanı', start: 8800, end: 9600,
    logs: (c) => [`Öncelik belirlendi: ${c.priority}`, 'Taslak uzman kuyruğuna iletildi — Prof. Dr. Ahmet Demir (VRM)'],
  },
]

export const PIPELINE_MS = LAYERS[LAYERS.length - 1].end
export const AI_PHASE_START = LAYERS[1].start
