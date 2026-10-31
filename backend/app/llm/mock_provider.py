from uuid import uuid4

from app.llm.interfaces import LLMRequest, LLMResponse
from app.schemas.enums import ModelExecutionStatus, ReportStatus, SourceKind
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection

SYNTHETIC_BANNER_TR = (
    "SENTETİK TASLAK RAPOR — demo (mock) rapor şablonuyla üretildi. "
    "Klinik olarak doğrulanmamıştır. Orijinal çalışma bir veteriner radyolog tarafından incelenmelidir. "
    "Bulgu bildirilmemesi hastalığın olmadığı anlamına gelmez."
)
SYNTHETIC_BANNER_EN = (
    "SYNTHETIC DRAFT REPORT — produced with the demo (mock) report template. "
    "Not clinically validated. The original study must be reviewed by a veterinary radiologist. "
    "Absence of listed findings does not mean absence of disease."
)

_SPECIES = {
    "tr": {"canine": "köpek", "feline": "kedi", "other": "diğer"},
    "en": {"canine": "canine", "feline": "feline", "other": "other"},
}
_MODALITY = {
    "tr": {"MR": "MR", "CT": "BT", "XR": "röntgen", "OTHER": "diğer"},
    "en": {"MR": "MR", "CT": "CT", "XR": "radiograph", "OTHER": "other"},
}
_REGION = {
    "tr": {
        "BRAIN": "beyin",
        "CERVICAL": "servikal omurga",
        "THORAX": "toraks",
        "OTHER": "diğer",
        "UNKNOWN": "bilinmiyor",
    },
    "en": {
        "BRAIN": "brain",
        "CERVICAL": "cervical spine",
        "THORAX": "thorax",
        "OTHER": "other",
        "UNKNOWN": "unknown",
    },
}
_STATUS = {
    "tr": {
        "suspected": "şüpheli",
        "possible": "olası",
        "uncertain": "belirsiz",
        "not_assessed": "değerlendirilmedi",
    },
    "en": {
        "suspected": "suspected",
        "possible": "possible",
        "uncertain": "uncertain",
        "not_assessed": "not assessed",
    },
}

# Keep Turkish alias for older imports/tests.
SYNTHETIC_BANNER = SYNTHETIC_BANNER_TR
_SPECIES_TR = _SPECIES["tr"]
_MODALITY_TR = _MODALITY["tr"]
_REGION_TR = _REGION["tr"]
_STATUS_TR = _STATUS["tr"]


