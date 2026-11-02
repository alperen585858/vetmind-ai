# Dataset governance

Place dataset manifests here (JSON/CSV). Do **not** commit PHI or raw DICOM.

Each dataset should include:

- license / DUA reference
- species, modality, region
- annotation ontology version (align with finding codes)
- patient-level split files (`splits/{train,val,test}.json`)
- exclusion criteria

Example stub: `manifest.example.json`.
