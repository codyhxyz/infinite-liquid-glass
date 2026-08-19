// Checks that pointer movement tilts individual tiles at their edges and does
// not tilt the whole scene. Four claims worth testing:
//   1. the camera never orbits off-axis, whatever the pointer does
//   2. a tile is flat at its own centre and banked near its own edge
//   3. exactly one tile responds at a time
//   4. everything relaxes when the pointer goes away
import { launch, DEFAULT_URL } from './lib/cdp.mjs'

const page = await launch({ port: 9336, url: DEFAULT_URL, wait: 9000 })
const { width: vw, height: vh } = page.viewport
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// The overlay cards are 1:1 with meshes and carry each tile's real screen box,
// so they are the cheapest way to ask "where is tile N".
const boxes = JSON.parse(await page.evalJs(`(() => {
  const kids = [...document.querySelector('#overlay .overlay-stage').children];
  return JSON.stringify(kids.map((e, i) => {
    if (e.style.visibility === 'hidden') return null;
    const r = e.getBoundingClientRect();
    return { i, cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height };
  }).filter(Boolean));
})()`))

// Nearest fully on-screen tile to the viewport centre: the least foreshortened
// one, so the numbers are easiest to reason about.
const target = boxes
  .filter((b) => b.cx - b.w / 2 > 0 && b.cx + b.w / 2 < vw && b.cy - b.h / 2 > 0 && b.cy + b.h / 2 < vh)
  .sort((a, b) => Math.hypot(a.cx - vw / 2, a.cy - vh / 2) - Math.hypot(b.cx - vw / 2, b.cy - vh / 2))[0]
if (!target) throw new Error('no fully on-screen tile to probe')

const sample = async (label, rawX, rawY) => {
  await page.hover(clamp(rawX, 2, vw - 2), clamp(rawY, 2, vh - 2))
  const s = JSON.parse(await page.evalJs(`(() => {
    const g = window.__ilg, t = g.tilts[${target.i}];
    return JSON.stringify({
      camX: +g.camera.position.x.toFixed(3),
      camY: +g.camera.position.y.toFixed(3),
      rx: +t.rx.value.toFixed(4), ry: +t.ry.value.toFixed(4), hover: +t.hover.value.toFixed(3),
      moving: g.tilts.filter((x) => x.hover.value > 0.02 ||
        Math.abs(x.rx.value) > 0.005 || Math.abs(x.ry.value) > 0.005).length,
      hovered: g.hovered,
    });
  })()`))
  console.log(`${label.padEnd(18)} cam=(${s.camX},${s.camY})  rx=${String(s.rx).padStart(7)}  ry=${String(s.ry).padStart(7)}  hover=${s.hover}  moving=${s.moving}  hovered=#${s.hovered}`)
  return s
}

console.log(`viewport ${vw}x${vh}`)
console.log(`probing tile #${target.i} at (${Math.round(target.cx)},${Math.round(target.cy)}) size ${Math.round(target.w)}x${Math.round(target.h)}\n`)

const centre = await sample('centre', target.cx, target.cy)
const right = await sample('right edge', target.cx + target.w * 0.42, target.cy)
const left = await sample('left edge', target.cx - target.w * 0.42, target.cy)
const top = await sample('top edge', target.cx, target.cy - target.h * 0.42)
const bottom = await sample('bottom edge', target.cx, target.cy + target.h * 0.42)
const away = await sample('cursor to corner', 8, 8)

// The explicit relax path: losing the window drops every tile flat.
await page.hover(target.cx, target.cy, 400)
await page.evalJs('window.dispatchEvent(new Event("blur"))')
await page.sleep(900)
const blurred = JSON.parse(await page.evalJs(`(() => {
  const g = window.__ilg, t = g.tilts[${target.i}];
  return JSON.stringify({ hover: +t.hover.value.toFixed(3), active: g.controls.pointer.active });
})()`))
console.log(`after blur         hover=${blurred.hover}  pointerActive=${blurred.active}`)

await page.screenshot('ilg-tilt.png')

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
console.log('exceptions:', page.errors.length ? page.errors.join('\n') : '(none)')

await page.close(camStill && flatAtCentre && liftsOnHover && banksAtEdges && oneAtATime && relaxes ? 0 : 1)
