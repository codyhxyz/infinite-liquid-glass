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

// Verbatim from the original bundle, accent colours included.
export const PROJECTS = [
  { title: "Afterimage", type: "Visual identity", description: "Cities remembered in electric color.", accent: "#d7ff3f" },
  { title: "Night Index", type: "Digital archive", description: "An atlas for life after dark.", accent: "#ff9ad5" },
  { title: "Soft Power", type: "Art direction", description: "A gentler language for bold ideas.", accent: "#8ff7ff" },
  { title: "New Rituals", type: "Campaign", description: "Small gestures for a changing world.", accent: "#ffcc66" },
  { title: "Elsewhere", type: "Spatial identity", description: "A place just beyond the familiar.", accent: "#b9a7ff" },
  { title: "Common Sky", type: "Cultural platform", description: "One horizon, many points of view.", accent: "#a8ffcf" },
  { title: "Future Folklore", type: "Editorial", description: "Old stories in unfamiliar forms.", accent: "#ffad8f" },
  { title: "Open Current", type: "Brand system", description: "Identity built to move and mutate.", accent: "#8fc8ff" },
  { title: "Parallel", type: "Experience", description: "Two worlds sharing one surface.", accent: "#f2ff8f" },
  { title: "Blue Hour", type: "Film title", description: "The city between day and dream.", accent: "#9baeff" },
  { title: "Useful Noise", type: "Publication", description: "Signal found inside the static.", accent: "#ff8fc7" },
  { title: "Tender Machines", type: "Exhibition", description: "Technology with a pulse.", accent: "#a7ffd8" },
  { title: "Unfinished", type: "Type experiment", description: "A living alphabet without an ending.", accent: "#ffd88f" },
  { title: "Outer Office", type: "Workplace", description: "Work designed around being human.", accent: "#b78fff" },
  { title: "Slow Signal", type: "Digital product", description: "Technology at a more human tempo.", accent: "#9ff0ff" },
  { title: "Field Notes", type: "Editorial", description: "Observations from the edge of now.", accent: "#dfff9f" },
  { title: "No Fixed Form", type: "Identity", description: "A system that refuses to stand still.", accent: "#ff9f9f" },
  { title: "Superlocal", type: "Wayfinding", description: "Global energy, one neighborhood.", accent: "#8fffc4" },
  { title: "Low Gravity", type: "Art direction", description: "Ideas with less weight and more lift.", accent: "#c1b1ff" },
  { title: "Public Dream", type: "Installation", description: "A shared space for impossible things.", accent: "#ffbc7c" },
  { title: "Other Nature", type: "Research", description: "New ecologies for synthetic worlds.", accent: "#b4ff79" },
  { title: "Near Future", type: "Strategy", description: "Tomorrow, brought within reach.", accent: "#7fe8ff" },
  { title: "Deep Surface", type: "Material study", description: "More than meets the eye.", accent: "#ff8fba" },
  { title: "Free State", type: "Campaign", description: "A visual language without borders.", accent: "#ffe07f" },
  { title: "Infinite City", type: "Speculative design", description: "One city, endlessly becoming.", accent: "#a88fff" },
  { title: "Glass House", type: "Architecture", description: "Transparency as a way of living.", accent: "#7fffd4" },
  { title: "Echo Chamber", type: "Sound design", description: "Rooms that remember every note.", accent: "#ffb07f" },
  { title: "Second Nature", type: "Product design", description: "Tools that feel already known.", accent: "#9f8fff" },
  { title: "Drift State", type: "Motion", description: "Stillness found inside movement.", accent: "#8fff9f" },
  { title: "Hard Light", type: "Photography", description: "Edges sharp enough to cut night.", accent: "#ff8f8f" },
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
