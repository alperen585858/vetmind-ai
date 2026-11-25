# Phase 8 — AI Model Integration Readiness

Infrastructure for future real Vision AI. **No model is installed, trained, or connected by default.**

## Plug in a real model later

### A. Remote HTTP (preferred)

1. Implement a service that accepts VetMind’s POST body (`ImagingModelInput` + routing fields) and returns findings (see `HttpRemoteVisionModel` / `RemoteVisionResponse`) or `ModelTaskOutputs` mapped via `map_task_outputs_to_findings`.
2. Set `VETMIND_VISION_ENDPOINT` + explicit `VETMIND_VISION_MODALITIES` / `REGIONS` (and optional species, version, key).
3. Restart API. Registry validation fails fast if the capability id has no adapter.
4. Keep `allows_pixel_analysis=False` until pixel auth + a `PreprocessingContract` are production-ready.

### B. Local PyTorch

1. Use `LocalTorchVisionAdapter` + `LocalTorchConfig` (`weights_path`, `entrypoint`, `device`).
2. Register the adapter in `AppContainer` with a matching `ModelCapability` (`adapter_kind=local_torch`, modalities/regions/species, `task_capabilities`, `input_requirements`).
3. Implement weight load inside the entrypoint; do not call `torch` at import time.
4. For pixel models: set `allows_pixel_analysis=True`, `input_requirements` including `pixels_2d` / `pixels_3d`, and wire `AuthorizedDicomDecoder` → `SliceOrderedVolumeAssembler` → `ContractImagePreprocessor` behind authorization. Unsupported inputs route to `manual-review`.

### C. Contracts to honor

| Layer | Module |
|-------|--------|
| Input | `ImagingModelInput` |
| Task outputs | `ModelTaskOutputs` (classification / detection / segmentation / measurements) |
| Review pipeline | `StructuredFindings` |
| Prep | `PreprocessingContract`, `pixel_2d_contract` / `pixel_3d_contract` |
| Auth | `evaluate_pixel_access` (default-deny) |
| Inventory | `GET /api/v1/models/readiness` |

### D. Verify without clinical models

- `SyntheticContractSimulator` (`synthetic-contract-sim-v1`) — disabled for routing; use for contract probes.
- Always preserve MOCK/REAL provenance; never silent mock fallback on REAL failure.

## Non-claims

Not clinically validated. Pixel path remains default-deny. `source_kind=real` ≠ clinical validation.
