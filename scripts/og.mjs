// Regenerates public/og.png, the 1200x630 link-preview card. Same recipe as
// hero.mjs: wait for the clips to play, nudge off-centre, hide the debug chrome.
import { launch, DEFAULT_URL } from './lib/cdp.mjs'

const out = process.argv[2] ?? 'public/og.png'

const page = await launch({
  port: 9338,
  url: DEFAULT_URL,
  wait: 12000,
  viewport: { width: 1200, height: 630, deviceScaleFactor: 1 },
})

await page.evalJs(`(() => {
  window.__ilg.controls.scrollX.jump(-140);
  window.__ilg.controls.scrollY.jump(-90);
  document.getElementById('hud').style.display = 'none';
  document.getElementById('legend').style.display = 'none';
})()`)
await page.sleep(1500)

const playing = await page.evalJs(`window.__ilg.items.filter((i) => i.video && !i.video.paused).length`)
await page.screenshot(out, { format: 'png' })

console.log(`${playing} clips playing`)
console.log(`og -> ${out}`)
await page.close(0)
