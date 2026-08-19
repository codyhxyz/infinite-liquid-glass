// Drives a real pointer drag through CDP and checks that the grid actually
// scrolls and wraps -- the "infinite" claim is the one worth testing.
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.argv[2] ?? 'http://127.0.0.1:5178/'
const PORT = 9334
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = await mkdtemp(join(tmpdir(), 'ilg-drag-'))

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,900', '--window-position=40,40', 'about:blank',
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

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_ })
await new Promise((r) => setTimeout(r, 8000))

// Sample a tile's world transform before and after the drag.
const sample = () => evalJs(`(() => {
  const c = [...document.querySelectorAll('#overlay .card')].filter(e => e.style.visibility !== 'hidden');
  return JSON.stringify(c.slice(0, 3).map(e => e.style.transform.slice(-90)));
})()`)

const before = await sample()
const restZ = await evalJs('window.__ilg ? +window.__ilg.camera.position.z.toFixed(1) : null')

// Real pointer drag: down, 24 moves, up.
const y0 = 450
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1100, y: y0, button: 'left', clickCount: 1, buttons: 1 })
for (let i = 1; i <= 24; i += 1) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1100 - i * 30, y: y0 - i * 8, button: 'left', buttons: 1 })
  await new Promise((r) => setTimeout(r, 12))
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1100 - 24 * 30, y: y0 - 24 * 8, button: 'left', buttons: 0 })
// Sample the dolly while the fling is still decaying.
let peakZ = restZ, peakSpeed = 0
for (let i = 0; i < 14; i += 1) {
  const s = await evalJs('window.__ilg ? JSON.stringify([+window.__ilg.camera.position.z.toFixed(1), +window.__ilg.controls.speed.value.toFixed(1)]) : null')
  if (s) { const [z, v] = JSON.parse(s); if (z > peakZ) peakZ = z; if (v > peakSpeed) peakSpeed = v }
  await new Promise((r) => setTimeout(r, 40))
}
await new Promise((r) => setTimeout(r, 2500))
const settledZ = await evalJs('window.__ilg ? +window.__ilg.camera.position.z.toFixed(1) : null')
console.log(`dolly: rest z=${restZ} -> peak z=${peakZ} (peak speed ${peakSpeed}) -> settled z=${settledZ}`)
console.log('dolly works:', peakZ > restZ + 1 && Math.abs(settledZ - restZ) < 2 ? 'YES' : 'NO')

const after = await sample()
const hud = await evalJs(`document.getElementById('hud').textContent`)

// Long-haul: jump the scroll far past several periods and confirm it wraps
// rather than drifting off into nothing.
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1200, y: 500, button: 'left', clickCount: 1, buttons: 1 })
for (let i = 1; i <= 60; i += 1) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1200 - i * 60, y: 500, button: 'left', buttons: 1 })
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1200 - 60 * 60, y: 500, button: 'left', buttons: 0 })
await new Promise((r) => setTimeout(r, 3000))

const far = await evalJs(`(() => {
  const c = [...document.querySelectorAll('#overlay .card')];
  const vis = c.filter(e => e.style.visibility !== 'hidden').length;
  return JSON.stringify({ visibleCards: vis, hud: document.getElementById('hud').textContent });
})()`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) await writeFile('/tmp/ilg-dragged.png', Buffer.from(shot.result.data, 'base64'))

console.log('before drag:', before)
console.log('after drag: ', after)
console.log('moved:', before !== after ? 'YES' : 'NO -- grid did not respond')
console.log('hud after drag:', hud)
console.log('after long haul:', far)
console.log('exceptions:', errors.length ? errors.join('\n') : '(none)')

ws.close()
await cleanup(before !== after && errors.length === 0 ? 0 : 2)
