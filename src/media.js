import {
  TextureLoader, VideoTexture, CanvasTexture, SRGBColorSpace,
  EquirectangularReflectionMapping, LinearFilter, LinearMipmapLinearFilter,
} from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

const MEDIA = '/media/'

async function loadManifest () {
  try {
    const res = await fetch(`${MEDIA}manifest.json`)
    if (!res.ok) throw new Error(String(res.status))
    return await res.json()
  } catch {
    return { env: null, photos: [], videos: [] }
  }
}

function loadImage (url) {
  return new Promise((resolve, reject) => {
    new TextureLoader().load(url, (tex) => {
      tex.colorSpace = SRGBColorSpace
      tex.minFilter = LinearMipmapLinearFilter
      tex.magFilter = LinearFilter
      tex.generateMipmaps = true
      resolve({ texture: tex, width: tex.image.width, height: tex.image.height, video: null })
    }, undefined, reject)
  })
}

/**
 * HLS needs Media Source Extensions everywhere except Safari, which plays
 * .m3u8 natively. hls.js is imported dynamically so it stays out of the main
 * chunk when the manifest has no streams.
 */
async function attachSource (el, url, maxHeight) {
  if (!url.endsWith('.m3u8')) { el.src = url; el.load(); return null }
  // ?forcehls exercises the MSE path on browsers that would play HLS natively.
  const forceMse = new URLSearchParams(location.search).has('forcehls')
  if (!forceMse && el.canPlayType('application/vnd.apple.mpegurl')) { el.src = url; el.load(); return null }

  const { default: Hls } = await import('hls.js')
  if (!Hls.isSupported()) throw new Error(`HLS unsupported: ${url}`)
  const hls = new Hls({ enableWorker: true, lowLatencyMode: false, capLevelToPlayerSize: true })
  hls.loadSource(url)
  hls.attachMedia(el)
  if (Number.isFinite(maxHeight)) {
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const cap = hls.levels.findLastIndex((l) => l.height <= maxHeight)
      if (cap >= 0) hls.autoLevelCapping = cap
    })
  }
  return hls
}

function loadVideo (url, maxHeight) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video')
    el.crossOrigin = 'anonymous'
    el.loop = true
    el.muted = true
    el.defaultMuted = true
    el.playsInline = true
    el.autoplay = true
    el.preload = 'auto'
    const fail = () => reject(new Error(`video failed: ${url}`))
    el.addEventListener('error', fail, { once: true })
    el.addEventListener('loadedmetadata', () => {
      const tex = new VideoTexture(el)
      tex.colorSpace = SRGBColorSpace
      tex.minFilter = LinearFilter
      tex.magFilter = LinearFilter
      tex.generateMipmaps = false
      el.play().catch(() => { /* autoplay blocked; poster frame still renders */ })
      resolve({ texture: tex, width: el.videoWidth, height: el.videoHeight, video: el })
    }, { once: true })
    attachSource(el, url, maxHeight).catch(reject)
  })
}

/** Offline fallback so the demo runs with zero assets. */
function proceduralTexture (index, total) {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 768
  const ctx = c.getContext('2d')
  const hue = (index / Math.max(total, 1)) * 360

  const bg = ctx.createLinearGradient(0, 0, c.width, c.height)
  bg.addColorStop(0, `hsl(${hue}, 70%, 58%)`)
  bg.addColorStop(0.55, `hsl(${(hue + 40) % 360}, 62%, 30%)`)
  bg.addColorStop(1, `hsl(${(hue + 80) % 360}, 55%, 12%)`)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, c.width, c.height)

  // High-frequency detail, so refraction and dispersion have something to bend.
  for (let i = 0; i < 90; i += 1) {
    const t = (i * 9301 + index * 49297) % 233280 / 233280
    const s = (i * 4021 + index * 7919) % 233280 / 233280
    ctx.globalAlpha = 0.06 + s * 0.16
    ctx.fillStyle = i % 3 === 0 ? '#ffffff' : `hsl(${(hue + i * 13) % 360}, 90%, 70%)`
    ctx.fillRect(t * c.width, s * c.height, 6 + s * 120, 3 + t * 26)
  }
  ctx.globalAlpha = 1

  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearMipmapLinearFilter
  tex.magFilter = LinearFilter
  return { texture: tex, width: c.width, height: c.height, video: null }
}

