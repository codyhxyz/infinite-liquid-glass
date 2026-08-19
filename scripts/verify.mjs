// Loads the app, collects console/exception output, screenshots, and reports
// live scene state. Exits non-zero if the page logged any error.
import { launch, DEFAULT_URL } from './lib/cdp.mjs'

const url = process.argv[2] ?? DEFAULT_URL
const out = process.argv[3] ?? 'ilg-shot.png'
const wait = Number(process.argv[4] ?? 9000)

const page = await launch({ port: 9333, url, wait })

const probe = await page.evalJs(`(() => {
  const cards = document.querySelectorAll('#overlay .card');
  let visibleCards = 0;
  cards.forEach((c) => { if (c.style.visibility !== 'hidden') visibleCards++; });
  const canvas = document.getElementById('scene');
  return JSON.stringify({
    hud: document.getElementById('hud')?.textContent ?? null,
    cards: cards.length,
    visibleCards,
    canvas: canvas ? canvas.width + 'x' + canvas.height : null,
    loadingGone: !document.getElementById('loading'),
    gpu: !!navigator.gpu,
    title: document.title,
  });
})()`)

await page.screenshot(out)

console.log('=== probe ===')
console.log(probe ?? '(no result)')
console.log('\n=== console (last 25) ===')
console.log(page.logs.slice(-25).join('\n') || '(none)')
console.log('\n=== errors ===')
console.log(page.errors.length ? page.errors.join('\n---\n') : '(none)')
console.log(`\nscreenshot -> ${out}`)

await page.close(page.errors.length ? 2 : 0)
