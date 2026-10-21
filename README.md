# VetMind AI — Tıklanabilir Demo Prototipi

Yapay zekâ destekli veteriner klinik değerlendirme ve raporlama platformu için **demo prototip**.
Acıbadem Üniversitesi Bilgisayar Mühendisliği bitirme projesi · VRM Teknoloji iş birliğiyle.

> Gerçek backend, gerçek AI veya gerçek dosya işleme **yoktur**. Tüm veriler `src/data/mock.ts` ve
> `src/data/templates.ts` içindedir; AI işlem hattı animasyonla simüle edilir. Sayfa yenilenince veriler başa döner.

## Çalıştırma

Node.js 18+ gerekir.

```bash
npm install
npm run dev
```

Tarayıcı otomatik açılır (açılmazsa: http://localhost:5173).

Üretim derlemesi: `npm run build` (çıktı: `dist/`), önizleme: `npm run preview`.

## Demo akışı (önerilen sıra)

1. **Veteriner Hekim** olarak giriş yap → **Yeni Vaka** → sağ üstte **"Örnek vaka ile doldur"**
   → adımlarda **İleri** (3. adımda "Olası lezyon lokalizasyonu: T3-L3" ipucunu göster) → **Yapay Zekâ Değerlendirmesine Gönder**.
2. ~10 saniyelik **AI işleme** animasyonunu izle (6 katman) → **Ön değerlendirmeyi görüntüle**.
   - Ayırıcı tanılardaki **[1] [3]** gibi kaynak atıflarına tıkla → sağdan kaynak paneli açılır.
   - Sağdaki **Doğrulama Raporu** kutularına tıkla (yeşil / sarı "Derin ağrı…" / kırmızı "24 saat…").
   - **Belgeler** sekmesinde bir belgeye tıkla: ham metin ↔ çıkarılmış alanlar. **Görüntüleme** sekmesi: OHIF yer tutucu.
3. Üst bardaki **Rol değiştir → Uzman Hekim (VRM)** → kuyrukta bir vakada **İncele**
   (ana demo vakası **Paşa**, ya da yeni oluşturulan **Fındık**).
   - Sağdaki editörde **Değerlendirme** bölümünden kaynaksız "24 saat…" cümlesini sil → bölüm **"Düzenlendi"** rozeti alır,
     alttaki **Düzeltme Kaydı**'nda AI metni → uzman metni görünür, kategori seçilebilir.
   - **Onayla ve Yayınla** → bildirim çıkar, resmi rapor açılır. (Revizyon/Ret gerekçe modalı ister.)
4. **Rol değiştir → Hayvan Sahibi** (Mehmet Yılmaz: Paşa, Zeytin, Fındık) → "Raporunuz hazır" → **Raporu görüntüle** → **PDF olarak indir**.
5. **Rol değiştir → Sistem Yöneticisi** → **Uzmanlık Modülleri**, **Bilgi Tabanı** (öneri etiketlerinden birine tıklayarak
   benzerlik skorlu arama, "Kaynak Ekle"), **Sistem Durumu**.

## Mock vakalar

| Hasta   | Tür / Irk                  | Durum               |
|---------|----------------------------|---------------------|
| Paşa    | Köpek · Dachshund          | Uzman İncelemesinde (ana demo) |
| Duman   | Kedi · British Shorthair   | Onaylandı           |
| Karamel | Köpek · Golden Retriever   | AI Analizi          |
| Tarçın  | Köpek · Fransız Bulldog    | Revizyon İstendi    |
| Pamuk   | Kedi · Tekir               | Taslak              |
| Zeytin  | Köpek · Alman Kurdu        | Onaylandı           |

## Teknoloji

React 18 + TypeScript + Vite · Tailwind CSS · React Router · lucide-react · recharts.

## Klasör yapısı

```
src/
  App.tsx                 rotalar + rol bazlı erişim
  context/AppContext.tsx  rol, vakalar, bildirimler, kaynak paneli (oturum boyunca)
  data/mock.ts            kullanıcılar, vakalar, bilgi tabanı, izleme verileri
  data/templates.ts       mock AI çıktı şablonları ve belge üretimi
  lib/                    lokalizasyon ipucu, işlem hattı zamanlaması, tarih biçimleri
  components/             Sidebar, Topbar, StatusBadge, Card, AIDisclaimer, CitationChip, SourcePanel, Modal, …
  pages/                  Login, Dashboard, CaseList, NewCase, Processing, CaseDetail,
                          ExpertReview, ReviewQueue, ReportList, ApprovedReport,
                          Modules, KnowledgeBase, SystemStatus
```
