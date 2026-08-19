// Downloads the demo assets: the Poly Haven studio HDRI (the same one the
// original uses for its default env preset), a set of CC0 photos, and a few
// small mp4s. Everything is optional -- the app falls back to procedurally
// generated textures for anything that is missing.
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mediaDir = join(root, 'public', 'media')

const PHOTO_COUNT = 12
const PHOTO_SEEDS = [
  'aurora', 'harbor', 'monolith', 'pergola', 'saltflat', 'tramline',
  'quarry', 'nocturne', 'vellum', 'basalt', 'kelpwood', 'stratus',
]

const VIDEOS = [
  ['clip-01.mp4', 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_2MB.mp4'],
  ['clip-02.mp4', 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_2MB.mp4'],
  ['clip-03.mp4', 'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_2MB.mp4'],
  ['clip-04.mp4', 'https://test-videos.co.uk/vids/tearsofsteel/mp4/h264/360/Tears_of_Steel_360_10s_2MB.mp4'],
]

const HDRI = ['studio_small_03_1k.hdr', 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr']

async function exists (path) {
  try { const s = await stat(path); return s.size > 0 } catch { return false }
}

async function grab (name, url, { optional = true } = {}) {
  const dest = join(mediaDir, name)
  if (await exists(dest)) { console.log(`  = ${name} (cached)`); return true }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0) throw new Error('empty body')
    await writeFile(dest, buf)
    console.log(`  + ${name} (${(buf.byteLength / 1024).toFixed(0)} KB)`)
    return true
  } catch (err) {
    console.log(`  ! ${name} skipped -- ${err.message}${optional ? ' (falling back)' : ''}`)
    return false
  }
}

await mkdir(mediaDir, { recursive: true })

console.log('HDRI environment:')
const hdri = await grab(...HDRI)

console.log('Photos:')
const photos = []
const photoJobs = PHOTO_SEEDS.slice(0, PHOTO_COUNT).map(async (seed, i) => {
  const name = `photo-${String(i + 1).padStart(2, '0')}.jpg`
  // 4:3 to match the default planeAspect, so cover-cropping is a no-op.
  if (await grab(name, `https://picsum.photos/seed/${seed}/1024/768`)) photos.push(name)
})
await Promise.all(photoJobs)

console.log('Videos:')
const videos = []
for (const [name, url] of VIDEOS) if (await grab(name, url)) videos.push(name)

const manifest = {
  env: hdri ? HDRI[0] : null,
  photos: photos.sort(),
  videos: videos.sort(),
}
await writeFile(join(mediaDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\nmanifest.json -> ${photos.length} photos, ${videos.length} videos, env=${manifest.env ?? 'procedural'}`)
