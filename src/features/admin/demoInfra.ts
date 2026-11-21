// TÜM VERİLER DEMO AMAÇLIDIR. Gerçek hasta, kurum veya yayın bilgisi içermez.

export const GPU_SERIES = Array.from({ length: 60 }, (_, i) => {
  const base = 52 + 22 * Math.sin(i / 7) + 10 * Math.sin(i / 2.3)
  const spike = i > 44 && i < 52 ? 18 : 0
  const now = new Date(2026, 9, 19, 14, 0)
  now.setMinutes(now.getMinutes() - (59 - i))
  return {
    t: now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    gpu: Math.max(8, Math.min(98, Math.round(base + spike))),
    vram: Math.round(61 + 6 * Math.sin(i / 9)),
  }
})

/** UI service summary cards for System Status (i18n via services.* keys). */
export const SERVICES = [
  { key: 'frontend', detailKey: 'frontendDetail', status: 'demo', latency: '—' },
  { key: 'api', detailKey: 'apiDetail', status: 'demo', latency: '—' },
  { key: 'docWorker', detailKey: 'docWorkerDetail', status: 'demo', latency: '—' },
  { key: 'embed', detailKey: 'embedDetail', status: 'demo', latency: '—' },
  { key: 'llm', detailKey: 'llmDetail', status: 'demo', latency: '—' },
  { key: 'vector', detailKey: 'vectorDetail', status: 'demo', latency: '—' },
  { key: 'postgres', detailKey: 'postgresDetail', status: 'demo', latency: '—' },
  { key: 'object', detailKey: 'objectDetail', status: 'demo', latency: '—' },
] as const

export const DEPLOYMENTS = [
  { version: 'vetmind-neuro-v0.1', kind: 'Model', date: '2026-10-14 10:20', status: 'Başarılı', by: 'Admin' },
  { version: 'api v0.4.2', kind: 'Servis', date: '2026-10-12 17:45', status: 'Başarılı', by: 'CI/CD' },
  { version: 'kb-index #18', kind: 'Bilgi tabanı', date: '2026-10-03 09:10', status: 'Başarılı', by: 'Admin' },
  { version: 'worker v0.3.0', kind: 'Servis', date: '2026-09-29 13:02', status: 'Geri alındı', by: 'CI/CD' },
]
