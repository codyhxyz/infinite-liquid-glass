import { Vector2, Color, FrontSide } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  Fn, uniform, texture, positionLocal, uv, vec2, vec3, vec4, float,
  abs, min, max, length, clamp, pow, smoothstep, mix, dot, normalize,
  refract, reflect, saturate, cos, sin, fwidth, sqrt,
  materialOpacity, cameraPosition, modelWorldMatrix, modelWorldMatrixInverse,
  faceDirection, equirectUV,
} from 'three/tsl'

/**
 * Glass uniforms are shared across every tile -- only the cover transform is
 * per-material, because that depends on each clip's own dimensions.
 */
export function createGlassUniforms (s) {
  return {
    planeSize: uniform(new Vector2(1, 1)),
    sphereRadius: uniform(1000),
    cornerRadius: uniform(s.cornerRadius),
    bevelWidth: uniform(s.bevelWidth),
    bevelPower: uniform(s.bevelPower),
    bevelMaxSlope: uniform(s.bevelMaxSlope),
    thickness: uniform(s.thickness),
    ior: uniform(s.ior),
    refractStrength: uniform(s.refractStrength),
    dispersion: uniform(s.dispersion),
    fresnelF0: uniform(s.fresnelF0),
    envIntensity: uniform(s.envIntensity),
    envMaxMix: uniform(s.envMaxMix),
    envRotation: uniform(s.envRotation),
    envRotationX: uniform(s.envRotationX),
    rimWidth: uniform(s.rimWidth),
    rimIntensity: uniform(s.rimIntensity),
    rimColor: uniform(new Color(s.rimColor)),
    rimColorTop: uniform(new Color(s.rimColorTop)),
    tint: uniform(new Color(s.tint)),
  }
}

/**
 * Dispersion taps with triangular RGB response curves. For 5 samples this
 * gives R [.667 .333 0 0 0], G [0 .25 .5 .25 0], B [0 0 0 .333 .667] -- red
 * weighted to the low-IOR end, blue to the high-IOR end. Not an RGB split.
 */
export function dispersionTaps (count) {
  const n = Math.max(3, Math.round(count))
  const tri = (t, centre) => Math.max(0, 1 - Math.abs(t - centre) / 0.5)
  const taps = []
  const sums = [0, 0, 0]
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1)
    const weight = [tri(t, 0), tri(t, 0.5), tri(t, 1)]
    sums[0] += weight[0]; sums[1] += weight[1]; sums[2] += weight[2]
    taps.push({ offset: t - 0.5, weight })
  }
  return taps.map(({ offset, weight }) => ({
    offset,
    weight: [weight[0] / sums[0], weight[1] / sums[1], weight[2] / sums[2]],
  }))
}

