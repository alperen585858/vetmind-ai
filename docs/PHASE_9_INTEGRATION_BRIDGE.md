# Phase 9 — AI Integration Bridge

Plug-and-play bridge from DICOM → authorized prep → Vision entrypoint → structured results.  
**No real model is downloaded, trained, loaded, or connected by default.**

## What was added

| Piece | Role |
|-------|------|
| `VisionEntrypoint` / `LocalTorchEntrypoint` / `HttpVisionEntrypoint` | Load + infer contracts |
| `AuthorizedPixelBridge` + modality profiles (MRI / CT / XR) | Pixel prep only after auth |
| `IntegrationBridge` | Prep → infer → `StructuredFindings` / `ModelTaskOutputs` mapping |
| Typed errors | unavailable / incompatible / timeout / failure — **no mock fallback** |
| Resource limits | `VETMIND_VISION_MAX_INSTANCES`, `MAX_TENSOR_BYTES`, `TRANSMIT_PIXELS` (default false) |
| Temp artifacts | `ArtifactWorkspace` always cleaned after analyze |
| Synthetic E2E | `run_synthetic_bridge_e2e()` via `SyntheticBridgeEntrypoint` |

Default case path remains **metadata-only**. Pixel decode stays **default-deny**.

## Connect a real X-ray / MRI / CT model

### Shared steps

1. Implement a `VisionEntrypoint` (`load` / `is_ready` / `infer`) returning `ModelTaskOutputs` or `StructuredFindings`. Do **not** invent confidence or clinical certainty when the model omits them.
2. Register an `ImagingModel` adapter (local or HTTP) with a matching `ModelCapability`: modalities, regions, species, `allows_pixel_analysis`, `input_requirements` (`pixels_2d` or `pixels_3d`), timeouts.
3. Grant pixel auth only when intentional: classification confirmed + source permission + analysis consent + non-mock capability with `allows_pixel_analysis=True`.
4. Keep expert review / report validation gates. `source_kind=real` ≠ clinical validation.

### X-ray (2D)

1. Use `xray_2d_profile(model_id)` (or `profile_for_modality(XR, …)`).
2. Provide explicit WW/WC to the bridge (`window_center` / `window_width`) — no silent presets.
3. Local: `LocalTorchConfig(requires_pixels=True, entrypoint="your.module:factory", weights_path=…)` wired with quarantine + `ResourceLimits`.
4. Remote: `build_http_vision_entrypoint(endpoint=…)` — pixels **not** sent unless `VETMIND_VISION_TRANSMIT_PIXELS=1` **and** bridge `transmit_pixels=True` (still blocked unless you extend the HTTP payload intentionally).

### MRI (3D)

1. Use `mri_volume_profile` (slice order + spacing + normalize → DHW). No HU window.
2. Ensure series frames carry `ImagePositionPatient` / `InstanceNumber` for ordering.
3. Set `input_requirements={pixels_3d}` and register under MR + region (e.g. BRAIN / CERVICAL).

### CT (3D)

1. Use `ct_volume_profile` (includes `hu_window`).
2. **Required:** pass explicit `window_center` / `window_width` per deployment/protocol.
3. Same auth + registry steps as MRI.

### Failure behavior (must keep)

| Condition | Result |
|-----------|--------|
| Missing weights / endpoint | `ModelUnavailableError` → job failed / no mock draft |
| Auth or profile mismatch | `IncompatibleInputError` → router may already send `manual-review` |
| Timeout | `InferenceTimeoutError` → job `timed_out` |
| Infer crash / bad payload | `InferenceFailedError` → failed, findings not fabricated |

## Verify without clinical models

```bash
cd backend && pytest -q tests/test_phase9_integration_bridge.py
```

Or call `run_synthetic_bridge_e2e(modality=Modality.XR|MR|CT)` in a scratch script.

## Non-claims

Not clinically validated. Pixel egress and inference remain off by default. Expert review required.
