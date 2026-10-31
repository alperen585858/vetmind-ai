// Mock AI çıktı şablonları. Gerçek bir model yoktur; yeni vakalar için
// nörolojik lokalizasyona göre bu şablonlardan biri seçilip hasta bilgileriyle doldurulur.
import type { Locale } from '../i18n/types'
import { TEMPLATES_EN } from './templatesEn'
import type {
  AIAssessment,
  CaseDocument,
  ClinicalInfo,
  DocType,
  ExtractedField,
  NeuroExam,
  Patient,
  ReportSections,
} from '../types'

export type TemplateKey = 'ivdd' | 'seizure' | 'vestibular' | 'cervical' | 'dm' | 'forebrain'

interface Imaging {
  study: string
  findings: string
  conclusion: string
  extracted: ExtractedField[]
}

interface TemplateOutput {
  ai: Omit<AIAssessment, 'model' | 'generatedAt'>
  draft: ReportSections
  imaging: Imaging
}

const sexText = (p: Patient) => `${p.neutered ? 'kısırlaştırılmış ' : ''}${p.sex.toLowerCase()}`
const intro = (p: Patient) =>
  `${p.name}, ${p.age} yaşında, ${p.weight} kg ağırlığında ${sexText(p)} ${p.breed} ırkı bir ${p.species === 'Köpek' ? 'köpektir' : 'kedidir'}.`

function deepPainChecks(n: NeuroExam, out: TemplateOutput) {
  if (n.deepPain === 'Değerlendirilmedi') {
    const idx = out.ai.validation.findIndex((v) => v.kind !== 'ok')
    out.ai.validation.splice(idx === -1 ? out.ai.validation.length : idx, 0, {
      kind: 'missing',
      text: 'Derin ağrı algısı muayene notunda belirtilmemiş',
      detail:
        'Pelvik ekstremitelerde derin ağrı algısının varlığı/yokluğu prognoz ve cerrahi karar için belirleyicidir. Muayene formunda bu alan "Değerlendirilmedi" olarak işaretlenmiş; uzman onayından önce tamamlanması önerilir.',
      citations: [9],
    })
    out.ai.findings.splice(1, 0, {
      text: 'Derin ağrı algısı kayıtlı değil — prognoz ve tedavi planı için kritik eksik bilgi',
      severity: 'Yüksek',
      citations: [9],
    })
  }
}

const ivdd = (p: Patient, n: NeuroExam): TemplateOutput => {
  const out: TemplateOutput = {
    imaging: {
      study: 'Torakolomber omurga MR — T2 sagittal, T2 transvers, T1 sagittal, T1 post-kontrast',
      findings:
        'L1-L2 intervertebral disk aralığı seviyesinde, vertebral kanalın ventralinde yer alan, T2 ağırlıklı görüntülerde hipointens ekstradural materyal izlenmektedir. Materyal spinal kordu sola lateralize şekilde yaklaşık %45 oranında komprese etmektedir. Komşu T13-L1 ve L2-L3 disk aralıklarında T2 sinyal kaybı (dejenerasyon) mevcuttur. Kontrast sonrası belirgin patolojik tutulum izlenmemiştir. Vertebral end-plate\'ler düzenlidir.',
      conclusion:
        'L1-L2 seviyesinde ventral, sola lateralize ekstradural kompresyon. Bulgular öncelikle intervertebral disk ekstrüzyonu ile uyumludur.',
      extracted: [
        { field: 'Bulgu', value: 'L1-L2 seviyesinde ventral ekstradural kompresyon', source: '"…vertebral kanalın ventralinde yer alan, T2 ağırlıklı görüntülerde hipointens ekstradural materyal izlenmektedir."' },
        { field: 'Kompresyon derecesi', value: '~%45, sola lateralize', source: '"…spinal kordu sola lateralize şekilde yaklaşık %45 oranında komprese etmektedir."' },
        { field: 'Eşlik eden bulgu', value: 'T13-L1 ve L2-L3 disk dejenerasyonu', source: '"Komşu T13-L1 ve L2-L3 disk aralıklarında T2 sinyal kaybı (dejenerasyon) mevcuttur."' },
        { field: 'Kontrast tutulumu', value: 'Belirgin patolojik tutulum yok', source: '"Kontrast sonrası belirgin patolojik tutulum izlenmemiştir."' },
        { field: 'Radyolog yorumu', value: 'İntervertebral disk ekstrüzyonu ile uyumlu', source: '"Bulgular öncelikle intervertebral disk ekstrüzyonu ile uyumludur."' },
      ],
    },
    ai: {
      summary: `${intro(p)} Akut başlangıçlı, progresif seyirli pelvik ekstremite güçsüzlüğü ve torakolomber bölgede spinal ağrı şikâyetiyle başvurmuştur. Nörolojik muayenede pelvik ekstremitelerde ${n.gait.toLowerCase()}, azalmış postüral reaksiyonlar ve normal-artmış spinal refleksler saptanmıştır; bulgular T3-L3 miyelopati ile uyumludur. MR raporunda L1-L2 seviyesinde ventral ekstradural kompresyon tanımlanmıştır. Signalment (kondrodistrofik ırk eğilimi, orta yaş), akut başlangıç, spinal hiperestezi ve görüntüleme bulguları birlikte değerlendirildiğinde Hansen tip I intervertebral disk ekstrüzyonu ön planda düşünülmektedir.`,
      findings: [
        { text: 'L1-L2 seviyesinde ventral ekstradural kompresyon (~%45, sola lateralize)', severity: 'Yüksek', citations: [3] },
        { text: 'Pelvik ekstremitelerde azalmış postüral reaksiyonlar, normal-artmış patellar refleks (üst motor nöron paterni)', severity: 'Orta', citations: [1] },
        { text: 'Torakolomber bölgede belirgin spinal hiperestezi', severity: 'Orta', citations: [2] },
        { text: 'Komşu disk aralıklarında dejeneratif değişiklikler', severity: 'Düşük', citations: [3] },
        { text: 'Hemogram ve biyokimya referans aralığında; sistemik inflamasyon bulgusu yok', severity: 'Düşük' },
      ],
      differentials: [
        {
          name: 'Hansen tip I intervertebral disk ekstrüzyonu',
          probability: 82,
          pro: ['Kondrodistrofik ırk ve orta yaş', 'Akut başlangıç ve spinal hiperestezi', 'MR\'da ventral ekstradural, T2 hipointens materyal'],
          con: ['Disk materyalinin karakterizasyonu raporda ayrıntılı tanımlanmamış'],
          citations: [1, 2, 3],
        },
        {
          name: 'Fibrokartilaginöz emboli (FKE)',
          probability: 8,
          pro: ['Akut başlangıç'],
          con: ['Belirgin spinal ağrı (FKE genellikle ağrısızdır)', 'MR\'da kompresif lezyon mevcut', 'Progresif seyir'],
          citations: [4],
        },
        {
          name: 'Spinal neoplazi',
          probability: 6,
          pro: ['Ekstradural lezyonlar ayırıcı tanıda yer alır'],
          con: ['Akut başlangıç', 'Kontrast tutulumu yok', 'Görece genç yaş'],
          citations: [5],
        },
        {
          name: 'Diskospondilit',
          probability: 4,
          pro: ['Spinal ağrı'],
          con: ['Normal lökosit sayısı, ateş yok', 'End-plate\'ler düzenli, erozyon bildirilmemiş'],
          citations: [6],
        },
      ],
      recommendedTests: [
        'Derin ağrı algısının değerlendirilmesi ve kayda geçirilmesi',
        'Cerrahi planlama için MR serilerinin (T2 transvers) uzman tarafından gözden geçirilmesi',
        'Preoperatif koagülasyon profili ve anestezi öncesi değerlendirme',
        'İnflamatuar süreç şüphesi doğarsa BOS analizi',
      ],
      validation: [
        { kind: 'ok', text: '"L1-L2 ventral ekstradural kompresyon" ifadesi MR raporu ile doğrulandı', detail: 'İfade, yüklenen MR raporunun "Bulgular" ve "Sonuç" bölümleriyle birebir eşleşiyor.', citations: [3] },
        { kind: 'ok', text: '"Kondrodistrofik ırklarda Hansen tip I ekstrüzyon predispozisyonu" kaynakla desteklendi', detail: 'Bilgi tabanında 2 bağımsız kaynakta ilgili pasaj bulundu (benzerlik 0.91 ve 0.87).', citations: [1, 2] },
        { kind: 'ok', text: '"FKE\'de spinal hiperestezi genellikle beklenmez" kaynakla desteklendi', detail: 'Aleyhine bulgu olarak kullanılan ifade, FKE vaka serisi kaynağıyla destekleniyor (benzerlik 0.84).', citations: [4] },
        { kind: 'unsupported', text: '"Belirtilerin 24 saat içinde belirgin şekilde kötüleştiği" ifadesi', detail: 'Bu zaman bilgisi yüklenen belgelerde veya klinik formda bulunamadı. Model tarafından çıkarım yapılmış olabilir; rapordan çıkarılması veya hekim tarafından teyit edilmesi önerilir.' },
      ],
    },
    draft: {
      klinikOzet: `${intro(p)} Akut başlangıçlı, progresif seyirli pelvik ekstremite güçsüzlüğü ve sırt ağrısı şikâyetiyle başvurmuştur.`,
      bulgular:
        'Nörolojik muayenede pelvik ekstremitelerde parezi/ataksi, azalmış postüral reaksiyonlar ve normal-artmış spinal refleksler saptanmıştır. Torakolomber bölgede spinal hiperestezi mevcuttur. MR\'da L1-L2 seviyesinde ventral, sola lateralize ekstradural kompresyon (~%45) izlenmiştir.',
      degerlendirme:
        'Bulgular T3-L3 miyelopati ile uyumludur. Signalment, akut başlangıç ve görüntüleme bulguları Hansen tip I intervertebral disk ekstrüzyonunu desteklemektedir. Belirtilerin 24 saat içinde belirgin şekilde kötüleştiği bildirilmiştir.',
      ayiriciTanilar:
        '1. Hansen tip I intervertebral disk ekstrüzyonu (yüksek olasılık)\n2. Fibrokartilaginöz emboli (düşük)\n3. Spinal neoplazi (düşük)\n4. Diskospondilit (düşük)',
      oneriler:
        'Derin ağrı algısının değerlendirilmesi. Cerrahi dekompresyon (hemilaminektomi) seçeneğinin değerlendirilmesi. Preoperatif koagülasyon profili. Konservatif tedavi tercih edilirse sıkı kafes istirahati ve analjezi.',
    },
  }
  deepPainChecks(n, out)
  return out
}

const seizure = (p: Patient): TemplateOutput => ({
  imaging: {
    study: 'Beyin MR — T2 transvers, FLAIR, T1 pre/post-kontrast',
    findings:
      'Serebral ve serebellar parankimde belirgin sinyal anomalisi izlenmemiştir. Ventriküler sistem simetrik ve normal genişliktedir. Kontrast sonrası patolojik tutulum yoktur. Orta hat şifti veya kitle etkisi izlenmemiştir.',
    conclusion: 'Yapısal intrakraniyal patoloji lehine bulgu saptanmamıştır.',
    extracted: [
      { field: 'Bulgu', value: 'Parankimal sinyal anomalisi yok', source: '"Serebral ve serebellar parankimde belirgin sinyal anomalisi izlenmemiştir."' },
      { field: 'Ventriküler sistem', value: 'Simetrik, normal', source: '"Ventriküler sistem simetrik ve normal genişliktedir."' },
      { field: 'Kontrast tutulumu', value: 'Yok', source: '"Kontrast sonrası patolojik tutulum yoktur."' },
    ],
  },
  ai: {
    summary: `${intro(p)} Son 3 ayda tekrarlayan jeneralize tonik-klonik nöbet öyküsüyle başvurmuştur. İnteriktal nörolojik muayene normaldir. Beyin MR'ında yapısal patoloji saptanmamış, metabolik panel referans aralığındadır. Bulgular idiyopatik epilepsi ile uyumlu olmakla birlikte kedilerde yapısal ve reaktif nedenlerin dikkatle dışlanması gerekmektedir.`,
    findings: [
      { text: 'Tekrarlayan jeneralize nöbetler (3 ayda 4 nöbet)', severity: 'Yüksek', citations: [7] },
      { text: 'İnteriktal nörolojik muayene normal', severity: 'Orta', citations: [9] },
      { text: 'Beyin MR\'ında yapısal patoloji saptanmadı', severity: 'Orta', citations: [3] },
      { text: 'Glukoz, elektrolit ve karaciğer parametreleri normal', severity: 'Düşük' },
    ],
    differentials: [
      { name: 'İdiyopatik epilepsi', probability: 58, pro: ['Normal interiktal muayene', 'Normal MR', 'Normal metabolik panel'], con: ['Kedilerde yapısal nedenler görece daha sık'], citations: [7] },
      { name: 'Yapısal intrakraniyal hastalık', probability: 27, pro: ['Kedilerde nöbetlerin önemli kısmı yapısal kökenli'], con: ['MR normal', 'Lateralize bulgu yok'], citations: [7, 5] },
      { name: 'Reaktif nöbet (metabolik/toksik)', probability: 15, pro: ['Jeneralize nöbet paterni'], con: ['Metabolik panel normal', 'Toksin maruziyeti öyküsü yok'], citations: [7] },
    ],
    recommendedTests: ['Nöbet günlüğü tutulması', 'BOS analizi (inflamatuar ensefalit dışlanması)', 'Antiepileptik başlanırsa serum ilaç düzeyi takibi'],
    validation: [
      { kind: 'ok', text: '"MR\'da yapısal patoloji saptanmadı" ifadesi MR raporu ile doğrulandı', detail: 'MR raporu sonuç bölümüyle eşleşiyor.', citations: [3] },
      { kind: 'ok', text: '"Kedilerde yapısal nedenler görece sık" ifadesi kaynakla desteklendi', detail: 'Nöbet yönetimi kaynağında ilgili pasaj bulundu (benzerlik 0.86).', citations: [7] },
      { kind: 'missing', text: 'BOS analizi sonucu bulunmuyor', detail: 'İnflamatuar ensefalitin dışlanması için BOS analizi önerilir.' },
    ],
  },
  draft: {
    klinikOzet: `${intro(p)} Son 3 ayda tekrarlayan jeneralize nöbet öyküsü mevcuttur.`,
    bulgular: 'İnteriktal nörolojik muayene normal. Beyin MR\'ında yapısal patoloji izlenmemiştir. Hemogram ve biyokimya referans aralığındadır.',
    degerlendirme: 'Bulgular idiyopatik epilepsi ile uyumludur. Yapısal ve reaktif nedenler mevcut tetkiklerle büyük ölçüde dışlanmıştır.',
    ayiriciTanilar: '1. İdiyopatik epilepsi\n2. Yapısal intrakraniyal hastalık\n3. Reaktif nöbet',
    oneriler: 'Fenobarbital ile antiepileptik tedavi başlanması, 2. haftada serum düzeyi kontrolü. Nöbet günlüğü tutulması. BOS analizi değerlendirilebilir.',
  },
})

const vestibular = (p: Patient, n: NeuroExam): TemplateOutput => ({
  imaging: {
    study: 'Kafa BT — kemik ve yumuşak doku penceresi',
    findings: 'Sağ timpanik bullada hafif duvar kalınlaşması izlenmektedir; bulla içi yumuşak doku dansitesi saptanmamıştır. Beyin sapı ve serebellum bölgesinde belirgin patoloji izlenmemiştir.',
    conclusion: 'Belirgin orta kulak efüzyonu yok; sağ bullada minimal duvar kalınlaşması.',
    extracted: [
      { field: 'Bulgu', value: 'Sağ timpanik bullada minimal duvar kalınlaşması', source: '"Sağ timpanik bullada hafif duvar kalınlaşması izlenmektedir."' },
      { field: 'Orta kulak', value: 'Efüzyon yok', source: '"…bulla içi yumuşak doku dansitesi saptanmamıştır."' },
    ],
  },
  ai: {
    summary: `${intro(p)} Akut başlangıçlı baş eğikliği, nistagmus ve vestibüler ataksi ile başvurmuştur. Postüral reaksiyonlar ve bilinç durumu ${n.consciousness === 'Uyanık' ? 'normaldir' : 'etkilenmiştir'}; bulgular periferik vestibüler sendrom ile daha uyumludur. Yaşlı köpekte akut başlangıç idiyopatik vestibüler sendromu desteklemektedir.`,
    findings: [
      { text: 'Akut baş eğikliği ve horizontal nistagmus', severity: 'Yüksek', citations: [8] },
      { text: 'Postüral reaksiyonlar korunmuş (periferik lehine)', severity: 'Orta', citations: [8, 9] },
      { text: 'Sağ bullada minimal duvar kalınlaşması', severity: 'Düşük', citations: [11] },
    ],
    differentials: [
      { name: 'İdiyopatik vestibüler sendrom', probability: 58, pro: ['Yaşlı köpek, akut başlangıç', 'Postüral reaksiyonlar normal'], con: ['BT\'de minimal bulla değişikliği'], citations: [8] },
      { name: 'Orta-iç kulak hastalığı', probability: 29, pro: ['Bulla duvar kalınlaşması'], con: ['Efüzyon yok', 'Otitis eksterna öyküsü yok'], citations: [8, 11] },
      { name: 'Merkezi vestibüler lezyon', probability: 13, pro: ['Ayırıcı tanıda mutlaka değerlendirilmeli'], con: ['Bilinç ve postüral reaksiyonlar normal'], citations: [8] },
    ],
    recommendedTests: ['Otoskopik muayene', 'Tiroid paneli (T4, TSH)', 'Klinik kötüleşme olursa beyin MR'],
    validation: [
      { kind: 'ok', text: '"Postüral reaksiyonların korunması periferik lezyonu destekler" kaynakla desteklendi', detail: 'Vestibüler hastalıklar derlemesinde ilgili pasaj (benzerlik 0.88).', citations: [8] },
      { kind: 'missing', text: 'Otoskopik muayene bulgusu belirtilmemiş', detail: 'Orta-iç kulak hastalığı ayırıcı tanısı için otoskopik muayene sonucu gereklidir.' },
    ],
  },
  draft: {
    klinikOzet: `${intro(p)} Akut başlangıçlı baş eğikliği, nistagmus ve ataksi ile başvurmuştur.`,
    bulgular: 'Baş eğikliği, horizontal nistagmus, vestibüler ataksi. Postüral reaksiyonlar normal. BT\'de sağ bullada minimal duvar kalınlaşması.',
    degerlendirme: 'Periferik vestibüler sendrom ile uyumludur; idiyopatik vestibüler sendrom ön planda.',
    ayiriciTanilar: '1. İdiyopatik vestibüler sendrom\n2. Orta-iç kulak hastalığı\n3. Merkezi vestibüler lezyon',
    oneriler: 'Destekleyici tedavi (antiemetik), otoskopik muayene, 72 saat içinde klinik kontrol.',
  },
})

