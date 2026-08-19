// Launches a throwaway Chrome, loads the app, collects console/exception
// output, and screenshots. Always kills the browser it launched -- this page
// autoplays video, so an orphaned tab would sit there burning battery.
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.argv[2] ?? 'http://127.0.0.1:5178/'
const OUT = process.argv[3] ?? '/tmp/ilg-shot.png'
const WAIT_MS = Number(process.argv[4] ?? 9000)
const PORT = 9333

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = await mkdtemp(join(tmpdir(), 'ilg-verify-'))

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,900', '--window-position=40,40',
  'about:blank',
], { stdio: 'ignore', detached: false })

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
process.on('SIGTERM', () => cleanup(143))
process.on('uncaughtException', async (e) => { console.error('harness error:', e.message); await cleanup(1) })

async function cdpTargets () {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (res.ok) { const list = await res.json(); if (list.length) return list }
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('CDP never came up')
}

const pageTarget = (await cdpTargets()).find((t) => t.type === 'page')
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let msgId = 0
const pending = new Map()
const logs = []
const errors = []

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ')
    logs.push(`[${m.params.type}] ${text}`)
    if (m.params.type === 'error') errors.push(text)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    errors.push(d.exception?.description ?? d.text)
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push(`${m.params.entry.source}: ${m.params.entry.text}`)
  }
}

const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_ })
await new Promise((r) => setTimeout(r, WAIT_MS))

// Probe live state from inside the page.
const probe = await send('Runtime.evaluate', {
  expression: `(() => {
    const hud = document.getElementById('hud');
    const cards = document.querySelectorAll('#overlay .card');
    let visibleCards = 0;
    cards.forEach(c => { if (c.style.visibility !== 'hidden') visibleCards++; });
    const canvas = document.getElementById('scene');
    return JSON.stringify({
      hud: hud ? hud.textContent : null,
      cards: cards.length,
      visibleCards,
      canvas: canvas ? canvas.width + 'x' + canvas.height : null,
      loadingGone: !document.getElementById('loading'),
      gpu: !!navigator.gpu,
      title: document.title,
    });
  })()`,
  returnByValue: true,
})

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) await writeFile(OUT, Buffer.from(shot.result.data, 'base64'))

console.log('=== probe ===')
console.log(probe.result?.result?.value ?? JSON.stringify(probe).slice(0, 500))
console.log('\n=== console (last 25) ===')
console.log(logs.slice(-25).join('\n') || '(none)')
console.log('\n=== errors ===')
console.log(errors.length ? errors.join('\n---\n') : '(none)')
console.log(`\nscreenshot -> ${OUT}`)

ws.close()
await cleanup(errors.length ? 2 : 0)
