/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' shows sample DICOM fixture sets (e2e / local testing only). */
  readonly VITE_ENABLE_DEMO_FIXTURES?: string
}
