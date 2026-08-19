// The grid is wrapped onto a sphere, so "how many columns cover the viewport"
// is not a division -- it is a root-find against the sphere-to-screen
// projection. This mirrors the original solver exactly.

/**
 * Screen-space position of the *near edge* of a card whose centre sits `arc`
 * along the sphere from the tangent point.
 *
 * A point at arc length s lies at lateral offset R*sin(s/R) and depth
 * R*(1-cos(s/R)) behind the tangent plane; the camera is `persp` in front of
 * it. Perspective-divide both the centre and the card's own half-extent.
 */
function edgeOnScreen (arc, halfPlane, persp, radius) {
  const depth = persp + radius * (1 - Math.cos(arc / radius))
  return (persp * radius * Math.sin(arc / radius)) / depth - (halfPlane * persp) / depth
}

/** Smallest arc whose near edge reaches `target` screen units. Bisection, 24 steps. */
function solveArc (target, halfPlane, persp, radius) {
  // Beyond this the view ray is tangent to the sphere and the mapping stops
  // being monotonic, so it is both the search bound and the saturation value.
  const horizon = radius * Math.acos(radius / (persp + radius))
  if (edgeOnScreen(horizon, halfPlane, persp, radius) < target) return horizon
  let lo = 0
  let hi = horizon
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) * 0.5
    if (edgeOnScreen(mid, halfPlane, persp, radius) < target) lo = mid
    else hi = mid
  }
  return hi
}

/** Clamp to [min,max] and force even -- the brick stagger only tiles with even counts. */
function evenClamp (value, min, max) {
  const n = Math.min(max, Math.max(min, Math.ceil(value)))
  if (n % 2 === 0) return n
  if (n + 1 <= max) return n + 1
  if (n - 1 >= min) return n - 1
  return n
}

export function solveLayout (vw, vh, cfg, gapRatio = cfg.gapRatio) {
  const w = Math.max(vw, 1)
  const h = Math.max(vh, 1)
  const scale = Math.max(w, h) / cfg.referenceWidth

  const perspective = cfg.perspective * scale
  const sphereRadius = cfg.sphereRadius * scale
  const maxZoomZ = 0.1 * perspective

  const widthRatio = h > w ? cfg.planeWidthRatioPortrait : cfg.planeWidthRatio
  const planeWidth = w * widthRatio
  const planeHeight = planeWidth / cfg.planeAspect
  const cellW = planeWidth * (1 + gapRatio)
  const cellH = planeHeight * (1 + gapRatio)

  // Cover the viewport, plus the parallax swing, plus zoom headroom.
  const reachX = 0.5 * w * cfg.coverageMargin + Math.tan(0.05) * perspective + maxZoomZ
  const reachY = 0.5 * h * cfg.coverageMargin + Math.tan(0.05) * perspective + maxZoomZ

  const arcX = solveArc(reachX, 0.5 * planeWidth, perspective, sphereRadius)
  const arcY = solveArc(reachY, 0.5 * planeHeight, perspective, sphereRadius)

  const cols = evenClamp((2 * arcX) / cellW + 4, cfg.minCols, cfg.maxCols)
  const rows = evenClamp((2 * arcY) / cellH + 4, cfg.minRows, cfg.maxRows)

  return {
    cols,
    rows,
    perspective,
    sphereRadius,
    planeWidth,
    planeHeight,
    planeAspect: planeWidth / Math.max(planeHeight, 1),
    cellW,
    cellH,
    periodX: cols * cellW,
    periodY: rows * cellH,
    cardScale: planeWidth / Math.max(cfg.referenceWidth * cfg.planeWidthRatio, 1),
    maxZoomZ,
  }
}

/** Signed modular wrap into [-period/2, period/2). This is what makes it infinite. */
export function wrap (value, period) {
  const half = 0.5 * period
  return (((value + half) % period) + period) % period - half
}

/**
 * Assign media to cells so no two neighbours share a clip. Greedy: cost is
 * 10x reuse count, +1 if the clip appears in the second ring, and direct
 * neighbours are excluded outright.
 */
export function assignMedia (cellCount, cols, mediaCount) {
  const assignment = new Array(cellCount).fill(-1)
  const uses = new Array(mediaCount).fill(0)
  const neighbours = (index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const out = []
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue
        const r = row + dr
        const c = col + dc
        const i = r * cols + c
        if (c >= 0 && c < cols && i >= 0 && i < cellCount) out.push(i)
      }
    }
    return out
  }

  for (let i = 0; i < cellCount; i += 1) {
    const adjacent = new Set()
    const secondRing = new Set()
    for (const n of neighbours(i)) {
      if (assignment[n] >= 0) adjacent.add(assignment[n])
      for (const nn of neighbours(n)) if (assignment[nn] >= 0) secondRing.add(assignment[nn])
    }
    let best = -1
    let bestCost = Infinity
    for (let m = 0; m < mediaCount; m += 1) {
      if (adjacent.has(m)) continue
      const cost = 10 * uses[m] + (secondRing.has(m) ? 1 : 0)
      if (cost < bestCost) { bestCost = cost; best = m }
    }
    if (best < 0) best = i % mediaCount // more neighbours than clips
    assignment[i] = best
    uses[best] += 1
  }
  return assignment
}

/** CSS `object-fit: cover` as a uv scale/offset pair. */
export function coverTransform (sourceW, sourceH, targetAspect) {
  if (sourceW <= 0 || sourceH <= 0 || targetAspect <= 0) {
    return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }
  }
  const aspect = sourceW / sourceH
  if (aspect > targetAspect) {
    const scaleX = targetAspect / aspect
    return { scaleX, scaleY: 1, offsetX: (1 - scaleX) / 2, offsetY: 0 }
  }
  const scaleY = aspect / targetAspect
  return { scaleX: 1, scaleY, offsetX: 0, offsetY: (1 - scaleY) / 2 }
}
