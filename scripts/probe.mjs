// Evaluates an arbitrary expression in the app page and prints the result.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.ILG_URL ?? 'http://127.0.0.1:5178/'
const EXPR = process.argv[2]
const WAIT = Number(process.argv[3] ?? 8000)
const PORT = 9335
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = await mkdtemp(join(tmpdir(), 'ilg-probe-'))

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
  await new Promise((r) => setTimeout(r, 400))
  try { chrome.kill('SIGKILL') } catch {}
  await rm(profile, { recursive: true, force: true }).catch(() => {})
  if (code !== undefined) process.exit(code)
}
process.on('SIGINT', () => cleanup(130))
process.on('uncaughtException', async (e) => { console.error('harness:', e.message); await cleanup(1) })

async function targets () {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) { const l = await r.json(); if (l.length) return l } } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('no CDP')
}
const t = (await targets()).find((x) => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_ })
await new Promise((r) => setTimeout(r, WAIT))

const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true })
console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2))

ws.close()
await cleanup(0)
