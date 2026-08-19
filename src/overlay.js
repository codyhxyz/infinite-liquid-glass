import { Matrix4, Vector3 } from 'three'

/**
 * The titles are real HTML, synced to the WebGPU camera with matrix3d -- the
 * CSS3DRenderer trick. Text stays crisp and selectable while the video behind
 * it warps, and that contrast is a signature part of the look.
 *
 * DOM nesting mirrors the original:
 *   root  (perspective, overflow hidden)
 *     stage  (full-size -> transform-origin is the viewport centre)
 *       card  (the query container)
 *         inner  (padding + type, sized in cqw)
 */

// Placeholder content written for this repo. The tiles need plausible
// studio-portfolio copy to demonstrate the type treatment against moving
// refraction; swap in your own freely.
export const PROJECTS = [
  { title: "Halflight", type: "Visual identity", description: "The hour the city stops explaining itself.", accent: "#e2ff4f" },
  { title: "Undertow", type: "Digital archive", description: "Everything the tide keeps returning.", accent: "#ff8fc0" },
  { title: "Quiet Alloy", type: "Art direction", description: "Strength that doesn't announce itself.", accent: "#7fe9ff" },
  { title: "Small Hours", type: "Campaign", description: "Made for the part of the night nobody schedules.", accent: "#ffbe5c" },
  { title: "Nearfield", type: "Spatial identity", description: "Close enough to change how you stand.", accent: "#b39cff" },
  { title: "Wide Channel", type: "Cultural platform", description: "Room enough for everyone talking at once.", accent: "#8affc6" },
  { title: "Salvage Myth", type: "Editorial", description: "What we rebuild from the things we threw out.", accent: "#ff9c7a" },
  { title: "Live Wire", type: "Brand system", description: "An identity that carries current.", accent: "#86c4ff" },
  { title: "Twin Signal", type: "Experience", description: "Two messages on the same frequency.", accent: "#cbff7a" },
  { title: "Last Ferry", type: "Film title", description: "Everyone leaves on the same boat.", accent: "#a8b4ff" },
  { title: "Static Garden", type: "Publication", description: "Something is growing in the interference.", accent: "#ff85e2" },
  { title: "Warm Circuit", type: "Exhibition", description: "Machines that run a little like us.", accent: "#6ff2df" },
  { title: "Still Setting", type: "Type experiment", description: "Letters still deciding what they mean.", accent: "#ffd76a" },
  { title: "Back Office", type: "Workplace", description: "The rooms where the work actually happens.", accent: "#d0a9ff" },
  { title: "Low Bandwidth", type: "Digital product", description: "Built for attention that is already spent.", accent: "#93ffb0" },
  { title: "Marginalia", type: "Editorial", description: "The best thinking happens beside the text.", accent: "#ff9aa8" },
  { title: "Never Settled", type: "Identity", description: "A system with no resting position.", accent: "#63b8ff" },
  { title: "Block Radius", type: "Wayfinding", description: "Everything worth knowing is four minutes away.", accent: "#ffc194" },
  { title: "Buoyancy", type: "Art direction", description: "Ideas that stop needing the ground.", accent: "#64e6a8" },
  { title: "Civic Weather", type: "Installation", description: "A mood the whole street shares.", accent: "#e39cff" },
  { title: "Synthetic Bloom", type: "Research", description: "Life arranged by rules we haven't written.", accent: "#fff08a" },
  { title: "Short Horizon", type: "Strategy", description: "Planning for the future that already arrived.", accent: "#5fd9d2" },
  { title: "Grain Depth", type: "Material study", description: "Depth you only find by looking twice.", accent: "#ffb3c6" },
  { title: "Open Border", type: "Campaign", description: "A visual language with nothing to declare.", accent: "#9fb8ff" },
  { title: "Draft City", type: "Speculative design", description: "One map that keeps redrawing itself.", accent: "#bcd98f" },
  { title: "Clear Structure", type: "Architecture", description: "Nothing to hide and nowhere to hide it.", accent: "#ffab8c" },
  { title: "Long Room", type: "Sound design", description: "Acoustics that hold on to every word.", accent: "#b6f0ff" },
  { title: "Second Instinct", type: "Product design", description: "Tools you knew how to use already.", accent: "#caa0f0" },
  { title: "Held Motion", type: "Motion", description: "Stillness that is working very hard.", accent: "#a6f57e" },
  { title: "Hard Noon", type: "Photography", description: "Light with an edge you can feel.", accent: "#ff9f8a" },
]

