import type { VetCase } from '../types'

/** Prefix for every local-only progress log line (not backend job fields). */
export const DEMO_FICTION_PREFIX = '[yerel]'

export interface Layer {
  key: string
  name: string
  start: number
  end: number
  /** Fiction-only; must never be shown in backend job Processing UI. */
  logs: (c: VetCase) => string[]
}

const docNames = (c: VetCase) => (c.documents.length ? c.documents.map((d) => d.name) : ['klinik_form.json'])

function fiction(lines: string[]): string[] {
  return lines.map((line) => `${DEMO_FICTION_PREFIX} ${line}`)
}

/**
 * Timed demo layers for **local** NewCase / DicomUpload animations only.
 * Backend Processing must not render these logs — use real job fields instead.
 */
export const LAYERS: Layer[] = [
  {
    key: 'data',
    name: 'Veri İşleme Katmanı',
    start: 0,
    end: 2000,
    logs: (c) =>
      fiction([
        ...docNames(c).map((n) => `${n} metne dönüştürülüyor…`),
        'Klinik varlık çıkarımı: bulgu, seviye, ilaç, laboratuvar değeri',
        `${c.documents.length || 1} belge işlendi, ${30 + c.documents.length * 6 - 1} klinik ifade çıkarıldı`,
      ]),
  },
  {
    key: 'rag',
    name: 'Bilgi Erişim Katmanı',
    start: 2000,
    end: 3800,
    logs: () =>
      fiction([
        'Sorgu vektörü oluşturuldu (vetmind-embed-tr-v1, 768 boyut) — backend hash RAG kullanır',
        'Nöroloji bilgi tabanında arama… (Qdrant, top-k = 20) — Qdrant yok; JSON lexical retrieve',
        'Yeniden sıralama (re-ranking) uygulandı',
        '12 ilgili kaynak bulundu (benzerlik ≥ 0.78)',
      ]),
  },
  {
    key: 'llm',
    name: 'LLM Analiz Katmanı',
    start: 3800,
    end: 6300,
    logs: (c) =>
      fiction([
        'Bağlam penceresi hazırlandı (6.412 token)',
        'Vaka özeti oluşturuluyor…',
        `Ayırıcı tanılar oluşturuluyor… (${c.ai?.differentials.length ?? 0} tanı)`,
        `Önerilen ek tetkikler hazırlandı (${c.ai?.recommendedTests.length ?? 0})`,
      ]),
  },
  {
    key: 'verify',
    name: 'Doğrulama Katmanı',
    start: 6300,
    end: 7800,
    logs: (c) => {
      const v = c.ai?.validation ?? []
      const n = (k: string) => v.filter((x) => x.kind === k).length
      return fiction([
        'İfadeler kaynak pasajlarla eşleştiriliyor…',
        `${n('ok')} ifade kaynakla doğrulandı, ${n('missing')} eksik bilgi tespit edildi`,
        ...(n('unsupported') ? [`${n('unsupported')} kaynakla desteklenmeyen ifade işaretlendi`] : []),
      ])
    },
  },
  {
    key: 'report',
    name: 'Rapor Oluşturma Katmanı',
    start: 7800,
    end: 8800,
    logs: () => fiction(['Rapor şablonu dolduruldu (5 bölüm)', 'Yapılandırılmış rapor taslağı hazırlandı']),
  },
  {
    key: 'expert',
    name: 'Uzman Onay Katmanı',
    start: 8800,
    end: 9600,
    logs: (c) =>
      fiction([`Öncelik belirlendi: ${c.priority}`, 'Taslak uzman kuyruğuna iletildi — Prof. Dr. Ahmet Demir (VRM)']),
  },
]

export const PIPELINE_MS = LAYERS[LAYERS.length - 1].end
export const AI_PHASE_START = LAYERS[1].start

export const LOCAL_DEMO_BANNER =
  'Yerel ilerleme animasyonu — canlı job alanları Processing ekranında gösterilir.'

/** Fiction layer logs are only for local demo timelines. */
export function shouldShowFictionLayers(mode: 'local' | 'backend'): boolean {
  return mode === 'local'
}

export function fictionLayerLogs(c: VetCase, mode: 'local' | 'backend'): string[] {
  if (!shouldShowFictionLayers(mode)) return []
  return LAYERS.flatMap((layer) => layer.logs(c))
}
