import {
  Scene, PerspectiveCamera, PlaneGeometry, Mesh, Group,
  Vector3, Euler, Quaternion, MathUtils,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { mix, color, screenUV } from 'three/tsl'

import { GLASS, GRID, CAMERA, TILT, INTRO, BACKGROUND, LOADING_SPRING, detectTier, tierSettings } from './config.js'
import { solveLayout, wrap, assignMedia, coverTransform } from './layout.js'
import { createGlassUniforms, createGlassMaterial } from './glass.js'
import { loadMedia, loadEnvironment, mediaSize } from './media.js'
import { Controls, Spring } from './input.js'
import { Overlay } from './overlay.js'

const canvas = document.getElementById('scene')
const overlayRoot = document.getElementById('overlay')
const hud = document.getElementById('hud')

const tier = detectTier()
const quality = tierSettings(tier)

const renderer = new WebGPURenderer({ canvas, antialias: true })
renderer.setPixelRatio(MathUtils.clamp(window.devicePixelRatio, quality.dpr[0], quality.dpr[1]))
renderer.setSize(window.innerWidth, window.innerHeight)
await renderer.init()

const scene = new Scene()
scene.backgroundNode = mix(
  color(BACKGROUND.from),
  color(BACKGROUND.to),
  screenUV.x.sub(screenUV.y).add(1).mul(0.5),
)

const camera = new PerspectiveCamera(50, 1, 0.1, 10000)

// A spring-smoothed percentage counter, like the original's loading screen.
// The glass itself never fades in -- it appears at full opacity.
const loadingEl = document.getElementById('loading')
const progress = new Spring(LOADING_SPRING)
let rawProgress = 0
let loadingDone = false
const bumpProgress = (v) => { rawProgress = Math.min(1, Math.max(rawProgress, v)) }
;(function tickLoading (prev) {
  const now = performance.now()
  progress.set(rawProgress)
  progress.update(Math.min((now - (prev ?? now)) / 1000, 1 / 20))
  if (loadingEl) loadingEl.textContent = `${Math.round(100 * progress.value)}%`
  if (!loadingDone || progress.value < 0.999) requestAnimationFrame(() => tickLoading(now))
  else loadingEl?.remove()
})()

const { items, manifest } = await loadMedia(quality, bumpProgress)
const envTexture = await loadEnvironment(manifest)
bumpProgress(1)
loadingDone = true

// Shared glass uniforms; only the cover transform is per-material.
const glassUniforms = createGlassUniforms(GLASS)
const dispersionSamples = Math.min(GLASS.dispersionSamples, quality.maxDispersionSamples)

const materials = items.map((item) => createGlassMaterial({
  mediaTexture: item.texture,
  envTexture,
  dispersionSamples,
  uniforms: glassUniforms,
}))

const geometry = new PlaneGeometry(1, 1, 16, 12)   // subdivided: positionNode displaces it
const group = new Group()
scene.add(group)

const controls = new Controls(canvas)
const overlay = new Overlay(overlayRoot)
const gapSpring = new Spring(INTRO.gapSpring, INTRO.gapFrom)
gapSpring.set(GRID.gapRatio)

const AXIS = new Vector3(0, 0, 1)
const dir = new Vector3()
const corner = new Vector3()
const tiltEuler = new Euler()
const tiltQuat = new Quaternion()
const CORNERS = [
  new Vector3(-0.5, -0.5, 0), new Vector3(0.5, -0.5, 0),
  new Vector3(0.5, 0.5, 0), new Vector3(-0.5, 0.5, 0),
]

let meshes = []
let tilts = []
let hovered = -1        // index of the single tile the cursor is over, or -1
let assignment = []
let layout = solveLayout(window.innerWidth, window.innerHeight, GRID)
let lastAspect = -1

function buildTiles (cols, rows) {
  for (const m of meshes) group.remove(m)
  meshes = []
  tilts = []
  hovered = -1          // indices are about to mean something else entirely
  const count = cols * rows
  assignment = assignMedia(count, cols, materials.length)
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(geometry, materials[assignment[i]].material)
    mesh.frustumCulled = false      // we cull analytically below
    group.add(mesh)
    meshes.push(mesh)
    // Per-tile tilt state. `hover` is separate from the two angles because it
    // stays at full strength across a tile's whole face, including the centre
    // where both angles are zero -- that is what makes the lift read as "this
    // tile is under the cursor" rather than "this tile is banking".
    tilts.push({
      rx: new Spring(TILT.spring),
      ry: new Spring(TILT.spring),
      hover: new Spring(TILT.spring),
    })
  }
  overlay.resize(count)
}
buildTiles(layout.cols, layout.rows)