const cervical = (p: Patient): TemplateOutput => ({
  imaging: {
    study: 'Servikal omurga MR — T2 sagittal/transvers, T1 post-kontrast',
    findings: 'C2-C3 disk aralığında ventral ekstradural materyal ile hafif-orta derecede spinal kord kompresyonu izlenmektedir. C4-C5 seviyesinde ventral disk protrüzyonu mevcuttur. Meningeal kontrast tutulumu izlenmemiştir.',
    conclusion: 'C2-C3 seviyesinde ventral ekstradural kompresyon.',
    extracted: [
      { field: 'Bulgu', value: 'C2-C3 ventral ekstradural kompresyon', source: '"C2-C3 disk aralığında ventral ekstradural materyal ile hafif-orta derecede spinal kord kompresyonu…"' },
      { field: 'Eşlik eden bulgu', value: 'C4-C5 disk protrüzyonu', source: '"C4-C5 seviyesinde ventral disk protrüzyonu mevcuttur."' },
      { field: 'Meningeal tutulum', value: 'Yok', source: '"Meningeal kontrast tutulumu izlenmemiştir."' },
    ],
  },
  ai: {
    summary: `${intro(p)} Akut başlangıçlı boyun ağrısı, alçak baş duruşu ve boynu hareket ettirmekte isteksizlik ile başvurmuştur. Nörolojik açık defisit belirgin değildir. MR'da C2-C3 seviyesinde ventral ekstradural kompresyon izlenmiştir. Servikal intervertebral disk ekstrüzyonu ön planda düşünülmektedir.`,
    findings: [
      { text: 'Belirgin servikal hiperestezi', severity: 'Yüksek', citations: [10] },
      { text: 'C2-C3 ventral ekstradural kompresyon', severity: 'Yüksek', citations: [3] },
      { text: 'Nörolojik defisit yok / minimal', severity: 'Orta' },
    ],
    differentials: [
      { name: 'Servikal intervertebral disk ekstrüzyonu', probability: 64, pro: ['Brakisefal/kondrodistrofik ırk', 'MR bulgusu'], con: [], citations: [10, 2] },
      { name: 'Steroid yanıtlı menenjit-arterit / meningomiyelit', probability: 22, pro: ['Genç yaş, boyun ağrısı'], con: ['Ateş yok', 'Meningeal tutulum yok'], citations: [10] },
      { name: 'Vertebral malformasyon', probability: 14, pro: ['Fransız Bulldog\'da sık'], con: ['Servikal bölgede tanımlanmamış'], citations: [10] },
    ],
    recommendedTests: ['BOS analizi', 'CRP ölçümü'],
    validation: [
      { kind: 'ok', text: '"C2-C3 ventral ekstradural kompresyon" MR raporu ile doğrulandı', detail: 'MR raporu ile eşleşiyor.', citations: [3] },
      { kind: 'missing', text: 'Vücut ısısı kaydı bulunmuyor', detail: 'Menenjit ayırıcı tanısı için ateş bilgisi gereklidir.' },
    ],
  },
  draft: {
    klinikOzet: `${intro(p)} Akut başlangıçlı boyun ağrısı ile başvurmuştur.`,
    bulgular: 'Belirgin servikal hiperestezi, alçak baş duruşu. Nörolojik defisit saptanmadı. MR\'da C2-C3 ventral ekstradural kompresyon.',
    degerlendirme: 'Servikal intervertebral disk ekstrüzyonu ile uyumludur.',
    ayiriciTanilar: '1. Servikal disk ekstrüzyonu\n2. Steroid yanıtlı menenjit-arterit\n3. Vertebral malformasyon',
    oneriler: 'Kafes istirahati, analjezi; ağrı kontrol edilemezse cerrahi (ventral slot) değerlendirmesi.',
  },
})

const dm = (p: Patient): TemplateOutput => ({
  imaging: {
    study: 'Torakolomber omurga MR — T2 sagittal/transvers',
    findings: 'T13-L1 ve L1-L2 seviyelerinde dorsal anulus protrüzyonu ile hafif spinal kord kompresyonu izlenmektedir. Spinal kordda belirgin intramedüller sinyal değişikliği saptanmamıştır.',
    conclusion: 'Hafif derecede çok seviyeli disk protrüzyonu; klinik tabloyu tek başına açıklamayabilir.',
    extracted: [
      { field: 'Bulgu', value: 'T13-L1 ve L1-L2 hafif disk protrüzyonu', source: '"…dorsal anulus protrüzyonu ile hafif spinal kord kompresyonu izlenmektedir."' },
      { field: 'Radyolog yorumu', value: 'Klinik tabloyu tek başına açıklamayabilir', source: '"…klinik tabloyu tek başına açıklamayabilir."' },
    ],
  },
  ai: {
    summary: `${intro(p)} Aylar içinde yavaş ilerleyen, ağrısız pelvik ekstremite ataksisi ve propriyoseptif defisit ile başvurmuştur. MR'da hafif çok seviyeli disk protrüzyonu mevcuttur ancak klinik tabloyu tam açıklamamaktadır. Irk, yaş ve ağrısız progresif seyir dejeneratif miyelopatiyi düşündürmektedir.`,
    findings: [
      { text: 'Kronik progresif, ağrısız pelvik ataksi', severity: 'Yüksek', citations: [12] },
      { text: 'Pelvik ekstremitelerde propriyoseptif defisit', severity: 'Orta', citations: [9] },
      { text: 'Hafif çok seviyeli disk protrüzyonu', severity: 'Orta', citations: [3] },
    ],
    differentials: [
      { name: 'Dejeneratif miyelopati', probability: 61, pro: ['Alman Kurdu, ileri yaş', 'Ağrısız progresif seyir'], con: ['Kesin tanı histopatolojik'], citations: [12] },
      { name: 'Hansen tip II disk protrüzyonu', probability: 29, pro: ['MR\'da protrüzyon'], con: ['Kompresyon hafif', 'Ağrı yok'], citations: [2] },
      { name: 'Spinal neoplazi', probability: 10, pro: ['Yaş'], con: ['MR\'da kitle yok'], citations: [5] },
    ],
    recommendedTests: ['SOD1 genetik testi', 'Fizyoterapi programı'],
    validation: [
      { kind: 'ok', text: '"DM tipik olarak ağrısız ve progresiftir" kaynakla desteklendi', detail: 'Dejeneratif miyelopati kaynağı (benzerlik 0.90).', citations: [12] },
      { kind: 'missing', text: 'SOD1 genetik test sonucu yok', detail: 'Destekleyici tanı için önerilir.' },
    ],
  },
  draft: {
    klinikOzet: `${intro(p)} Kronik progresif pelvik ekstremite ataksisi ile başvurmuştur.`,
    bulgular: 'Ağrısız pelvik ataksi ve propriyoseptif defisit. MR\'da T13-L1 ve L1-L2 seviyelerinde hafif disk protrüzyonu.',
    degerlendirme: 'Klinik tablo dejeneratif miyelopati ile uyumludur; MR bulguları tabloyu tek başına açıklamamaktadır.',
    ayiriciTanilar: '1. Dejeneratif miyelopati\n2. Hansen tip II disk protrüzyonu\n3. Spinal neoplazi',
    oneriler: 'SOD1 genetik testi, düzenli fizyoterapi, 3 ayda bir nörolojik kontrol.',
  },
})

const forebrain = (p: Patient): TemplateOutput => ({
  imaging: {
    study: 'Beyin MR — T2, FLAIR, T1 post-kontrast',
    findings: 'Sol frontal lobda ekstraaksiyel, geniş tabanlı, homojen kontrast tutan kitle lezyonu izlenmektedir. Dural kuyruk işareti mevcuttur. Hafif perilezyonel ödem vardır.',
    conclusion: 'Sol frontal ekstraaksiyel kitle — menenjiyom ile uyumlu olabilir.',
    extracted: [
      { field: 'Bulgu', value: 'Sol frontal ekstraaksiyel kitle', source: '"Sol frontal lobda ekstraaksiyel, geniş tabanlı, homojen kontrast tutan kitle…"' },
      { field: 'Destekleyici işaret', value: 'Dural kuyruk', source: '"Dural kuyruk işareti mevcuttur."' },
    ],
  },
  ai: {
    summary: `${intro(p)} Davranış değişikliği ve tek yöne dönme ile başvurmuştur. Bulgular prosensefalon lezyonu ile uyumludur. İleri yaş kedide ekstraaksiyel kitle varlığı menenjiyomu ön plana çıkarmaktadır.`,
    findings: [
      { text: 'Davranış değişikliği ve dönme (prosensefalon)', severity: 'Yüksek', citations: [9] },
      { text: 'Sol frontal ekstraaksiyel kitle', severity: 'Yüksek', citations: [5] },
    ],
    differentials: [
      { name: 'Menenjiyom', probability: 62, pro: ['İleri yaş kedi', 'Dural kuyruk'], con: [], citations: [5] },
      { name: 'Metabolik ensefalopati', probability: 21, pro: ['Davranış değişikliği'], con: ['Fokal kitle mevcut'], citations: [9] },
      { name: 'İnflamatuar ensefalit', probability: 17, pro: [], con: ['Kitle lezyonu'], citations: [9] },
    ],
    recommendedTests: ['Toraks grafisi (metastaz taraması)', 'Cerrahi konsültasyon'],
    validation: [{ kind: 'ok', text: '"Dural kuyruk menenjiyomu destekler" kaynakla desteklendi', detail: 'Neoplazi atlası (benzerlik 0.85).', citations: [5] }],
  },
  draft: {
    klinikOzet: `${intro(p)} Davranış değişikliği ve dönme şikâyeti ile başvurmuştur.`,
    bulgular: 'Prosensefalon bulguları. MR\'da sol frontal ekstraaksiyel kitle.',
    degerlendirme: 'Menenjiyom ile uyumlu olabilir.',
    ayiriciTanilar: '1. Menenjiyom\n2. Metabolik ensefalopati\n3. İnflamatuar ensefalit',
    oneriler: 'Toraks grafisi, cerrahi konsültasyon.',
  },
})

export const TEMPLATES: Record<TemplateKey, (p: Patient, n: NeuroExam) => TemplateOutput> = {
  ivdd,
  seizure: (p) => seizure(p),
  vestibular,
  cervical: (p) => cervical(p),
  dm: (p) => dm(p),
  forebrain: (p) => forebrain(p),
}

/** Locale-aware template builder (TR default). */
export function getTemplate(key: TemplateKey, locale: Locale = 'tr') {
  return locale === 'en' ? TEMPLATES_EN[key] : TEMPLATES[key]
}

