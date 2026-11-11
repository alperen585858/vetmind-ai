#!/usr/bin/env node
/**
 * Cross-platform launcher for the backend npm scripts.
 *
 * The scripts used to be `cd backend && VAR=x .venv/bin/uvicorn …`, which only works in a
 * POSIX shell: Windows has neither `VAR=x cmd` nor `.venv/bin`. This sets the same env
 * vars and runs the venv's Python on every OS.
 *
 *   node scripts/backend.mjs dev | ai | vision | test [extra args…]
 *
 * Extra args are passed through, e.g. `npm run backend:test -- -k classifier`.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const backend = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend')
const isWindows = process.platform === 'win32'
const python = join(backend, '.venv', isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python')

const UVICORN = ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000']
const AI_ENV = {
  VETMIND_LLM_PROVIDER: 'ollama',
  VETMIND_LLM_MODEL_ID: 'qwen2.5:7b',
  VETMIND_LLM_TIMEOUT_S: '600',
  VETMIND_LLM_VERIFY: 'false',
  // Semantic RAG (needs `ollama pull bge-m3`; falls back to hash embeddings if missing).
  VETMIND_RAG_EMBEDDING: 'ollama',
}
const VISION_ENV = {
  ...AI_ENV,
  VETMIND_PIXEL_ANALYSIS_OPT_IN: 'true',
  VETMIND_LOCAL_TORCH_MODEL_ID: 'vet-xr-thorax-v1',
  VETMIND_LOCAL_TORCH_ENTRYPOINT: 'app.models.entrypoints.xray_monai:build_entrypoint',
  VETMIND_LOCAL_TORCH_WEIGHTS_PATH: '../artifacts/vet-xr-thorax-v1/model.pt',
  VETMIND_LOCAL_TORCH_MODALITIES: 'XR',
  VETMIND_LOCAL_TORCH_REGIONS: 'THORAX',
  VETMIND_LOCAL_TORCH_MODEL_VERSION: '0.1.0-txrv-human',
}

const MODES = {
  dev: { env: {}, args: UVICORN },
  ai: { env: AI_ENV, args: UVICORN },
  vision: { env: VISION_ENV, args: [...UVICORN, '--reload-dir', 'app'] },
  test: { env: {}, args: ['-m', 'pytest', '-q'] },
}

const [mode, ...extra] = process.argv.slice(2)
const spec = MODES[mode]
if (!spec) {
  console.error(`Usage: node scripts/backend.mjs ${Object.keys(MODES).join(' | ')} [args…]`)
  process.exit(2)
}
if (!existsSync(python)) {
  console.error(`Backend virtualenv not found: ${python}\nCreate it first (README §4.1).`)
  process.exit(1)
}

const child = spawn(python, [...spec.args, ...extra], {
  cwd: backend,
  env: { ...process.env, ...spec.env },
  stdio: 'inherit',
})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
