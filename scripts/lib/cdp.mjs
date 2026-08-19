// Shared Chrome/CDP harness. Every script under scripts/ drives the app the
// same way -- launch a throwaway browser, talk to it over CDP, and always kill
// it on exit, because the page autoplays video and an orphaned tab burns
// battery indefinitely.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_URL = process.env.ILG_URL ?? 'http://127.0.0.1:5178/'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
]

export function findChrome () {
  const hit = CHROME_CANDIDATES.filter(Boolean).find((p) => existsSync(p))
  if (hit) return hit
  throw new Error('no Chrome or Chromium found -- set CHROME_PATH to a binary')
}

/**
 * Launch Chrome and attach to its page target.
 *
 * Headless by default. A visible window lets the operator's real cursor deliver
 * pointermove, blur and focus events that race the synthetic ones, which shows
 * up as a test that flaps rather than as the harness bug it is. Set HEADFUL=1
 * when you actually want to watch it. Headless still gets a real WebGPU
 * adapter, so the app runs its normal path either way.
 */
export async function launch ({
  port = 9333,
  url = DEFAULT_URL,
  wait = 9000,
  viewport = { width: 1440, height: 900 },
  headless = process.env.HEADFUL !== '1',
} = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'ilg-'))
  const chrome = spawn(findChrome(), [
    ...(headless ? ['--headless=new'] : ['--window-position=40,40']),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--enable-unsafe-webgpu',
    // ANGLE backend is platform-specific; letting Chrome pick is wrong on macOS
    // headless, where it otherwise falls back to a software adapter.
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--enable-features=Vulkan']),
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${viewport.width},${viewport.height}`,
    'about:blank',
  ], { stdio: 'ignore' })

  let cleaned = false
  const close = async (code) => {
    if (cleaned) return
    cleaned = true
    try { chrome.kill('SIGTERM') } catch {}
    await new Promise((r) => setTimeout(r, 500))
    try { chrome.kill('SIGKILL') } catch {}
    await rm(profile, { recursive: true, force: true }).catch(() => {})
    if (code !== undefined) process.exit(code)
  }
  process.on('SIGINT', () => close(130))
  process.on('SIGTERM', () => close(143))
  process.on('uncaughtException', async (e) => { console.error('harness error:', e.message); await close(1) })

  // Chrome takes a moment to open the debugging port; poll rather than sleep.
  let targets
  for (let i = 0; i < 60 && !targets?.length; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (res.ok) targets = await res.json()
    } catch {}
    if (!targets?.length) await new Promise((r) => setTimeout(r, 250))
  }
  if (!targets?.length) { await close(); throw new Error('CDP never came up') }

  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
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
  // Pin the viewport rather than the window: --window-size is the outer window,
  // and browser chrome eats ~145px of it, so probe coordinates would otherwise
  // mean something different headful vs headless.
  await send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, ...viewport, mobile: false })
  await send('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, wait))

  const evalJs = async (expression, opts = {}) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, ...opts })).result?.result?.value

  const screenshot = async (path, params = {}) => {
    const shot = await send('Page.captureScreenshot', { format: 'png', ...params })
    if (!shot.result?.data) return false
    await writeFile(path, Buffer.from(shot.result.data, 'base64'))
    return true
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  /**
   * Hold the cursor at a point while springs settle. One dispatch followed by a
   * wait is not enough headful -- the physical cursor wins the race.
   */
  const hover = async (x, y, ms = 900) => {
    const step = 80
    for (let i = 0; i < Math.ceil(ms / step); i += 1) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await sleep(step)
    }
  }

  const drag = async (from, to, steps = 24) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1, buttons: 1 })
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      })
      await sleep(12)
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0 })
  }

  return { send, evalJs, screenshot, hover, drag, sleep, logs, errors, close, viewport }
}
