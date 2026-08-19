// Every default here is taken from the original build's parameter block.

export const GLASS = {
  cornerRadius: 0.163,      // fraction of planeWidth
  bevelWidth: 0.192,        // fraction of planeWidth -- the lens shoulder
  bevelPower: 3.9,          // superellipse exponent for the thickness profile
  bevelMaxSlope: 1.74,      // caps the rim normal; without it you get a black ring
  thickness: 155,           // scaled by cardScale
  ior: 2.3,                 // past diamond, deliberately
  roughness: 0,
  refractStrength: 0.7,
  dispersion: 0.32,         // -> per-channel IOR 2.14 .. 2.46
  dispersionSamples: 5,
  fresnelF0: 0.045,
  envIntensity: 1.93,
  envMaxMix: 0.27,          // hard cap so the glass never goes chrome
  envRotation: -2,          // radians about Y
  envRotationX: 0,
  rimWidth: 10,             // scaled by cardScale
  rimIntensity: 0.11,
  rimColor: '#ffffff',
  rimColorTop: '#ffffff',
  tint: '#ffffff',
}

export const GRID = {
  perspective: 1200,
  sphereRadius: 5000,
  planeAspect: 4 / 3,
  planeWidthRatio: 0.38,
  planeWidthRatioPortrait: 0.72,
  gapRatio: 0.045,
  referenceWidth: 1728,
  coverageMargin: 1.15,
  minCols: 4,
  maxCols: 16,
  minRows: 4,
  maxRows: 16,
}

export const DRAG = {
  spring: { stiffness: 100, damping: 16, mass: 0.5, restDelta: 1e-5 },
  magnitudeSpring: { stiffness: 140, damping: 24, mass: 0.6 },
  gain: 1.5,                // pointer delta is amplified before it hits the spring
  fling: 0.1,               // released velocity folded into the target
}

export const CAMERA = {
  spring: { stiffness: 80, damping: 18, mass: 0.8 },
  // The original orbits the whole camera with the pointer (0.05 rad of yaw and
  // pitch at the screen edge), which tilts the entire scene as one slab. We
  // deliberately diverge and spend that input on the tiles instead -- see TILT.
  // Left live rather than deleted: this is the one knob that brings it back.
  parallax: 0,
  // The camera dollies back with *drag speed* -- there is no zoom input at all.
  dollyRate: 0.04,
}

/**
 * Per-tile pointer response. Not in the original.
 *
 * Exactly one tile responds at a time -- the one the cursor is actually over.
 * Tilt is proportional to the cursor's offset from that tile's own screen-space
 * centre, measured in half-tiles, so it is zero dead-centre and peaks at the
 * edges. Crossing between tiles is smoothed in *time* by the springs rather
 * than in space by a falloff: the tile you leave settles flat while the one you
 * enter rises, and no third tile is ever involved.
 */
export const TILT = {
  spring: { stiffness: 190, damping: 24, mass: 0.55 },
  maxAngle: 0.2,            // radians at a tile edge (~11 degrees)
  lift: 0.04,               // toward the viewer, as a fraction of planeWidth
  direction: 1,             // +1: edge nearest the cursor rises. -1: it dips.
}

export const INTRO = {
  gapFrom: 3,               // tiles start four cell-widths apart...
  gapSpring: { stiffness: 100, damping: 18, mass: 0.7, restDelta: 2e-4 },
}

// Drives the loading percentage, not the tiles -- the glass never fades in.
export const LOADING_SPRING = { stiffness: 90, damping: 24, mass: 0.55 }

export const BACKGROUND = { from: '#0a1c3d', to: '#000000' }

// Same heuristic the original uses to pick a quality tier.
export function detectTier () {
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 8
  const memory = navigator.deviceMemory ?? 8
  return coarse || cores <= 6 || memory <= 4 ? 'low' : 'high'
}

export function tierSettings (tier) {
  return tier === 'low'
    ? { dpr: [1, 1.5], maxDispersionSamples: 3, videoCount: 8, maxVideoHeight: 540 }
    : { dpr: [1, 2], maxDispersionSamples: Infinity, videoCount: Infinity, maxVideoHeight: Infinity }
}
