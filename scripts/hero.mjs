// Regenerates the README hero image. Captured at 2x with the HUD and legend
// hidden, after the intro spring has settled and the clips are actually
// playing -- a shot taken too early gets first frames, which are mostly black.
import { launch, DEFAULT_URL } from './lib/cdp.mjs'

const out = process.argv[2] ?? 'docs/hero.jpg'

const page = await launch({
  port: 9337,
  url: DEFAULT_URL,
  wait: 12000,
  viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
})

// Nudge off the default alignment so the grid reads as infinite rather than as
// a neatly centred 3x2, and hide the debug chrome.
await page.evalJs(`(() => {
  window.__ilg.controls.scrollX.jump(-140);
  window.__ilg.controls.scrollY.jump(-90);
  document.getElementById('hud').style.display = 'none';
  document.getElementById('legend').style.display = 'none';
})()`)
await page.sleep(1500)

const playing = await page.evalJs(`window.__ilg.items.filter((i) => i.video && !i.video.paused).length`)
await page.screenshot(out, { format: 'jpeg', quality: 92 })

console.log(`${playing} clips playing`)
console.log(`hero -> ${out}`)
await page.close(0)