class MockLLMProvider:
    provider_id = "mock-llm"
    model_id = "mock-report-generator"
    model_version = "0.1.0"

    def generate(self, request: LLMRequest) -> LLMResponse:
        gen = request.generation
        lang = (gen.language or "tr").strip().lower()
        if lang not in {"tr", "en"}:
            lang = "tr"
        en = lang == "en"
        banner = SYNTHETIC_BANNER_EN if en else SYNTHETIC_BANNER_TR
        species_map = _SPECIES[lang]
        modality_map = _MODALITY[lang]
        region_map = _REGION[lang]
        status_map = _STATUS[lang]
        cited = [f.finding_id for f in gen.findings]
        doc_note = ""
        if gen.document_context_file_count > 0:
            doc_note = (
                f" Document context: {gen.document_context_file_count} file(s) used as draft text only "
                "(file paths are not shown)."
                if en
                else (
                    f" Belge bağlamı: {gen.document_context_file_count} dosya "
                    "yalnızca taslak metni olarak kullanıldı (dosya yolları gösterilmez)."
                )
            )
        technique_prefix = "Technique (metadata only)" if en else "Teknik (yalnızca metadata)"
        species_l = "species" if en else "tür"
        modality_l = "modality" if en else "modalite"
        region_l = "region" if en else "bölge"
        pixels = (
            "DICOM pixels were not reconstructed or interpreted."
            if en
            else "DICOM pikselleri yeniden oluşturulmadı ve yorumlanmadı."
        )
        technique = ReportSection(
            text=(
                f"{banner}\n\n"
                f"{technique_prefix}: {species_l}={species_map.get(gen.species.value, gen.species.value)}, "
                f"{modality_l}={modality_map.get(gen.modality.value, gen.modality.value)}, "
                f"{region_l}={region_map.get(gen.anatomical_region.value, gen.anatomical_region.value)}. "
                f"{pixels}{doc_note}"
            ),
            cited_finding_ids=[],
        )
        if gen.execution_status == ModelExecutionStatus.UNSUPPORTED:
            if en:
                findings_text = (
                    f"{banner}\n\n"
                    "The automated imaging pipeline is not supported for this case. "
                    "No demo imaging findings were produced for clinical use."
                )
                impression_text = (
                    f"{banner}\n\n"
                    "Impression: the case was routed to manual veterinary radiologist review. "
                    "No automated assessment is provided."
                )
                recs = (
                    "The original imaging study must be reviewed manually by a veterinary radiologist. "
                    "Do not use this draft for clinical decisions."
                )
            else:
                findings_text = (
                    f"{banner}\n\n"
                    "Bu vaka için otomatik görüntüleme hattı desteklenmiyor. "
                    "Klinik kullanım için demo görüntü bulgusu üretilmedi."
                )
                impression_text = (
                    f"{banner}\n\n"
                    "Değerlendirme: vaka manuel veteriner radyolog incelemesine yönlendirildi. "
                    "Otomatik değerlendirme sunulmuyor."
                )
                recs = (
                    "Orijinal görüntüleme çalışması veteriner radyolog tarafından manuel incelenmelidir. "
                    "Bu taslağı klinik kararlar için kullanmayın."
                )
        elif gen.execution_status == ModelExecutionStatus.FAILED:
            if en:
                findings_text = f"{banner}\n\nDemo imaging analysis failed. No imaging findings."
                impression_text = f"{banner}\n\nNo impression could be produced because imaging analysis failed."
                recs = "Re-run analysis after investigating the failure. Specialist review is still required."
            else:
                findings_text = f"{banner}\n\nDemo görüntü analizi başarısız oldu. Görüntüleme bulgusu yok."
                impression_text = f"{banner}\n\nGörüntü analizi başarısız olduğu için değerlendirme üretilemedi."
                recs = "Hatanın nedeni incelendikten sonra analizi yeniden çalıştırın. Uzman incelemesi yine gereklidir."
        elif gen.no_findings_returned or not gen.findings:
            if en:
                findings_text = (
                    f"{banner}\n\n"
                    "Demo imaging analysis returned no findings. "
                    "This does not mean the study is normal."
                )
                impression_text = (
                    f"{banner}\n\n"
                    "Impression: no structured demo findings were returned. "
                    "Absence of disease has not been confirmed."
                )
                recs = (
                    "The entire study must be reviewed by a veterinary radiologist "
                    "before any clinical conclusion."
                )
            else:
                findings_text = (
                    f"{banner}\n\n"
                    "Demo görüntü analizi bulgu döndürmedi. "
                    "Bu, çalışmanın normal olduğu anlamına gelmez."
                )
                impression_text = (
                    f"{banner}\n\n"
                    "Değerlendirme: yapılandırılmış demo bulgu dönmedi. "
                    "Hastalığın olmadığı doğrulanmamıştır."
                )
                recs = "Herhangi bir klinik sonuca varmadan önce çalışmanın tamamı veteriner radyolog tarafından incelenmelidir."
        else:
            status_l = "status" if en else "durum"
            loc_l = "location" if en else "konum"
            bullets = "\n".join(
                f"- [{f.finding_code}] {f.description} "
                f"({status_l}: {status_map.get(f.finding_status.value, f.finding_status.value)}, "
                f"{loc_l}: {f.anatomical_location})"
                for f in gen.findings
            )
            if en:
                findings_text = f"{banner}\n\nReported demo findings:\n{bullets}"
                impression_text = (
                    f"{banner}\n\n"
                    "Impression: the demo findings above are listed only as suspected/uncertain items. "
                    "They must not be transferred into a final clinical report without radiologist review."
                )
                recs = (
                    "1. Veterinary radiologist review of source images (when available).\n"
                    "2. Confirm or reject each cited demo finding.\n"
                    "3. Do not treat unlisted anatomical regions as disease-free."
                )
            else:
                findings_text = f"{banner}\n\nBildirilen demo bulgular:\n{bullets}"
                impression_text = (
                    f"{banner}\n\n"
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
            take = max(1, min(2, len(gen.rag_passages)))
            for idx, p in enumerate(gen.rag_passages[:take]):
                related = [cited[idx % len(cited)]] if cited else []
                used = p.model_copy(update={"related_finding_ids": related})
                used_passages.append(used)
                used_ids.append(p.source_id)
            score_l = "similarity" if en else "benzerlik"
            lines = [
                f"- [{p.source_id}] {p.title} / {p.section} ({score_l}={p.score}): {p.passage[:180]}…"
                if len(p.passage) > 180
                else f"- [{p.source_id}] {p.title} / {p.section} ({score_l}={p.score}): {p.passage}"
                for p in used_passages
            ]
            unused = len(gen.rag_passages) - len(used_passages)
            if en:
                rag_block = (
                    "\n\nDemo RAG context (used passages only — not clinical evidence):\n"
                    + "\n".join(lines)
                )
                if unused:
                    rag_block += f"\n({unused} retrieved passage(s) were not cited in this demo draft.)"
                recs = f"{recs}\n4. Review listed RAG demo passages; do not treat them as proof of findings."
            else:
                rag_block = (
                    "\n\nDemo RAG bağlamı (yalnızca kullanılan pasajlar — klinik kanıt değildir):\n"
                    + "\n".join(lines)
                )
                if unused:
                    rag_block += f"\n(Bulunan {unused} pasaja bu demo taslakta atıf yapılmadı.)"
                recs = f"{recs}\n4. Listelenen RAG demo pasajlarını inceleyin; bulguların kanıtı olarak kabul etmeyin."

        if request.revision is not None:
            if en:
                recs = (
                    f"{recs}\n\nSpecialist revision request received "
                    f"(template draft, model did not rewrite): {request.revision.expert_note}"
                )
            else:
                recs = f"{recs}\n\nUzman revizyon talebi alındı (şablon taslak, model yeniden yazmadı): {request.revision.expert_note}"

        rag_note = (
            "Only RAG passages used by the demo draft are shown "
            "(similarity score is not a clinical confidence level). Not clinical evidence."
            if en
            else (
                "Yalnızca demo taslağın kullandığı RAG pasajları gösterilir "
                "(benzerlik skoru klinik güven düzeyi değildir). Klinik kanıt değildir."
            )
        )

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
            rag_note=rag_note,
        )
        return LLMResponse(
            provider_id=self.provider_id,
            model_id=self.model_id,
            model_version=self.model_version,
            report=report,
            raw_text=None,
        )
