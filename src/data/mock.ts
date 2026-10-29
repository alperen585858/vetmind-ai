// TÜM VERİLER DEMO AMAÇLIDIR. Gerçek hasta, kurum veya yayın bilgisi içermez.
import type {
  ClinicalInfo,
  DocType,
  KbSource,
  NeuroExam,
  Patient,
  ReportSections,
  Role,
  User,
} from '../types'

export const USERS: Record<Role, User> = {
  vet: { name: 'Dr. Elif Kaya', title: 'Veteriner Hekim', org: 'Örnek Veteriner Kliniği (demo)', initials: 'EK' },
  expert: { name: 'Prof. Dr. Ahmet Demir', title: 'Uzman Veteriner Nörolog', org: 'VRM Teknoloji', initials: 'AD' },
  owner: { name: 'Mehmet Yılmaz', title: 'Hayvan Sahibi', org: '', initials: 'MY' },
  clinic_owner: { name: 'Klinik Yöneticisi', title: 'Klinik Sahibi', org: 'Örnek Veteriner Kliniği (demo)', initials: 'KY' },
  admin: { name: 'Admin', title: 'Sistem Yöneticisi', org: 'VetMind AI', initials: 'SY' },
}

export const ROLE_LABELS: Record<Role, string> = {
  vet: 'Veteriner Hekim',
  expert: 'Uzman Hekim (VRM)',
  owner: 'Hayvan Sahibi',
  clinic_owner: 'Klinik Sahibi',
  admin: 'Sistem Yöneticisi',
}

export const CLINIC = 'Örnek Veteriner Kliniği (demo)'

export const KB_SOURCES: KbSource[] = [
  { id: 1, title: 'Veteriner Nöroloji Ders Kitabı (örnek)', type: 'Kitap', section: 'Bölüm 7 — Torakolomber Miyelopatiler', license: 'İzinli', chunks: 1240, indexedAt: '2026-09-02', keywords: ['disk', 'ivdd', 'hansen', 't3-l3', 'kondrodistrofik', 'dachshund', 'miyelopati', 'parezi', 'refleks'], passage: 'Kondrodistrofik ırklarda (ör. Dachshund) nükleus pulpozusun erken kondroid dejenerasyonu, genellikle 3–7 yaş arasında akut Hansen tip I disk ekstrüzyonlarına zemin hazırlar. T3-L3 lezyonlarında pelvik ekstremitelerde üst motor nöron bulguları (normal-artmış spinal refleksler) ile birlikte parezi veya pleji beklenir.' },
  { id: 2, title: 'Spinal Hastalıklar Derlemesi (örnek)', type: 'Bilimsel yayın', section: 'İntervertebral disk hastalığının sınıflandırılması', license: 'İzinli', chunks: 386, indexedAt: '2026-09-04', keywords: ['disk', 'ekstrüzyon', 'protrüzyon', 'hansen', 'hiperestezi', 'ağrı', 'tip ii'], passage: 'Akut disk ekstrüzyonu vakalarının büyük bölümünde belirgin spinal hiperestezi gözlenir. Hansen tip II protrüzyonlar ise daha yavaş, kronik ve çoğunlukla daha hafif ağrılı bir klinik seyir gösterir.' },
  { id: 3, title: 'VRM Örnek MR Raporları Seti', type: 'VRM örnek rapor', section: 'Rapor #MR-0142 (anonimleştirilmiş, örnek)', license: 'İzinli', chunks: 920, indexedAt: '2026-09-18', keywords: ['mr', 'kompresyon', 'ekstradural', 'ventral', 'l1-l2', 't2', 'görüntüleme'], passage: 'L1-L2 disk aralığı seviyesinde ventral yerleşimli, T2 ağırlıklı serilerde hipointens ekstradural materyal; spinal kordda sola lateralize kompresyon. Bulgular disk ekstrüzyonu ile uyumludur. (Örnek rapor dilini göstermek amacıyla anonimleştirilmiştir.)' },
  { id: 4, title: 'Fibrokartilaginöz Emboli Vaka Serisi (örnek)', type: 'Bilimsel yayın', section: 'Klinik bulgular', license: 'İzinli', chunks: 142, indexedAt: '2026-09-05', keywords: ['fke', 'emboli', 'iskemik', 'ağrısız', 'akut', 'lateralize'], passage: 'Fibrokartilaginöz emboli tipik olarak perakut başlangıçlı, ağrısız ve çoğunlukla lateralize nörolojik defisit ile karakterizedir. İlk 24 saatten sonra kötüleşme beklenmez; belirgin spinal hiperestezi ayırıcı tanıda ekstrüzyon lehinedir.' },
  { id: 5, title: 'Spinal ve İntrakraniyal Neoplaziler Atlası (örnek)', type: 'Kitap', section: 'Ekstradural ve ekstraaksiyel kitleler', license: 'İzinli', chunks: 610, indexedAt: '2026-09-07', keywords: ['neoplazi', 'tümör', 'menenjiyom', 'kitle', 'kontrast', 'dural kuyruk'], passage: 'Spinal neoplaziler çoğunlukla ileri yaşta, kronik progresif seyirle ortaya çıkar. Kontrast tutulumu ve kemik değişiklikleri neoplazi lehine değerlendirilir. İntrakraniyal menenjiyom, yaşlı kedilerde en sık primer beyin tümörüdür; dural kuyruk işareti destekleyicidir.' },
  { id: 6, title: 'Diskospondilit Klinik Notları (örnek)', type: 'Bilimsel yayın', section: 'Tanı yaklaşımı', license: 'İzinli', chunks: 98, indexedAt: '2026-09-07', keywords: ['diskospondilit', 'enfeksiyon', 'ateş', 'end-plate', 'lökosit'], passage: 'Diskospondilit vakalarında spinal ağrıya sıklıkla ateş, lökositoz ve görüntülemede vertebral end-plate erozyonu eşlik eder. Normal end-plate morfolojisi tanıyı olası kılmaz.' },
  { id: 7, title: 'Kedi ve Köpekte Nöbet Yönetimi (örnek)', type: 'Kitap', section: 'Bölüm 3 — Nöbetlerin sınıflandırılması', license: 'İzinli', chunks: 540, indexedAt: '2026-09-10', keywords: ['nöbet', 'epilepsi', 'idiyopatik', 'reaktif', 'yapısal', 'kedi', 'fenobarbital'], passage: 'Kedilerde nöbetlerin önemli bir bölümü yapısal intrakraniyal hastalıklara bağlıdır; bu nedenle idiyopatik epilepsi tanısı ancak normal interiktal muayene, normal MR ve metabolik nedenlerin dışlanmasından sonra konmalıdır.' },
  { id: 8, title: 'Vestibüler Hastalıklar Derlemesi (örnek)', type: 'Bilimsel yayın', section: 'Periferik ve merkezi vestibüler sendrom', license: 'İzinli', chunks: 210, indexedAt: '2026-09-12', keywords: ['vestibüler', 'nistagmus', 'baş eğikliği', 'otitis', 'periferik', 'merkezi'], passage: 'Postüral reaksiyonların ve bilinç durumunun korunması periferik vestibüler sendromu destekler. Yaşlı köpeklerde akut başlangıçlı idiyopatik vestibüler sendrom sıklıkla 72 saat içinde belirgin düzelme gösterir.' },
  { id: 9, title: 'Nörolojik Muayene Rehberi (örnek)', type: 'Kitap', section: 'Ağrı algısı ve postüral reaksiyonlar', license: 'İzinli', chunks: 330, indexedAt: '2026-09-01', keywords: ['muayene', 'derin ağrı', 'postüral', 'refleks', 'propriyosepsiyon', 'kraniyal sinir'], passage: 'Pleji veya ağır parezi bulunan hastalarda derin ağrı algısının değerlendirilmesi, prognozu belirleyen en önemli muayene bulgusudur ve her vakada kayıt altına alınmalıdır.' },
  { id: 10, title: 'Servikal Spinal Hastalıklar (örnek)', type: 'Bilimsel yayın', section: 'Boyun ağrısının ayırıcı tanısı', license: 'Beklemede', chunks: 176, indexedAt: '2026-10-01', keywords: ['servikal', 'boyun', 'menenjit', 'srma', 'c1-c5', 'bulldog'], passage: 'Genç köpeklerde boyun ağrısının ayırıcı tanısında servikal disk hastalığı ile birlikte steroid yanıtlı menenjit-arterit mutlaka değerlendirilmelidir; ateş ve BOS bulguları ayrımda yol göstericidir.' },
  { id: 11, title: 'VRM Örnek BT Raporları Seti', type: 'VRM örnek rapor', section: 'Kafa BT örnekleri', license: 'İzinli', chunks: 264, indexedAt: '2026-09-20', keywords: ['bt', 'bulla', 'orta kulak', 'tomografi'], passage: 'Timpanik bulla duvar kalınlaşması ve bulla içi yumuşak doku dansitesi orta kulak hastalığını destekler. (Örnek rapor, anonimleştirilmiş.)' },
  { id: 12, title: 'Dejeneratif Miyelopati İncelemesi (örnek)', type: 'Bilimsel yayın', section: 'Klinik seyir', license: 'Beklemede', chunks: 118, indexedAt: '2026-10-03', keywords: ['dejeneratif', 'miyelopati', 'sod1', 'alman kurdu', 'kronik', 'ataksi'], passage: 'Dejeneratif miyelopati, ileri yaşta, ağrısız ve yavaş progresif pelvik ataksi ile karakterizedir. SOD1 mutasyonu destekleyicidir; kesin tanı histopatolojiktir.' },
]

const normalNeuro: NeuroExam = {
  consciousness: 'Uyanık', gait: 'Normal', limbs: [], posturalThoracic: 'Normal', posturalPelvic: 'Normal',
  reflexThoracic: 'Normal', reflexPelvic: 'Normal', cranialNerves: [], deepPain: 'Var', hyperesthesia: 'Yok',
}

// "Örnek vaka ile doldur" butonunun kullandığı veri
export const SAMPLE_FORM = {
  patient: { name: 'Fındık', species: 'Köpek', breed: 'Beagle', sex: 'Dişi', neutered: true, age: 5, weight: 12, ownerName: 'Mehmet Yılmaz', ownerPhone: '0555 000 00 01' } as Patient,
  clinical: { complaint: 'Arka bacaklarda dün akşam başlayan güçsüzlük, sırtına dokunulunca ağrı, yürürken sendeleme', onset: 'Akut', course: 'Progresif', history: 'Daha önce benzer şikâyet yok. Aşıları güncel. Parkta yüksek bir yerden atladıktan sonra başladığı belirtiliyor.', medications: 'Meloksikam 0.1 mg/kg/gün (1 gündür)' } as ClinicalInfo,
  neuro: { consciousness: 'Uyanık', gait: 'Parezi', limbs: ['Sol arka', 'Sağ arka'], posturalThoracic: 'Normal', posturalPelvic: 'Azalmış', reflexThoracic: 'Normal', reflexPelvic: 'Artmış', cranialNerves: [], deepPain: 'Değerlendirilmedi', hyperesthesia: 'Torakolomber' } as NeuroExam,
  files: [
    { name: 'MR_raporu_Findik.pdf', type: 'MR Raporu' as DocType, size: '184 KB' },
    { name: 'Kan_tahlili_Findik.pdf', type: 'Laboratuvar Sonucu' as DocType, size: '96 KB' },
    { name: 'Onceki_muayene_notu.pdf', type: 'Önceki Rapor' as DocType, size: '121 KB' },
  ],
}

export const EMPTY_NEURO = normalNeuro

export const SECTION_LABELS: Record<keyof ReportSections, string> = {
  klinikOzet: 'Teknik / Klinik özet',
  bulgular: 'Bulgular (Findings)',
  degerlendirme: 'Yorum / İzlenim (Interpretation & Impression)',
  ayiriciTanilar: 'Ayırıcı tanılar (opsiyonel)',
  oneriler: 'Öneriler (Recommendations)',
}

// --- Yönetici / izleme verileri ---

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

/** UI service summary cards for System Status. */
export const SERVICES = [
  { name: 'Frontend', detail: 'React SPA', status: 'demo', latency: '—' },
  { name: 'API (FastAPI)', detail: 'Canlı durum için /health panelini kullanın', status: 'demo', latency: '—' },
  { name: 'Doküman İşleme Worker', detail: 'Doküman işleme kuyruğu', status: 'demo', latency: '—' },
  { name: 'Embedding Servisi', detail: 'vetmind-embed-tr-v1', status: 'demo', latency: '—' },
  { name: 'LLM Inference (vLLM)', detail: 'Dil modeli çıkarımı', status: 'demo', latency: '—' },
  { name: 'Vektör DB (Qdrant)', detail: 'Vektör depolama', status: 'demo', latency: '—' },
  { name: 'PostgreSQL', detail: 'İlişkisel veri deposu', status: 'demo', latency: '—' },
  { name: 'Object Storage', detail: 'Nesne depolama', status: 'demo', latency: '—' },
] as const

export const DEPLOYMENTS = [
  { version: 'vetmind-neuro-v0.1', kind: 'Model', date: '2026-10-14 10:20', status: 'Başarılı', by: 'Admin' },
  { version: 'api v0.4.2', kind: 'Servis', date: '2026-10-12 17:45', status: 'Başarılı', by: 'CI/CD' },
  { version: 'kb-index #18', kind: 'Bilgi tabanı', date: '2026-10-03 09:10', status: 'Başarılı', by: 'Admin' },
  { version: 'worker v0.3.0', kind: 'Servis', date: '2026-09-29 13:02', status: 'Geri alındı', by: 'CI/CD' },
]

export const MODULES = [
  { key: 'noroloji', name: 'Nöroloji', status: 'Aktif', docs: 12, cases: 148, model: 'vetmind-neuro-v0.1', desc: 'Spinal, intrakraniyal ve nöromüsküler hastalıklar' },
  { key: 'kardiyoloji', name: 'Kardiyoloji', status: 'Planlanıyor', desc: 'Ekokardiyografi ve EKG raporları' },
  { key: 'onkoloji', name: 'Onkoloji', status: 'Planlanıyor', desc: 'Histopatoloji ve evreleme raporları' },
  { key: 'ortopedi', name: 'Ortopedi', status: 'Planlanıyor', desc: 'Radyografi ve eklem değerlendirmeleri' },
  { key: 'dermatoloji', name: 'Dermatoloji', status: 'Planlanıyor', desc: 'Sitoloji ve deri biyopsisi raporları' },
] as const
