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
    # Relevance tags (see app/rag/relevance.py). Empty = untagged/general doc that is
    # never filtered out by region/species (e.g. clinic-uploaded custom-* documents).
    regions: tuple[str, ...] = ()
    species: tuple[str, ...] = ()


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
        regions=("SPINE_TL",),
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
        regions=("SPINE",),
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
        regions=("SPINE_TL",),
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
        regions=("SPINE",),
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
        regions=("BRAIN", "SPINE"),
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
        regions=("BRAIN",),
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
        regions=("CERVICAL",),
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
        regions=("THORAX",),
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
        regions=("BRAIN",),
    ),
    CorpusDoc(
        source_id="kb-11",
        title="Toraks Radyografi: Pulmoner Paternler (örnek)",
        section="Bronşiyal, interstisyel ve alveolar patern",
        passage=(
            "Bronşiyal patern kalınlaşmış bronş duvarlarıyla (uçtan görünümde 'halka', yandan 'tren rayı') "
            "tanınır; kedide astım, köpekte kronik bronşit ile ilişkilidir. İnterstisyel patern yapılandırılmamış "
            "(yaş, ekspozisyon, ödem, fibrozis) veya nodüler (metastaz, granülom) olabilir. Alveolar patern hava "
            "bronkogramı ve lob sınırı işaretiyle tanınır; kranioventral dağılım aspirasyon/bronkopnömoniyi, "
            "köpekte kaudodorsal-perihiler dağılım kardiyojenik ödemi düşündürür. Dağılım ve klinik bulgu "
            "birlikte yorumlanır. (Demo pasajı — klinik rehber değildir.)"
        ),
        keywords=(
            "toraks", "akciğer", "patern", "bronşiyal", "interstisyel", "alveolar", "bronkogram",
            "öksürük", "astım", "bronşit", "pnömoni", "lung", "pattern", "radyografi",
        ),
        regions=("THORAX",),
    ),
    CorpusDoc(
        source_id="kb-12",
        title="Plevral Efüzyon (örnek)",
        section="Plevral boşluk",
        passage=(
            "Plevral sıvıda interlobar fissür çizgileri, akciğer loblarının göğüs duvarından çekilmesi, "
            "kostofrenik açıların yuvarlaklaşması ve kalp siluetinin silinmesi görülür. Kedide başlıca nedenler "
            "konjestif kalp yetmezliği, piyotoraks, şilotoraks, FIP ve mediastinal lenfomadır. Ciddi solunum "
            "güçlüğünde radyografiden önce stabilizasyon ve torakosentez düşünülür; sıvı boşaltıldıktan sonra "
            "çekilen grafi altta yatan kitleyi ortaya çıkarabilir. (Demo pasajı — klinik rehber değildir.)"
        ),
        keywords=(
            "plevral", "efüzyon", "sıvı", "torakosentez", "piyotoraks", "şilotoraks", "dispne",
            "nefes darlığı", "solunum güçlüğü", "pleural", "effusion", "kedi",
        ),
        regions=("THORAX",),
    ),
    CorpusDoc(
        source_id="kb-13",
        title="Kardiyak Siluet ve Kalp Yetmezliği Bulguları (örnek)",
        section="Kardiyomegali",
        passage=(
            "Vertebral kalp skoru (VHS) kalp boyutunu vertebra cinsinden ölçer; köpekte üst sınır çoğunlukla "
            "yaklaşık 10.5 kabul edilir ancak ırka göre değişir, kedide yaklaşık 8'in üzeri büyümeyi düşündürür. "
            "Sol atriyum büyümesinde trakea dorsale itilir ve ana bronşlar ayrışır. Köpekte kardiyojenik ödem "
            "tipik olarak perihiler-kaudodorsal, kedide daha düzensiz ve yamalı dağılır. Öksürük ve egzersiz "
            "intoleransı olan yaşlı köpekte kalp ve hava yolu nedenleri birlikte değerlendirilir. "
            "(Demo pasajı — klinik rehber değildir.)"
        ),
        keywords=(
            "kalp", "kardiyomegali", "vhs", "sol atriyum", "ödem", "kalp yetmezliği", "öksürük",
            "egzersiz intoleransı", "cardiac", "heart", "toraks",
        ),
        regions=("THORAX",),
    ),
    CorpusDoc(
        source_id="kb-14",
        title="Toraks Travması ve Pnömotoraks (örnek)",
        section="Travma sonrası toraks",
        passage=(
            "Pnömotoraksta lateral grafide kalp sternumdan ayrılmış görünür, akciğer kenarı ile göğüs duvarı "
            "arasında damar izi olmayan hava alanı bulunur. Travma sonrası pulmoner kontüzyon lob sınırına uymayan "
            "interstisyel-alveolar opasite oluşturur ve ilk 24 saatte belirginleşebilir. Kaburga kırıkları ve "
            "diyafram hernisi ayrıca aranır. (Demo pasajı — klinik rehber değildir.)"
        ),
        keywords=(
            "pnömotoraks", "travma", "kontüzyon", "kaburga", "kırık", "diyafram", "hernisi",
            "trafik kazası", "pneumothorax", "trauma", "toraks",
        ),
        regions=("THORAX",),
    ),
    CorpusDoc(
        source_id="kb-15",
        title="Toraks Metastaz Taraması (örnek)",
        section="Pulmoner nodüller",
        passage=(
            "Metastaz taramasında sağ lateral, sol lateral ve ventrodorsal/dorsoventral olmak üzere üç projeksiyon "
            "önerilir; üstte kalan akciğer daha iyi havalanır ve nodül orada daha kolay görülür. Birkaç milimetrenin "
            "altındaki nodüller radyografide görülmeyebilir; BT daha duyarlıdır. Uç-on görülen damarlar nodülle "
            "karıştırılabilir. (Demo pasajı — klinik rehber değildir.)"
        ),
        keywords=(
            "metastaz", "nodül", "tümör", "neoplazi", "tarama", "üç projeksiyon", "kitle",
            "metastasis", "nodule", "akciğer", "toraks",
        ),
        regions=("THORAX",),
    ),
    CorpusDoc(
        source_id="kb-16",
        title="Trakea ve Özofagus (örnek)",
        section="Hava yolu ve mediasten",
        passage=(
            "Trakeal kollaps özellikle küçük ırklarda (Yorkshire Terrier, Pomeranian) görülür, dinamiktir ve "
            "inspirasyon/ekspirasyon grafileri veya floroskopi gerektirebilir; 'kaz ötüşü' öksürüğü tipiktir. "
            "Megaözofagusta gazla dolu genişlemiş özofagus trakeayı ventrale itebilir ve kranioventral "
            "aspirasyon pnömonisi eşlik edebilir. (Demo pasajı — klinik rehber değildir.)"
        ),
        keywords=(
            "trakea", "kollaps", "özofagus", "megaözofagus", "regürjitasyon", "aspirasyon", "öksürük",
            "trachea", "esophagus", "mediasten", "toraks",
        ),
        regions=("THORAX",),
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
        regions=("META",),
    ),
)
