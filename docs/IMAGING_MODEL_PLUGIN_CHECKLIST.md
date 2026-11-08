# ImagingModel plug-in checklist (P0.4)

Gemini VLM remains the default real vision path. New adapters must not break it.

## Required

1. Implement `ImagingModel` Protocol (`analyze(case) -> StructuredFindings`) in `backend/app/models/`.
2. Declare `ModelCapability` (modalities, regions, species, input_requirements, `allows_pixel_analysis`).
3. Register via container env flag / `build_optional_*` — no hard-coded exclusive steal of Gemini unless `exclusive_real` is intentional.
4. Set `source_kind` honestly (`real` | `mock` | `synthetic`).
5. Pass registry validation (`validate_registry_capabilities`) and `ModelRegistryEntry.blockers()`.
6. Add a smoke test that registers the adapter and asserts Gemini VLM path still analyzes.

## Forbidden

- Claiming `clinically_validated` or full-study visual coverage without `AnalysisCoverage`.
- Pixel decode without opt-in authorization.
- Silent overwrite of VLM findings without fusion/normalizer rules.
