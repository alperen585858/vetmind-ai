#!/usr/bin/env node
/**
 * Playwright webServer: isolated backend for E2E on any OS (Windows / macOS / Linux / CI).
 *
 * Wipes e2e/.data (fresh sqlite + quarantine each run — stale data was a flaky root cause)
 * and starts uvicorn from backend/.venv with demo or protected settings.
 *
 *   node scripts/e2e-backend.mjs            # demo mode (auth off)
 *   E2E_PROTECTED=1 node scripts/e2e-backend.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const backend = join(root, 'backend')
const data = join(root, 'e2e', '.data')
const isWindows = process.platform === 'win32'
const python = join(backend, '.venv', isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python')
const protectedMode = process.env.E2E_PROTECTED === '1'

if (!existsSync(python)) {
  console.error(`Backend virtualenv not found: ${python}\nCreate it first (README §4.1).`)
  process.exit(1)
}

const sqlite = join(data, protectedMode ? 'e2e-protected.sqlite3' : 'e2e.sqlite3')
const quarantine = join(data, protectedMode ? 'quarantine-protected' : 'quarantine')
rmSync(data, { recursive: true, force: true })
mkdirSync(quarantine, { recursive: true })

const env = {
  ...process.env,
  VETMIND_STORAGE: 'sqlite',
  VETMIND_SQLITE_PATH: sqlite,
  VETMIND_QUARANTINE_ROOT: quarantine,
  VETMIND_AUDIT_LOG_PATH: join(data, 'audit.jsonl'),
  VETMIND_ANALYZE_GATE_PATH: join(data, 'analyze_gate.count'),
  VETMIND_LESSONS_PATH: join(data, 'lessons.json'),
  VETMIND_FEEDBACK_LOG_PATH: join(data, 'feedback.jsonl'),
  VETMIND_AUTH_ENABLED: protectedMode ? '1' : '0',
  VETMIND_DEPLOYMENT_MODE: protectedMode ? 'protected' : 'demo',
  VETMIND_JWT_SECRET: protectedMode ? 'e2e-protected-jwt-secret-min-32-chars!!' : 'vetmind-demo-secret-change-me',
  // Keep delay modest; E2E waits on URL/DOM, not arbitrary sleeps.
  VETMIND_ASYNC_DELAY_MS: '50',
  VETMIND_RAG: 'lexical',
  // E2E must never call a real model, whatever the developer's shell has set.
  VETMIND_LLM_PROVIDER: 'mock',
  VETMIND_RAG_EMBEDDING: 'hash',
}

const child = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'], {
  cwd: backend,
  env,
  stdio: 'inherit',
})
const stop = () => child.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