export function createGlassMaterial ({ mediaTexture, envTexture, dispersionSamples, uniforms }) {
  const u = {
    ...uniforms,
    coverScale: uniform(new Vector2(1, 1)),
    coverOffset: uniform(new Vector2(0, 0)),
  }
  const taps = dispersionTaps(dispersionSamples)
  const media = texture(mediaTexture)
  const half = u.planeSize.mul(0.5)

  // z of the sphere at lateral offset p, and the sag below the tangent plane.
  const sphereZ = Fn(([p]) => sqrt(max(u.sphereRadius.mul(u.sphereRadius).sub(dot(p, p)), float(1))))
  const sag = Fn(([p]) => sphereZ(p).sub(u.sphereRadius))

  // iq's rounded-box SDF, negative inside.
  const sdRect = Fn(([p]) => {
    const r = min(u.cornerRadius, min(half.x, half.y))
    const q = abs(p).sub(half).add(r)
    return length(max(q, vec2(0))).add(min(max(q.x, q.y), float(0))).sub(r)
  })

  // Superellipse thickness profile: t^n + (h/thickness)^n = 1.
  // Flat plateau across the interior, fast rounded shoulder at the rim.
  // A smoothstep ramp here reads as plastic -- keep the Lame curve.
  const bevelHeight = Fn(([sd]) => {
    const t = clamp(float(1).add(sd.div(max(u.bevelWidth, float(0.001)))), 0, 1)
    const n = max(u.bevelPower, float(1))
    return pow(max(float(1).sub(pow(t, n)), float(0)), float(1).div(n)).mul(u.thickness)
  })

  const thicknessAt = Fn(([p]) => bevelHeight(sdRect(p)))

  // Local -> world, accounting for the non-uniform tile scale.
  const toWorld = Fn(([v]) => normalize(modelWorldMatrix.mul(vec4(v.xy.div(u.planeSize), v.z, 0)).xyz))

  const colorNode = Fn(() => {
    const p = positionLocal.xy.mul(u.planeSize).toVar()
    const sd = sdRect(p).toVar()

    // --- normal: global sphere normal minus the bevel gradient ---
    const eps = max(u.bevelWidth.mul(0.06), float(0.35)).toVar()
    const grad = vec2(
      thicknessAt(p.add(vec2(eps, 0))).sub(thicknessAt(p.sub(vec2(eps, 0)))),
      thicknessAt(p.add(vec2(0, eps))).sub(thicknessAt(p.sub(vec2(0, eps)))),
    ).div(eps.mul(2)).toVar()
    const slope = length(grad).toVar()
    // Clamping the slope is essential: uncapped, the rim normal goes
    // near-tangent and total internal reflection paints a hard black ring.
    const clamped = grad.mul(min(slope, u.bevelMaxSlope).div(max(slope, float(1e-4))))
    const sphereN = p.div(sphereZ(p)).toVar()
    const N = normalize(vec3(sphereN.sub(clamped), float(1))).mul(faceDirection).toVar()

    // --- view vector in local space ---
    const camLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz
    const frag = vec3(positionLocal.xy, sag(p))
    const toCam = camLocal.sub(frag).toVar()
    const V = normalize(vec3(toCam.xy.mul(u.planeSize), toCam.z)).toVar()

    // --- refraction, one tap per dispersion sample ---
    const baseUv = uv()
    let refracted = vec3(0)
    for (const tap of taps) {
      const eta = float(1).div(max(u.ior.add(u.dispersion.mul(tap.offset)), float(1.0001)))
      const dir = refract(V.negate(), N, eta)
      const dist = u.thickness.div(max(abs(dir.z), float(0.05)))   // path length through the slab
      const offset = baseUv.add(dir.xy.mul(dist).mul(u.refractStrength).div(u.planeSize))
      // Clamp *before* the cover transform: near the rim this smears the
      // clamped border pixels outward, which is the streaking along the edges.
      const sampleUv = clamp(offset, 0, 1).mul(u.coverScale).add(u.coverOffset)
      refracted = refracted.add(media.sample(sampleUv).rgb.mul(vec3(...tap.weight)))
    }

    // --- environment reflection ---
    const Nw = toWorld(N).toVar()
    const Vw = toWorld(V).toVar()
    const R = normalize(reflect(Vw.negate(), Nw)).toVar()
    const cy = cos(u.envRotation)
    const sy = sin(u.envRotation)
    const rotY = vec3(R.x.mul(cy).sub(R.z.mul(sy)), R.y, R.x.mul(sy).add(R.z.mul(cy)))
    const cx = cos(u.envRotationX)
    const sx = sin(u.envRotationX)
    const rotX = vec3(rotY.x, rotY.y.mul(cx).sub(rotY.z.mul(sx)), rotY.y.mul(sx).add(rotY.z.mul(cx)))
    const env = texture(envTexture, equirectUV(rotX)).rgb

    // --- composite ---
    const fresnel = u.fresnelF0.add(
      float(1).sub(u.fresnelF0).mul(pow(saturate(float(1).sub(dot(N, V))), 5)),
    )
    // Capped at envMaxMix so the tile stays transmissive and never goes chrome.
    const envMix = min(saturate(fresnel.mul(u.envIntensity)), u.envMaxMix)

    const rim = smoothstep(u.rimWidth.negate(), float(0), sd).mul(u.rimIntensity)
    const rimGradient = saturate(p.y.div(max(half.y, float(1e-4))).mul(0.5).add(0.5))
    const rimTint = mix(u.rimColor, u.rimColorTop, rimGradient)

    return mix(refracted.mul(u.tint), env, envMix).add(rimTint.mul(rim))
  })

  // Analytic AA on the rounded-rect silhouette; materialOpacity drives the intro fade.
  const opacityNode = Fn(() => {
    const sd = sdRect(positionLocal.xy.mul(u.planeSize))
    const w = max(fwidth(sd).mul(0.5), float(1e-4))
    return float(1).sub(smoothstep(w.negate(), w, sd)).mul(materialOpacity)
  })

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    alphaTest: 0.001,
    depthWrite: true,
    depthTest: true,
    side: FrontSide,
    toneMapped: false,
  })
  // Bend the plane onto the sphere. Same radius as the global layout, so all
  // tiles join into one continuous shell rather than a field of separate domes.
  material.positionNode = vec3(positionLocal.xy, sag(positionLocal.xy.mul(u.planeSize)))
  material.colorNode = colorNode()
  material.opacityNode = opacityNode()

  return { material, uniforms: u }
}