const MODEL = 'vetmind-neuro-v0.1 (LLM, LoRA)'

export function buildAssessment(
  key: TemplateKey,
  p: Patient,
  n: NeuroExam,
  generatedAt: string,
  locale: Locale = 'tr',
) {
  const out = getTemplate(key, locale)(p, n)
  const ai: AIAssessment = { ...out.ai, model: MODEL, generatedAt }
  return { ai, draft: out.draft, imaging: out.imaging }
}

const DOC_SIZES: Record<DocType, [string, number]> = {
  'MR Raporu': ['184 KB', 2],
  'BT Raporu': ['152 KB', 2],
  'Laboratuvar Sonucu': ['96 KB', 1],
  'Önceki Rapor': ['121 KB', 1],
}

export function makeDocument(
  id: string,
  name: string,
  type: DocType,
  p: Patient,
  c: ClinicalInfo,
  imaging: Imaging,
): CaseDocument {
  const header = `Hasta: ${p.name} | Tür: ${p.species} | Irk: ${p.breed} | Yaş: ${p.age} | Sahip: ${p.ownerName}`
  const [size, pages] = DOC_SIZES[type]
  if (type === 'MR Raporu' || type === 'BT Raporu') {
    return {
      id, name, type, size, pages,
      rawText: `${type === 'MR Raporu' ? 'MANYETİK REZONANS GÖRÜNTÜLEME' : 'BİLGİSAYARLI TOMOGRAFİ'} RAPORU  (DEMO VERİSİ)\n${header}\n\nİnceleme: ${imaging.study}\n\nBULGULAR:\n${imaging.findings}\n\nSONUÇ:\n${imaging.conclusion}\n\nRaporlayan: Örnek Görüntüleme Merkezi (demo)`,
      extracted: imaging.extracted,
    }
  }
  if (type === 'Laboratuvar Sonucu') {
    return {
      id, name, type, size, pages,
      rawText: `LABORATUVAR SONUÇ RAPORU  (DEMO VERİSİ)\n${header}\n\nHEMOGRAM\nWBC: 9.8 x10³/µL  (ref. 6.0–17.0)\nHCT: %44  (ref. 37–55)\nPLT: 312 x10³/µL  (ref. 200–500)\n\nBİYOKİMYA\nALT: 48 U/L  (ref. 10–100)\nKreatinin: 0.9 mg/dL  (ref. 0.5–1.5)\nGlukoz: 96 mg/dL  (ref. 70–143)\nTotal protein: 6.4 g/dL  (ref. 5.2–8.2)\n\nYorum: Tüm parametreler referans aralığındadır.`,
      extracted: [
        { field: 'Lökosit (WBC)', value: '9.8 x10³/µL — normal', source: '"WBC: 9.8 x10³/µL  (ref. 6.0–17.0)"' },
        { field: 'Glukoz', value: '96 mg/dL — normal', source: '"Glukoz: 96 mg/dL  (ref. 70–143)"' },
        { field: 'Böbrek fonksiyonu', value: 'Kreatinin 0.9 mg/dL — normal', source: '"Kreatinin: 0.9 mg/dL  (ref. 0.5–1.5)"' },
        { field: 'Genel yorum', value: 'Sistemik anormallik saptanmadı', source: '"Tüm parametreler referans aralığındadır."' },
      ],
    }
  }
  return {
    id, name, type, size, pages,
    rawText: `KLİNİK MUAYENE NOTU  (DEMO VERİSİ)\n${header}\n\nŞikâyet: ${c.complaint}\nBaşlangıç: ${c.onset}, seyir: ${c.course}\nÖzgeçmiş: ${c.history}\nUygulanan tedavi: ${c.medications || 'Yok'}\n\nPlan: İleri nörolojik değerlendirme ve görüntüleme için sevk edilmiştir.`,
    extracted: [
      { field: 'Başvuru şikâyeti', value: c.complaint, source: `"Şikâyet: ${c.complaint}"` },
      { field: 'Başlangıç / seyir', value: `${c.onset} / ${c.course}`, source: `"Başlangıç: ${c.onset}, seyir: ${c.course}"` },
      { field: 'Mevcut ilaçlar', value: c.medications || 'Yok', source: `"Uygulanan tedavi: ${c.medications || 'Yok'}"` },
    ],
  }
}
