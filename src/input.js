import { DRAG, CAMERA } from './config.js'

/**
 * Framer-motion-style spring. The original's constants are all slightly
 * overdamped, which is why nothing in the scene ever visibly oscillates.
 */
export class Spring {
  constructor ({ stiffness, damping, mass }, value = 0) {
    this.k = stiffness
    this.c = damping
    this.m = mass
    this.value = value
    this.target = value
    this.velocity = 0
  }

  set (target) { this.target = target }

  jump (value) { this.value = value; this.target = value; this.velocity = 0 }

  update (dt) {
    // Substep so a dropped frame cannot blow the integrator up.
    const steps = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 120))))
    const h = dt / steps
    for (let i = 0; i < steps; i += 1) {
      const force = -this.k * (this.value - this.target) - this.c * this.velocity
      this.velocity += (force / this.m) * h
      this.value += this.velocity * h
    }
    return this.value
  }
}

/**
 * Input model, matching the original's motion-value graph:
 *
 *   pan     -> scrollTarget += 1.5 * delta        (raw target)
 *   panEnd  -> scrollTarget += 0.1 * velocity     (fling)
 *   scrollX/Y  = spring(scrollTarget)
 *   speed      = hypot(scrollX.velocity, scrollY.velocity)
 *   dolly      = spring(speed)  ->  camera pulls back as you fling
 *
 * There is no zoom input in the original. What looks like zoom is the camera
 * dollying back in proportion to how fast the grid is moving.
 */
export class Controls {
  constructor (element) {
    this.element = element
    this.scrollX = new Spring(DRAG.spring)
    this.scrollY = new Spring(DRAG.spring)
    this.pointerX = new Spring(CAMERA.spring)
    this.pointerY = new Spring(CAMERA.spring)
    this.speed = new Spring(DRAG.magnitudeSpring)

    this.dragging = false
    this.pointerId = null
    this.last = { x: 0, y: 0, t: 0 }
    this.velocity = { x: 0, y: 0 }

    // Raw cursor position in CSS px. The per-tile tilt is measured against each
    // tile's own screen box, so it needs the actual location -- a viewport-
    // normalised value has no idea where any individual tile is. `active` goes
    // false when the pointer leaves, so every tile relaxes flat.
    this.pointer = { x: 0, y: 0, active: false }

    this._bind()
  }

  _bind () {
    const el = this.element

    el.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return
      this.dragging = true
      this.pointerId = e.pointerId
      el.setPointerCapture(e.pointerId)
      el.classList.add('grabbing')
      this.last = { x: e.clientX, y: e.clientY, t: performance.now() }
      this.velocity = { x: 0, y: 0 }
    })

    window.addEventListener('pointermove', (e) => {
      // Pointer tracking runs whether or not we are dragging, so a tile banks
      // under the cursor mid-drag too.
      this.pointer.x = e.clientX
      this.pointer.y = e.clientY
      this.pointer.active = true
      this.pointerX.set(clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1))
      this.pointerY.set(clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1))

      if (!this.dragging || e.pointerId !== this.pointerId) return
      const now = performance.now()
      const dx = e.clientX - this.last.x
      const dy = e.clientY - this.last.y
      const dt = Math.max(now - this.last.t, 1) / 1000

      this.scrollX.target += DRAG.gain * dx
      this.scrollY.target += DRAG.gain * dy
      // Exponential smoothing, so one jittery sample cannot dominate the fling.
      this.velocity.x = this.velocity.x * 0.7 + (dx / dt) * 0.3
      this.velocity.y = this.velocity.y * 0.7 + (dy / dt) * 0.3
      this.last = { x: e.clientX, y: e.clientY, t: now }
    })

    const release = (e) => {
      // A finger has no hover state, so lifting it must also drop the tilt --
      // otherwise one tile stays banked forever on touch devices.
      if (e.pointerType === 'touch') this.pointer.active = false
      if (!this.dragging || (e.pointerId != null && e.pointerId !== this.pointerId)) return
      this.dragging = false
      this.pointerId = null
      el.classList.remove('grabbing')
      this.scrollX.target += this.velocity.x * DRAG.fling
      this.scrollY.target += this.velocity.y * DRAG.fling
      this.velocity = { x: 0, y: 0 }
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)

    // Cursor left the window entirely (or we lost focus): let everything settle.
    document.addEventListener('pointerleave', () => { this.pointer.active = false })
    window.addEventListener('blur', () => { this.pointer.active = false })

    // Not in the original, which is pan-only. Kept so a trackpad two-finger
    // scroll is not dead; it feeds the same targets a drag would.
    el.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.scrollX.target -= e.deltaX
      this.scrollY.target -= e.deltaY
    }, { passive: false })
  }

  /**
   * Camera pull-back from drag speed, soft-clamped so it eases into a limit
   * rather than hitting a wall.
   */
  dollyOffset (maxZoomZ) {
    if (maxZoomZ <= 0) return 0
    const limit = 3 * maxZoomZ
    return limit * Math.tanh((CAMERA.dollyRate * this.speed.value) / limit)
  }

  update (dt) {
    this.scrollX.update(dt)
    this.scrollY.update(dt)
    this.pointerX.update(dt)
    this.pointerY.update(dt)
    // Speed follows the *springs'* velocities, so it decays to zero on its own
    // as the grid settles -- no explicit reset needed on release.
    this.speed.set(Math.hypot(this.scrollX.velocity, this.scrollY.velocity))
    this.speed.update(dt)
  }
}

function clamp (v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }
