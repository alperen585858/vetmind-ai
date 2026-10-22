"""Seeded neurology corpus for demo RAG. Synthetic / educational passages only."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CorpusDoc:
    source_id: str
    title: str
    section: str
    passage: str
    keywords: tuple[str, ...]


SEED_CORPUS: tuple[CorpusDoc, ...] = (
    CorpusDoc(
        source_id="kb-1",
        title="Veteriner Nöroloji Ders Kitabı (örnek)",
        section="Bölüm 7 — Torakolomber Miyelopatiler",
        passage=(
            "Kondrodistrofik ırklarda nükleus pulpozusun erken kondroid dejenerasyonu, "
            "genellikle 3–7 yaş arasında akut Hansen tip I disk ekstrüzyonlarına zemin hazırlar. "
            "T3-L3 lezyonlarında pelvik ekstremitelerde üst motor nöron bulguları ile birlikte "
            "parezi veya pleji beklenir."
        ),
        keywords=("disk", "ivdd", "hansen", "miyelopati", "parezi", "dachshund", "spinal"),
    ),
    CorpusDoc(
        source_id="kb-2",
        title="Spinal Hastalıklar Derlemesi (örnek)",
        section="İntervertebral disk hastalığının sınıflandırılması",
        passage=(
            "Akut disk ekstrüzyonu vakalarının büyük bölümünde belirgin spinal hiperestezi gözlenir. "
            "Hansen tip II protrüzyonlar ise daha yavaş, kronik ve çoğunlukla daha hafif ağrılı bir seyir gösterir."
        ),
        keywords=("disk", "ekstrüzyon", "protrüzyon", "hansen", "hiperestezi", "ağrı"),
    ),
    CorpusDoc(
        source_id="kb-3",
        title="VRM Örnek MR Raporları Seti",
        section="Rapor #MR-0142 (anonimleştirilmiş, örnek)",
        passage=(
            "L1-L2 disk aralığı seviyesinde ventral yerleşimli, T2 ağırlıklı serilerde hipointens "
            "ekstradural materyal; spinal kordda kompresyon. Bulgular disk ekstrüzyonu ile uyumludur. "
            "(Örnek rapor dili — klinik tanı değildir.)"
        ),
        keywords=("mr", "mri", "kompresyon", "ekstradural", "t2", "görüntüleme", "brain", "cervical"),
    ),
    CorpusDoc(
        source_id="kb-4",
        title="Fibrokartilaginöz Emboli Vaka Serisi (örnek)",
        section="Klinik bulgular",
        passage=(
            "Fibrokartilaginöz emboli tipik olarak perakut başlangıçlı, ağrısız ve çoğunlukla "
            "lateralize nörolojik defisit ile karakterizedir. Belirgin spinal hiperestezi ayırıcı "
            "tanıda ekstrüzyon lehinedir."
        ),
        keywords=("fke", "emboli", "iskemik", "ağrısız", "akut", "lateralize"),
    ),
    CorpusDoc(
        source_id="kb-5",
        title="Spinal ve İntrakraniyal Neoplaziler Atlası (örnek)",
        section="Ekstradural ve ekstraaksiyel kitleler",
        passage=(
            "İntrakraniyal menenjiyom, yaşlı kedilerde en sık primer beyin tümörüdür; "
            "dural kuyruk işareti destekleyicidir. Kontrast tutulumu neoplazi lehine değerlendirilir."
        ),
        keywords=("neoplazi", "tümör", "menenjiyom", "kitle", "brain", "kontrast", "mass"),
    ),
    CorpusDoc(
        source_id="kb-6",
        title="Kedi ve Köpekte Nöbet Yönetimi (örnek)",
        section="Bölüm 3 — Nöbetlerin sınıflandırılması",
        passage=(
            "Kedilerde nöbetlerin önemli bir bölümü yapısal intrakraniyal hastalıklara bağlıdır; "
            "idiyopatik epilepsi tanısı ancak normal interiktal muayene, normal MR ve metabolik "
            "nedenlerin dışlanmasından sonra konmalıdır."
        ),
        keywords=("nöbet", "epilepsi", "idiyopatik", "seizure", "brain", "mri", "kedi", "feline"),
    ),
    CorpusDoc(
        source_id="kb-7",
        title="Servikal Spinal Hastalıklar (örnek)",
        section="Boyun ağrısının ayırıcı tanısı",
        passage=(
            "Genç köpeklerde boyun ağrısının ayırıcı tanısında servikal disk hastalığı ile birlikte "
            "steroid yanıtlı menenjit-arterit değerlendirilmelidir."
        ),
        keywords=("servikal", "cervical", "boyun", "c-spine", "bulldog", "neck"),
    ),
    CorpusDoc(
        source_id="kb-8",
        title="Toraks Radyografi Notları (örnek)",
        section="Pulmoner paternler",
        passage=(
            "İnterstisyel opaklıklar enfeksiyon, ödem veya neoplazi spektrumunda değerlendirilir. "
            "Tek projeksiyon yeterli olmayabilir; klinik korelasyon zorunludur. (Demo pasajı.)"
        ),
        keywords=("thorax", "chest", "lung", "xr", "radiograph", "opac", "pulmon"),
    ),
    CorpusDoc(
        source_id="kb-9",
        title="BT Nörogörüntüleme Özeti (örnek)",
        section="Kafa BT yaklaşımı",
        passage=(
            "BT, akut hemoraji ve kemik lezyonlarında hızlı tarama sağlar; yumuşak doku kontrastı "
            "MR kadar ayrıntılı değildir. (Demo pasajı — klinik rehber değildir.)"
        ),
        keywords=("ct", "bt", "tomografi", "brain", "hemorrhage", "volume"),
    ),
    CorpusDoc(
        source_id="kb-10",
        title="Raporlama Güvenlik Notları (örnek)",
        section="AI destekli taslaklar",
        passage=(
            "Otomatik taslaklar uzman incelemesi olmadan klinik karar için kullanılmamalıdır. "
            "Eksik bulgu, hastalığın yokluğu anlamına gelmez."
        ),
        keywords=("rapor", "review", "uzman", "draft", "validation", "mock"),
    ),
)
