from uuid import uuid4

from app.llm.interfaces import LLMRequest, LLMResponse
from app.schemas.enums import ModelExecutionStatus, ReportStatus, SourceKind
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection

SYNTHETIC_BANNER = (
    "SENTETİK TASLAK RAPOR — demo (mock) rapor şablonuyla üretildi. "
    "Klinik olarak doğrulanmamıştır. Orijinal çalışma bir veteriner radyolog tarafından incelenmelidir. "
    "Bulgu bildirilmemesi hastalığın olmadığı anlamına gelmez."
)

# Report text is Turkish like the rest of the product (llm_report_language defaults to "tr").
_SPECIES_TR = {"canine": "köpek", "feline": "kedi", "other": "diğer"}
_MODALITY_TR = {"MR": "MR", "CT": "BT", "XR": "röntgen", "OTHER": "diğer"}
_REGION_TR = {
    "BRAIN": "beyin",
    "CERVICAL": "servikal omurga",
    "THORAX": "toraks",
    "OTHER": "diğer",
    "UNKNOWN": "bilinmiyor",
}
_STATUS_TR = {
    "suspected": "şüpheli",
    "possible": "olası",
    "uncertain": "belirsiz",
    "not_assessed": "değerlendirilmedi",
}


class MockLLMProvider:
    provider_id = "mock-llm"
    model_id = "mock-report-generator"
    model_version = "0.1.0"

    def generate(self, request: LLMRequest) -> LLMResponse:
        gen = request.generation
        cited = [f.finding_id for f in gen.findings]
        doc_note = ""
        if gen.document_context_file_count > 0:
            doc_note = (
                f" Belge bağlamı: {gen.document_context_file_count} dosya "
                "yalnızca taslak metni olarak kullanıldı (dosya yolları gösterilmez)."
            )
        technique = ReportSection(
            text=(
                f"{SYNTHETIC_BANNER}\n\n"
                f"Teknik (yalnızca metadata): tür={_SPECIES_TR.get(gen.species.value, gen.species.value)}, "
                f"modalite={_MODALITY_TR.get(gen.modality.value, gen.modality.value)}, "
                f"bölge={_REGION_TR.get(gen.anatomical_region.value, gen.anatomical_region.value)}. "
                f"DICOM pikselleri yeniden oluşturulmadı ve yorumlanmadı.{doc_note}"
            ),
            cited_finding_ids=[],
        )
        if gen.execution_status == ModelExecutionStatus.UNSUPPORTED:
            findings_text = (
                f"{SYNTHETIC_BANNER}\n\n"
                "Bu vaka için otomatik görüntüleme hattı desteklenmiyor. "
                "Klinik kullanım için demo görüntü bulgusu üretilmedi."
            )
            impression_text = (
                f"{SYNTHETIC_BANNER}\n\n"
                "Değerlendirme: vaka manuel veteriner radyolog incelemesine yönlendirildi. "
                "Otomatik değerlendirme sunulmuyor."
            )
            recs = (
                "Orijinal görüntüleme çalışması veteriner radyolog tarafından manuel incelenmelidir. "
                "Bu taslağı klinik kararlar için kullanmayın."
            )
        elif gen.execution_status == ModelExecutionStatus.FAILED:
            findings_text = f"{SYNTHETIC_BANNER}\n\nDemo görüntü analizi başarısız oldu. Görüntüleme bulgusu yok."
            impression_text = f"{SYNTHETIC_BANNER}\n\nGörüntü analizi başarısız olduğu için değerlendirme üretilemedi."
            recs = "Hatanın nedeni incelendikten sonra analizi yeniden çalıştırın. Uzman incelemesi yine gereklidir."
        elif gen.no_findings_returned or not gen.findings:
            findings_text = (
                f"{SYNTHETIC_BANNER}\n\n"
                "Demo görüntü analizi bulgu döndürmedi. "
                "Bu, çalışmanın normal olduğu anlamına gelmez."
            )
            impression_text = (
                f"{SYNTHETIC_BANNER}\n\n"
                "Değerlendirme: yapılandırılmış demo bulgu dönmedi. "
                "Hastalığın olmadığı doğrulanmamıştır."
            )
            recs = "Herhangi bir klinik sonuca varmadan önce çalışmanın tamamı veteriner radyolog tarafından incelenmelidir."
        else:
            bullets = "\n".join(
                f"- [{f.finding_code}] {f.description} "
                f"(durum: {_STATUS_TR.get(f.finding_status.value, f.finding_status.value)}, konum: {f.anatomical_location})"
                for f in gen.findings
            )
            findings_text = f"{SYNTHETIC_BANNER}\n\nBildirilen demo bulgular:\n{bullets}"
            impression_text = (
                f"{SYNTHETIC_BANNER}\n\n"
                "Değerlendirme: yukarıdaki demo bulgular yalnızca şüpheli/belirsiz maddeler olarak listelenmiştir. "
                "Radyolog incelemesi olmadan nihai klinik rapora aktarılmamalıdır."
            )
            recs = (
                "1. Kaynak görüntülerin veteriner radyolog tarafından incelenmesi (mevcutsa).\n"
                "2. Atıf yapılan her demo bulgunun doğrulanması veya reddedilmesi.\n"
                "3. Listelenmeyen anatomik bölgelerin hastalıksız kabul edilmemesi."
            )

        rag_block = ""
        used_passages = []
        used_ids: list[str] = []
        if gen.rag_passages:
            # Deterministic "used" subset — not all retrieved passages are cited (ISS-RAG-04).
            take = max(1, min(2, len(gen.rag_passages)))
            for idx, p in enumerate(gen.rag_passages[:take]):
                related = [cited[idx % len(cited)]] if cited else []
                used = p.model_copy(update={"related_finding_ids": related})
                used_passages.append(used)
                used_ids.append(p.source_id)
            lines = [
                f"- [{p.source_id}] {p.title} / {p.section} (benzerlik={p.score}): {p.passage[:180]}…"
                if len(p.passage) > 180
                else f"- [{p.source_id}] {p.title} / {p.section} (benzerlik={p.score}): {p.passage}"
                for p in used_passages
            ]
            unused = len(gen.rag_passages) - len(used_passages)
            rag_block = (
                "\n\nDemo RAG bağlamı (yalnızca kullanılan pasajlar — klinik kanıt değildir):\n"
                + "\n".join(lines)
            )
            if unused:
                rag_block += f"\n(Bulunan {unused} pasaja bu demo taslakta atıf yapılmadı.)"
            recs = f"{recs}\n4. Listelenen RAG demo pasajlarını inceleyin; bulguların kanıtı olarak kabul etmeyin."

        if request.revision is not None:
            # Template provider cannot rewrite; show the request was received (demo visibility).
            recs = f"{recs}\n\nUzman revizyon talebi alındı (şablon taslak, model yeniden yazmadı): {request.revision.expert_note}"

        report = DraftReport(
            report_id=f"rpt-{uuid4().hex[:12]}",
            case_id=gen.case_id,
            status=ReportStatus.DRAFT,
            generation=GenerationMetadata(
                provider_id=self.provider_id,
                model_id=self.model_id,
                model_version=self.model_version,
                source_kind=SourceKind.MOCK,
                synthetic=True,
                clinically_validated=False,
            ),
            technique=technique,
            findings=ReportSection(text=findings_text + rag_block, cited_finding_ids=cited),
            impression=ReportSection(text=impression_text, cited_finding_ids=cited),
            recommendations=ReportSection(text=recs, cited_finding_ids=[]),
            synthetic=True,
            clinically_validated=False,
            rag_citations=used_passages,
            used_passage_ids=used_ids,
            rag_note=(
                "Yalnızca demo taslağın kullandığı RAG pasajları gösterilir "
                "(benzerlik skoru klinik güven düzeyi değildir). Klinik kanıt değildir."
            ),
        )
        return LLMResponse(
            provider_id=self.provider_id,
            model_id=self.model_id,
            model_version=self.model_version,
            report=report,
            raw_text=None,
        )
