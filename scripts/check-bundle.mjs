#!/usr/bin/env node
/**
 * First-load bundle budget (issue #25). Run after `vite build`:
 *
 *   node scripts/check-bundle.mjs [distDir]
 *
 * Sums the gzip size of every JS file index.html loads up front (entry script plus
 * modulepreload links) and fails if it exceeds the budget. Lazy page chunks are not counted.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_GZIP_KB = Number(process.env.VETMIND_FIRST_LOAD_BUDGET_KB || 160)
// Charts are heavy and only used by two pages; they must never load on first visit.
const FORBIDDEN_UP_FRONT = [/\/charts-[^/]+\.js$/]

const dist = process.argv[2] || 'dist'
const htmlPath = join(dist, 'index.html')
if (!existsSync(htmlPath)) {
  console.error(`check-bundle: ${htmlPath} not found. Run "vite build" first.`)
  process.exit(2)
}

const html = readFileSync(htmlPath, 'utf8')
const files = [
  ...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g),
].map((m) => m[1])

let total = 0
const rows = []
for (const href of new Set(files)) {
  const bytes = readFileSync(join(dist, href.replace(/^\//, '')))
  const gz = gzipSync(bytes).length
  total += gz
  rows.push([href, bytes.length, gz])
}

for (const [href, raw, gz] of rows) {
  console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB gzip  ${(raw / 1024).toFixed(1).padStart(8)} KB  ${href}`)
}
const totalKb = total / 1024
console.log(`first load: ${totalKb.toFixed(1)} KB gzip (budget ${BUDGET_GZIP_KB} KB)`)

const forbidden = rows.filter(([href]) => FORBIDDEN_UP_FRONT.some((re) => re.test(href)))
if (forbidden.length) {
  console.error(`check-bundle: heavy chunk loaded up front: ${forbidden.map((r) => r[0]).join(', ')}`)
  process.exit(1)
}
if (totalKb > BUDGET_GZIP_KB) {
  console.error('check-bundle: first-load JavaScript is over budget. Lazy-load the new import (src/lib/lazyPage.ts) or move it out of the entry.')
  process.exit(1)
}
