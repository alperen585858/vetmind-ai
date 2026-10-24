// dist-share çıktısını tek bir, kendi kendine yeten HTML dosyasına (share/vetmind-ai.html) gömer.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const html = readFileSync('dist-share/index.html', 'utf8')
const js = html.match(/src="\.?\/?(assets\/[^"]+\.js)"/)[1]
const css = html.match(/href="\.?\/?(assets\/[^"]+\.css)"/)[1]
const code = readFileSync(`dist-share/${js}`, 'utf8').replace(/<\/script/gi, '<\\/script')
const style = readFileSync(`dist-share/${css}`, 'utf8')

const out = `<title>VetMind AI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>${style}</style>
<div id="root"></div>
<script type="module">${code}</script>
`
mkdirSync('share', { recursive: true })
writeFileSync('share/vetmind-ai.html', out)
console.log(`share/vetmind-ai.html yazıldı (${(out.length / 1024).toFixed(0)} KB)`)