/** Procedural studio env: dark room with a few soft boxes overhead. */
function proceduralEnv () {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 512
  const ctx = c.getContext('2d')

  const bg = ctx.createLinearGradient(0, 0, 0, c.height)
  bg.addColorStop(0, '#6e737d')
  bg.addColorStop(0.45, '#2b2f36')
  bg.addColorStop(0.62, '#15171b')
  bg.addColorStop(1, '#0a0b0d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, c.width, c.height)

  const softbox = (cx, cy, w, h, intensity) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h))
    g.addColorStop(0, `rgba(255,255,255,${intensity})`)
    g.addColorStop(0.4, `rgba(255,255,255,${intensity * 0.45})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(w / Math.max(w, h), h / Math.max(w, h))
    ctx.translate(-cx, -cy)
    ctx.fillRect(cx - w, cy - h, w * 2, h * 2)
    ctx.restore()
  }
  softbox(190, 120, 200, 90, 1.0)
  softbox(600, 95, 250, 70, 0.85)
  softbox(880, 165, 150, 80, 0.6)
  softbox(400, 300, 300, 60, 0.18)

  const tex = new CanvasTexture(c)
  tex.mapping = EquirectangularReflectionMapping
  tex.colorSpace = SRGBColorSpace
  return tex
}

export async function loadEnvironment (manifest) {
  if (!manifest.env) return proceduralEnv()
  try {
    const tex = await new HDRLoader().loadAsync(`${MEDIA}${manifest.env}`)
    tex.mapping = EquirectangularReflectionMapping
    return tex
  } catch {
    return proceduralEnv()
  }
}

/** Absolute URLs (e.g. HLS streams) pass through; bare names resolve to /media. */
const resolveUrl = (name) => (/^(https?:)?\/\//.test(name) ? name : `${MEDIA}${name}`)

export async function loadMedia (tier, onProgress = () => {}) {
  const manifest = await loadManifest()

  const videoNames = manifest.videos.slice(0, Number.isFinite(tier.videoCount) ? tier.videoCount : undefined)
  const jobs = [
    ...videoNames.map((name) => loadVideo(resolveUrl(name), tier.maxVideoHeight)),
    ...manifest.photos.map((name) => loadImage(resolveUrl(name))),
  ]

  let done = 0
  const tracked = jobs.map((j) => j.finally(() => onProgress(++done / jobs.length)))
  const settled = await Promise.allSettled(tracked)
  const items = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value)

  if (items.length === 0) {
    const total = 10
    for (let i = 0; i < total; i += 1) items.push(proceduralTexture(i, total))
  }

  // Interleave clips and stills so motion is spread across the grid rather
  // than clustered in one corner.
  const videos = items.filter((i) => i.video)
  const stills = items.filter((i) => !i.video)
  const mixed = []
  const ratio = stills.length && videos.length ? Math.ceil(stills.length / videos.length) : 0
  let v = 0
  let s = 0
  while (v < videos.length || s < stills.length) {
    if (v < videos.length) mixed.push(videos[v++])
    for (let k = 0; k < ratio && s < stills.length; k += 1) mixed.push(stills[s++])
  }

  return { items: mixed, manifest }
}

/** Videos only report real dimensions once decoding starts. */
export function mediaSize (item) {
  if (item.video) {
    return { width: item.video.videoWidth || item.width, height: item.video.videoHeight || item.height }
  }
  return { width: item.width, height: item.height }
}