const trim = (n) => (Math.abs(n) < 1e-6 ? 0 : n)

/** Column-major matrix3d with the Y basis negated (three Y-up -> CSS Y-down). */
function cardMatrix3d (e) {
  return `matrix3d(${[
    trim(e[0]), trim(e[1]), trim(e[2]), trim(e[3]),
    trim(-e[4]), trim(-e[5]), trim(-e[6]), trim(-e[7]),
    trim(e[8]), trim(e[9]), trim(e[10]), trim(e[11]),
    trim(e[12]), trim(e[13]), trim(e[14]), trim(e[15]),
  ].join(',')})`
}

/** Camera inverse with the Y *row* negated. */
function cameraMatrix3d (e) {
  return `matrix3d(${[
    trim(e[0]), trim(-e[1]), trim(e[2]), trim(e[3]),
    trim(e[4]), trim(-e[5]), trim(e[6]), trim(e[7]),
    trim(e[8]), trim(-e[9]), trim(e[10]), trim(e[11]),
    trim(e[12]), trim(-e[13]), trim(e[14]), trim(e[15]),
  ].join(',')})`
}

export class Overlay {
  constructor (root) {
    this.root = root                       // gets `perspective`
    this.stage = document.createElement('div')
    this.stage.className = 'overlay-stage'
    this.root.appendChild(this.stage)
    this.cards = []
    this.lastPerspective = -1
    this._m = new Matrix4()
    this._scale = new Vector3()
  }

  resize (count) {
    while (this.cards.length < count) {
      const el = document.createElement('div')
      el.className = 'card'                 // the query container
      el.innerHTML = `
        <div class="card-inner">
          <header class="card-head">
            <div class="card-slug"><span class="card-index"></span><span class="card-type"></span></div>
            <div class="card-meta"><span>Selected work</span><span class="card-dot"></span><span>2026</span></div>
          </header>
          <div class="card-foot">
            <div class="card-rule"></div>
            <h2 class="card-title"></h2>
            <div class="card-descrow"><p class="card-desc"></p></div>
          </div>
        </div>`
      this.stage.appendChild(el)
      this.cards.push(el)
    }
    while (this.cards.length > count) this.stage.removeChild(this.cards.pop())

    this.cards.forEach((el, i) => {
      const p = PROJECTS[i % PROJECTS.length]
      const index = el.querySelector('.card-index')
      index.textContent = `ILG—${String(i + 1).padStart(2, '0')}`
      index.style.color = p.accent
      el.querySelector('.card-type').textContent = p.type
      el.querySelector('.card-title').textContent = p.title
      el.querySelector('.card-desc').textContent = p.description
    })
  }

  syncCamera (camera, perspective, width, height) {
    if (this.lastPerspective !== perspective) {
      this.root.style.perspective = `${perspective}px`
      this.lastPerspective = perspective
    }
    const inv = camera.matrixWorldInverse.elements
    // The trailing translate only lands correctly because .overlay-stage is
    // full-size, so its transform-origin is the viewport centre and this
    // cancels the implicit -origin shift. (A zero-size stage puts every card a
    // half-viewport too high.)
    this.stage.style.transform =
      `translateZ(${perspective}px)${cameraMatrix3d(inv)}translate(${width / 2}px,${height / 2}px)`
  }

  hide (index) {
    const el = this.cards[index]
    if (el && el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
  }

  place (index, mesh, width, height) {
    const el = this.cards[index]
    if (!el) return
    mesh.updateWorldMatrix(true, false)
    this._m.copy(mesh.matrixWorld)
    this._scale.setFromMatrixScale(this._m)
    if (this._scale.x === 0 || this._scale.y === 0 || this._scale.z === 0) {
      el.style.visibility = 'hidden'
      return
    }
    // Strip the tile scale; the DOM card carries its size in px instead.
    this._m.scale(this._scale.set(1 / this._scale.x, 1 / this._scale.y, 1 / this._scale.z))
    el.style.visibility = 'visible'
    if (el.dataset.w !== String(width) || el.dataset.h !== String(height)) {
      el.style.width = `${width}px`
      el.style.height = `${height}px`
      el.dataset.w = String(width)
      el.dataset.h = String(height)
    }
    el.style.transform = `translate(-50%,-50%)${cardMatrix3d(this._m.elements)}`
  }
}