// --- resize, debounced like the original so a drag-resize does not thrash ---
let resizeTimer = 0
function applyViewport () {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setPixelRatio(MathUtils.clamp(window.devicePixelRatio, quality.dpr[0], quality.dpr[1]))
  renderer.setSize(w, h)
  const next = solveLayout(w, h, GRID)
  if (next.cols !== layout.cols || next.rows !== layout.rows) buildTiles(next.cols, next.rows)
  layout = next
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(applyViewport, 150)
  renderer.setSize(window.innerWidth, window.innerHeight)
})

function updateCoverTransforms (planeAspect) {
  if (planeAspect === lastAspect) return
  lastAspect = planeAspect
  materials.forEach((mat, i) => {
    const { width, height } = mediaSize(items[i])
    const c = coverTransform(width, height, planeAspect)
    mat.uniforms.coverScale.value.set(c.scaleX, c.scaleY)
    mat.uniforms.coverOffset.value.set(c.offsetX, c.offsetY)
  })
}

// Small live handle for the verify/probe harnesses.
window.__ilg = {
  controls, camera, materials, items, tier,
  get layout () { return layout },
  get meshes () { return meshes },
  get tilts () { return tilts },
  get hovered () { return hovered },
}

let last = performance.now()
let fpsAccum = 0
let fpsFrames = 0
let visible = 0

renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min((now - last) / 1000, 1 / 20)
  last = now

  controls.update(dt)
  gapSpring.update(dt)

  const w = window.innerWidth
  const h = window.innerHeight

  // Layout with the animated intro gap: tiles start flung apart and settle.
  const gap = gapSpring.value
  const L = solveLayout(w, h, GRID, GRID.gapRatio)
  const { planeWidth, planeHeight, sphereRadius, perspective, cardScale, maxZoomZ } = L
  const cols = layout.cols
  const rows = layout.rows
  const cellW = planeWidth * (1 + gap)
  const cellH = planeHeight * (1 + gap)
  const periodX = cols * cellW
  const periodY = rows * cellH

  // --- camera: pointer parallax on a sphere of radius `perspective` ---
  const yaw = -CAMERA.parallax * controls.pointerX.value
  const pitch = CAMERA.parallax * controls.pointerY.value
  const cx = Math.sin(yaw) * Math.cos(pitch) * perspective
  const cy = Math.sin(pitch) * perspective
  const cz = Math.cos(yaw) * Math.cos(pitch) * perspective
  camera.fov = MathUtils.radToDeg(2 * Math.atan(h / 2 / perspective))
  camera.aspect = w / Math.max(h, 1)
  camera.updateProjectionMatrix()
  camera.position.set(cx, cy, cz + controls.dollyOffset(maxZoomZ))
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()

  // --- uniforms ---
  glassUniforms.planeSize.value.set(planeWidth, planeHeight)
  glassUniforms.sphereRadius.value = sphereRadius
  glassUniforms.cornerRadius.value = GLASS.cornerRadius * planeWidth
  glassUniforms.bevelWidth.value = GLASS.bevelWidth * planeWidth
  glassUniforms.thickness.value = GLASS.thickness * cardScale
  glassUniforms.rimWidth.value = GLASS.rimWidth * cardScale
  updateCoverTransforms(L.planeAspect)

  // --- place tiles on the sphere, wrapping modularly ---
  const scrollX = controls.scrollX.value
  const scrollY = controls.scrollY.value
  const px = controls.pointer.x
  const py = controls.pointer.y
  const pointerActive = controls.pointer.active
  const tiltLift = TILT.lift * planeWidth
  // Which tile the cursor is over is decided from *this* frame's projection and
  // consumed on the next one. Projected tile boxes can overlap slightly at the
  // periphery, so it has to be an argmin over the whole grid rather than a
  // per-tile hit test -- and that argmin is only complete once the loop ends.
  // One frame of lag, against springs that take ~200ms to settle.
  let nearestIndex = -1
  let nearestDistance = Infinity
  visible = 0

  for (let i = 0; i < meshes.length; i += 1) {
    const mesh = meshes[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    const stagger = (row % 2) * cellW * 0.5      // brick bond

    const x = wrap((col - (cols - 1) / 2) * cellW + scrollX + stagger, periodX)
    const y = wrap(-(row - (rows - 1) / 2) * cellH - scrollY, periodY)

    const lon = x / sphereRadius
    const lat = y / sphereRadius
    const cosLat = Math.cos(lat)
    dir.set(Math.sin(lon) * cosLat, Math.sin(lat), Math.cos(lon) * cosLat)

    mesh.position.set(dir.x * sphereRadius, dir.y * sphereRadius, dir.z * sphereRadius - sphereRadius)
    mesh.quaternion.setFromUnitVectors(AXIS, dir)
    mesh.scale.set(planeWidth, planeHeight, 1)
    mesh.updateWorldMatrix(true, false)

    // Analytic cull: screen-space AABB of the four corners.
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity; let seen = 0
    for (const c of CORNERS) {
      corner.copy(c).applyMatrix4(mesh.matrixWorld).project(camera)
      if (corner.z < -1 || corner.z > 1) continue
      const sx = (corner.x * 0.5 + 0.5) * w
      const sy = (-(corner.y * 0.5) + 0.5) * h
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx)
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy)
      seen += 1
    }

    let draw = false
    let interactive = false
    if (seen > 0) {
      const area = (maxX - minX) * (maxY - minY)
      if (area > 1) {
        draw = Math.min(maxX, w + 64) - Math.max(minX, -64) > 0 &&
               Math.min(maxY, h + 64) - Math.max(minY, -64) > 0
        const ow = Math.min(maxX, w) - Math.max(minX, 0)
        const oh = Math.min(maxY, h) - Math.max(minY, 0)
        interactive = ow > 0 && oh > 0 && (ow * oh) / area >= 0.5
      }
    }

    // --- per-tile pointer tilt ---
    // The cursor offset is normalised by the tile's *own* half-extents, so the
    // response is zero at the centre and full at the edges regardless of how
    // foreshortened the tile is out at the periphery. Only `hovered` reacts.
    const tilt = tilts[i]
    let targetRx = 0
    let targetRy = 0
    let targetHover = 0
    if (pointerActive && seen === 4) {
      const halfW = Math.max((maxX - minX) * 0.5, 1)
      const halfH = Math.max((maxY - minY) * 0.5, 1)
      const u = (px - (minX + maxX) * 0.5) / halfW
      const v = (py - (minY + maxY) * 0.5) / halfH
      // Box distance, not radial: the tiles are rectangles, so "am I over it"
      // should be one too, or the corners register late.
      const d = Math.max(Math.abs(u), Math.abs(v))
      if (d < nearestDistance) { nearestDistance = d; nearestIndex = i }
      if (i === hovered) {
        targetHover = 1
        // Negative on both axes puts the edge nearest the cursor *up* toward
        // the viewer; TILT.direction flips it to a press-down instead.
        targetRx = -TILT.direction * TILT.maxAngle * clamp(v, -1, 1)
        targetRy = -TILT.direction * TILT.maxAngle * clamp(u, -1, 1)
      }
    }
    tilt.rx.set(targetRx)
    tilt.ry.set(targetRy)
    tilt.hover.set(targetHover)
    if (draw) {
      tilt.rx.update(dt)
      tilt.ry.update(dt)
      tilt.hover.update(dt)
      if (tilt.rx.value || tilt.ry.value || tilt.hover.value) {
        tiltEuler.set(tilt.rx.value, tilt.ry.value, 0)
        mesh.quaternion.multiply(tiltQuat.setFromEuler(tiltEuler))
        mesh.position.addScaledVector(dir, tiltLift * tilt.hover.value)
        mesh.updateWorldMatrix(true, false)
      }
    } else {
      // Off-screen tiles wrap by a whole period, which would otherwise hand the
      // springs a huge bogus delta to animate through on re-entry. Snap instead.
      tilt.rx.jump(targetRx)
      tilt.ry.jump(targetRy)
      tilt.hover.jump(targetHover)
    }

    mesh.visible = draw
    if (draw) visible += 1
    if (interactive) overlay.place(i, mesh, planeWidth, planeHeight)
    else overlay.hide(i)
  }

  // `<= 1` means the cursor was genuinely inside the winner's box, not merely
  // closest to it -- so the gaps between tiles leave everything flat.
  hovered = nearestDistance <= 1 ? nearestIndex : -1

  overlay.syncCamera(camera, perspective, w, h)
  renderer.render(scene, camera)

  fpsAccum += dt
  fpsFrames += 1
  if (fpsAccum >= 0.5) {
    const fps = Math.round(fpsFrames / fpsAccum)
    hud.textContent = `${fps} fps · ${visible}/${meshes.length} tiles · ${cols}×${rows} · ${dispersionSamples} taps · ${tier} · ${renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2'}`
    fpsAccum = 0
    fpsFrames = 0
  }
})

function clamp (v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }

