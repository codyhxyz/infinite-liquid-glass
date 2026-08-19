// Checks that pointer movement tilts *individual tiles at their edges* and no
// longer tilts the whole scene. Three claims worth testing:
//   1. the camera never orbits off-axis, whatever the pointer does
//   2. a tile is flat at its own centre and banked near its own edge
//   3. the response is local -- a tile well away from the cursor stays flat
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.argv[2] ?? 'http://127.0.0.1:5178/'
const PORT = 9335
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = await mkdtemp(join(tmpdir(), 'ilg-tilt-'))

// Headless on purpose, unlike the other harnesses. Everything measured here is
// input maths, and a real window means the operator's physical cursor delivers
// pointermove and blur events that fight the synthetic ones mid-measurement --
// which reads as a flapping result rather than the harness bug it is. Headless
// still gets a real WebGPU adapter, so the app runs its actual path.
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--enable-unsafe-webgpu', '--use-angle=metal',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })

let cleaned = false
async function cleanup (code) {
  if (cleaned) return
  cleaned = true
  try { chrome.kill('SIGTERM') } catch {}
  await new Promise((r) => setTimeout(r, 500))
  try { chrome.kill('SIGKILL') } catch {}
  await rm(profile, { recursive: true, force: true }).catch(() => {})
  if (code !== undefined) process.exit(code)
}
process.on('SIGINT', () => cleanup(130))
process.on('uncaughtException', async (e) => { console.error('harness error:', e.message); await cleanup(1) })

async function targets () {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (r.ok) { const l = await r.json(); if (l.length) return l }
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('CDP never came up')
}

const t = (await targets()).find((x) => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

await send('Runtime.enable')
await send('Page.enable')
// Pin the *viewport* rather than the window, so probe coordinates mean the same
// thing regardless of how much vertical space the browser chrome is taking.
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: URL_ })
await new Promise((r) => setTimeout(r, 8000))

// The overlay cards are 1:1 with meshes and carry the tile's real screen box,
// so they are the cheapest way to find "where is tile N on screen".
const boxes = JSON.parse(await evalJs(`(() => {
  const stage = document.querySelector('#overlay .overlay-stage');
  const all = [...stage.children];
  return JSON.stringify(all.map((e, i) => {
    if (e.style.visibility === 'hidden') return null;
    const r = e.getBoundingClientRect();
    return { i, cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height };
  }).filter(Boolean));
})()`))

// Must come from the page: --window-size is the *outer* window, and Chrome's
// tab strip and omnibox take ~145px off the top. Probing past the real viewport
// bottom fires pointerleave and every tile relaxes mid-measurement.
const [vw, vh] = JSON.parse(await evalJs('JSON.stringify([innerWidth, innerHeight])'))
console.log(`viewport ${vw}x${vh}`)
// Nearest fully on-screen tile to the viewport centre: the least foreshortened
// one, so the numbers are easiest to reason about.
const target = boxes
  .filter((b) => b.cx - b.w / 2 > 0 && b.cx + b.w / 2 < vw && b.cy - b.h / 2 > 0 && b.cy + b.h / 2 < vh)
  .sort((a, b) => Math.hypot(a.cx - vw / 2, a.cy - vh / 2) - Math.hypot(b.cx - vw / 2, b.cy - vh / 2))[0]
if (!target) throw new Error('no fully on-screen tile to probe')


