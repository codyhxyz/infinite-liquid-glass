// Drives a pointer drag and checks that the grid actually scrolls and wraps --
// the "infinite" claim is the one worth testing -- plus that the speed-driven
// dolly fires and returns to rest.
import { launch, DEFAULT_URL } from './lib/cdp.mjs'

const page = await launch({ port: 9335, url: DEFAULT_URL, wait: 9000 })

// A tile's transform is the cheapest proof that the grid moved.
const sample = () => page.evalJs(`(() => {
  const c = [...document.querySelectorAll('#overlay .card')].filter((e) => e.style.visibility !== 'hidden');
  return JSON.stringify(c.slice(0, 3).map((e) => e.style.transform.slice(-90)));
})()`)
const cameraZ = () => page.evalJs('+window.__ilg.camera.position.z.toFixed(1)')
const scroll = () => page.evalJs('JSON.stringify([+window.__ilg.controls.scrollX.value.toFixed(1), +window.__ilg.controls.scrollY.value.toFixed(1)])')

const before = await sample()
const restZ = await cameraZ()

await page.drag({ x: 1100, y: 450 }, { x: 380, y: 258 })

// Sample the dolly while the fling is still decaying.
let peakZ = restZ
for (let i = 0; i < 16; i += 1) {
  const z = await cameraZ()
  if (z > peakZ) peakZ = z
  await page.sleep(40)
}
await page.sleep(2500)
const settledZ = await cameraZ()
const after = await sample()
const scrolled = await scroll()

// Long haul: jump the scroll far past several periods and confirm it wraps
// rather than drifting off into nothing.
await page.drag({ x: 1200, y: 500 }, { x: -2400, y: 500 }, 60)
await page.sleep(3000)
const far = await page.evalJs(`(() => {
  const c = [...document.querySelectorAll('#overlay .card')];
  return JSON.stringify({
    visibleCards: c.filter((e) => e.style.visibility !== 'hidden').length,
    hud: document.getElementById('hud').textContent,
  });
})()`)

await page.screenshot('ilg-dragged.png')

const moved = before !== after
const dolly = peakZ > restZ + 1 && Math.abs(settledZ - restZ) < 2
const wraps = JSON.parse(far).visibleCards > 0

console.log(`scroll after drag: ${scrolled}`)
console.log(`dolly: rest z=${restZ} -> peak z=${peakZ} -> settled z=${settledZ}`)
console.log(`after long haul: ${far}`)
console.log('')
console.log('grid scrolled:            ', moved ? 'YES' : 'NO')
console.log('dolly fired and returned: ', dolly ? 'YES' : 'NO')
console.log('still populated after haul:', wraps ? 'YES' : 'NO')
console.log('exceptions:', page.errors.length ? page.errors.join('\n') : '(none)')

await page.close(moved && dolly && wraps && !page.errors.length ? 0 : 1)