const sample = async (label, rawX, rawY) => {
  const x = clamp(rawX, 2, vw - 2)
  const y = clamp(rawY, 2, vh - 2)
  // Hold the cursor there while the springs settle. A single dispatch followed
  // by a wait is not enough: this is a headful Chrome on a real desktop, and
  // the physical cursor (or a focus change) will otherwise win the race and
  // clear `pointer.active` before we read it.
  for (let i = 0; i < 12; i += 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await new Promise((r) => setTimeout(r, 80))
  }
  const raw = await evalJs(`(() => {
    const g = window.__ilg; if (!g) return null;
    const t = g.tilts[${target.i}];
    // How many tiles are moving at all -- the whole point of the design is that
    // this is never more than one.
    const moving = g.tilts.filter((x) => x.hover.value > 0.02 ||
      Math.abs(x.rx.value) > 0.005 || Math.abs(x.ry.value) > 0.005).length;
    return JSON.stringify({
      camX: +g.camera.position.x.toFixed(3),
      camY: +g.camera.position.y.toFixed(3),
      rx: +t.rx.value.toFixed(4), ry: +t.ry.value.toFixed(4), hover: +t.hover.value.toFixed(3),
      moving, hovered: g.hovered,
    });
  })()`)
  const s = JSON.parse(raw)
  console.log(`${label.padEnd(18)} cam=(${s.camX},${s.camY})  rx=${String(s.rx).padStart(7)}  ry=${String(s.ry).padStart(7)}  hover=${s.hover}  moving=${s.moving}  hovered=#${s.hovered}`)
  return s
}

console.log(`probing tile #${target.i} at (${Math.round(target.cx)},${Math.round(target.cy)}) size ${Math.round(target.w)}x${Math.round(target.h)}\n`)

const centre = await sample('centre', target.cx, target.cy)
const right = await sample('right edge', target.cx + target.w * 0.42, target.cy)
const left = await sample('left edge', target.cx - target.w * 0.42, target.cy)
const top = await sample('top edge', target.cx, target.cy - target.h * 0.42)
const bottom = await sample('bottom edge', target.cx, target.cy + target.h * 0.42)
const away = await sample('cursor to corner', 8, 8)

// And the explicit relax path: losing the window drops every tile flat.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.cx, y: target.cy })
await new Promise((r) => setTimeout(r, 400))
await evalJs('window.dispatchEvent(new Event("blur"))')
await new Promise((r) => setTimeout(r, 900))
const blurred = JSON.parse(await evalJs(`(() => {
  const g = window.__ilg, t = g.tilts[${target.i}];
  return JSON.stringify({ hover: +t.hover.value.toFixed(3), active: g.controls.pointer.active });
})()`))
console.log(`after blur         hover=${blurred.hover}  pointerActive=${blurred.active}`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) await writeFile('/tmp/ilg-tilt.png', Buffer.from(shot.result.data, 'base64'))

const camStill = [centre, right, left, top, bottom, away].every((s) => s.camX === 0 && s.camY === 0)
const flatAtCentre = Math.abs(centre.rx) < 0.01 && Math.abs(centre.ry) < 0.01
const liftsOnHover = centre.hover > 0.9
const banksAtEdges = right.ry < -0.05 && left.ry > 0.05 && top.rx > 0.05 && bottom.rx < -0.05
const oneAtATime = [centre, right, left, top, bottom].every((s) => s.moving <= 1 && s.hovered === target.i)
const relaxes = Math.abs(away.rx) < 0.01 && Math.abs(away.ry) < 0.01 && away.hover < 0.05 &&
                blurred.hover < 0.05 && blurred.active === false

console.log('')
console.log('camera never orbits:        ', camStill ? 'YES' : 'NO')
console.log('flat at tile centre:        ', flatAtCentre ? 'YES' : 'NO')
console.log('lifts while hovered:        ', liftsOnHover ? 'YES' : 'NO')
console.log('banks at all four edges:    ', banksAtEdges ? 'YES' : 'NO')
console.log('exactly one tile moves:     ', oneAtATime ? 'YES' : 'NO')
console.log('relaxes when pointer leaves:', relaxes ? 'YES' : 'NO')
console.log('exceptions:', errors.length ? errors.join('\n') : '(none)')

await cleanup(camStill && flatAtCentre && liftsOnHover && banksAtEdges && oneAtATime && relaxes ? 0 : 1)
