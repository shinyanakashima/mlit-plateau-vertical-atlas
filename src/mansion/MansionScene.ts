import {
  Axis,
  BoundingSphere,
  BoxGeometry,
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  CustomShader,
  CustomShaderTranslucencyMode,
  DirectionalLight,
  Geometry,
  GeometryAttribute,
  GeometryInstance,
  HeadingPitchRange,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Material,
  MaterialAppearance,
  Math as CMath,
  Matrix4,
  Model,
  PerInstanceColorAppearance,
  PolylineCollection,
  Primitive,
  PrimitiveType,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  Transforms,
  UniformType,
  VertexFormat,
  VerticalOrigin,
  Viewer,
} from 'cesium'
import type { Atlas } from '../data/atlas'
import type { Lod } from '../data/types'
import { FLOOR_M, floorLabel, floorRange } from './floors'

/** Where the "model room" sits on the (hidden) globe; only the local frame matters. */
const SHOWROOM = Cartesian3.fromDegrees(139.6, 35.66, 0)
const GAP = 150

const BUILDING_SHADER = (translucent: boolean) => `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  float h = fsInput.attributes.positionMC.y;           // glTF Y-up: absolute T.P. height
  vec3 base = mix(vec3(0.78, 0.81, 0.86), vec3(0.95, 0.96, 0.98), clamp(h / 200.0, 0.0, 1.0));
  float fl = fract(h / ${FLOOR_M.toFixed(1)});
  float line = 1.0 - smoothstep(0.0, 0.05, min(fl, 1.0 - fl));
  base *= 1.0 - 0.22 * line;                            // a line every virtual floor (10 m)
  float inBand = step(u_lo, h) * step(h, u_hi);
  base = mix(base, vec3(0.96, 0.80, 0.46), inBand * 0.9);
  material.diffuse = base;
  ${translucent ? 'if (h > u_hi) { material.alpha = 0.22; }' : ''}
}
`

const TERRAIN_SHADER = `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  float h = fsInput.attributes.positionMC.y;
  float part = fsInput.attributes.part;
  float inBand = step(u_lo, h) * step(h, u_hi);
  if (part < 0.5) {
    material.diffuse = material.diffuse * 0.8 + vec3(0.03, 0.03, 0.02);
    material.diffuse = mix(material.diffuse, vec3(0.96, 0.80, 0.46), inBand * 0.55);
  } else {
    float f = floor(h / ${FLOOR_M.toFixed(1)});
    vec3 soil = mod(f, 2.0) < 1.0 ? vec3(0.40, 0.30, 0.21) : vec3(0.47, 0.36, 0.25);
    float fl = fract(h / ${FLOOR_M.toFixed(1)});
    float line = 1.0 - smoothstep(0.0, 0.03, min(fl, 1.0 - fl));
    soil *= 1.0 - 0.35 * line;
    material.diffuse = mix(soil, vec3(0.90, 0.74, 0.42), inBand * 0.7);
  }
}
`

function shader(text: string, translucent: boolean) {
  return new CustomShader({
    uniforms: {
      u_lo: { type: UniformType.FLOAT, value: 0 },
      u_hi: { type: UniformType.FLOAT, value: 10 },
    },
    translucencyMode: translucent ? CustomShaderTranslucencyMode.TRANSLUCENT : CustomShaderTranslucencyMode.OPAQUE,
    fragmentShaderText: text,
  })
}

interface Slot {
  atlas: Atlas
  offsetX: number
  frame: Matrix4
  building: Model | null
  terrain: Model | null
  plane: Primitive
  material: Material
  label: LabelCollection
}

export class MansionScene {
  readonly viewer: Viewer
  private readonly frame = Transforms.eastNorthUpToFixedFrame(SHOWROOM)
  private slots: Slot[] = []
  private readonly bShader = shader(BUILDING_SHADER(false), false)
  private readonly tShader = shader(TERRAIN_SHADER, false)
  private ruler: PolylineCollection | null = null
  private rulerLabels: LabelCollection | null = null
  private slab: Primitive | null = null
  private maxTop = 200
  private elevation = 75
  private floor = 8
  private lod: Lod = 'lod2'
  onError: ((e: unknown) => void) | null = null

  constructor(container: HTMLElement) {
    this.viewer = new Viewer(container, {
      baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
      infoBox: false, selectionIndicator: false, msaaSamples: 4,
    })
    const s = this.viewer.scene
    s.globe.show = false
    if (s.skyBox) s.skyBox.show = false
    if (s.skyAtmosphere) s.skyAtmosphere.show = false
    if (s.sun) s.sun.show = false
    if (s.moon) s.moon.show = false
    s.backgroundColor = Color.fromCssColorString('#0b0f18')
    s.fog.enabled = false
    s.postProcessStages.fxaa.enabled = true
    s.screenSpaceCameraController.enableCollisionDetection = false
    s.screenSpaceCameraController.minimumZoomDistance = 50
    s.screenSpaceCameraController.maximumZoomDistance = 6000
    // a fixed "studio" light from the front-left, slightly above
    const dir = Matrix4.multiplyByPointAsVector(this.frame, new Cartesian3(0.55, 0.75, -0.45), new Cartesian3())
    s.light = new DirectionalLight({ direction: Cartesian3.normalize(dir, dir), intensity: 2.2 })
    ;(this.viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'
  }

  destroy() {
    this.viewer.destroy()
  }

  async setAreas(areas: Atlas[], lod: Lod) {
    for (const sl of this.slots) {
      for (const p of [sl.building, sl.terrain, sl.plane, sl.label]) if (p) this.viewer.scene.primitives.remove(p)
    }
    this.slots = []
    this.lod = lod
    const sizes = areas.map((a) => a.grid.nx * a.grid.dx)
    const total = sizes.reduce((x, y) => x + y, 0) + GAP * (areas.length - 1)
    let x = -total / 2
    this.maxTop = 0
    for (const [i, a] of areas.entries()) {
      const offsetX = x + sizes[i] / 2
      x += sizes[i] + GAP
      const frame = Matrix4.multiplyByTranslation(this.frame, new Cartesian3(offsetX, 0, 0), new Matrix4())
      const { plane, material } = this.makePlane(a, frame)
      const label = this.viewer.scene.primitives.add(new LabelCollection({ modelMatrix: frame }))
      const slot: Slot = { atlas: a, offsetX, frame, building: null, terrain: null, plane, material, label }
      this.slots.push(slot)
      this.maxTop = Math.max(this.maxTop, ...a.buildings.map((b) => b.lod2TopTP ?? b.topTP ?? 0))
    }
    this.buildRuler()
    this.refreshFloor()
    this.flyHome()
    await Promise.all(this.slots.map((sl) => this.loadModels(sl)))
  }

  private refreshFloor() {
    this.setFloor(this.floor, this.elevation, true)
  }

  private async loadModels(slot: Slot) {
    const m = slot.atlas.manifest.mansion
    if (!m) return
    try {
      const [terrain, building] = await Promise.all([
        Model.fromGltfAsync({ url: slot.atlas.url(m.terrain), modelMatrix: slot.frame, customShader: this.tShader, upAxis: Axis.Y, forwardAxis: Axis.X, backFaceCulling: false }),
        Model.fromGltfAsync({ url: slot.atlas.url(m.models[this.lod]), modelMatrix: slot.frame, customShader: this.bShader, upAxis: Axis.Y, forwardAxis: Axis.X, backFaceCulling: false }),
      ])
      if (!this.slots.includes(slot)) {
        terrain.destroy()
        building.destroy()
        return
      }
      slot.terrain = this.viewer.scene.primitives.add(terrain)
      slot.building = this.viewer.scene.primitives.add(building)
    } catch (e) {
      this.onError?.(e)
    }
  }

  async setLod(lod: Lod) {
    if (lod === this.lod) return
    this.lod = lod
    for (const slot of this.slots) {
      const m = slot.atlas.manifest.mansion
      if (!m) continue
      try {
        const building = await Model.fromGltfAsync({ url: slot.atlas.url(m.models[lod]), modelMatrix: slot.frame, customShader: this.bShader, upAxis: Axis.Y, forwardAxis: Axis.X, backFaceCulling: false })
        if (slot.building) this.viewer.scene.primitives.remove(slot.building)
        slot.building = this.viewer.scene.primitives.add(building)
      } catch (e) {
        this.onError?.(e)
      }
    }
  }

  private makePlane(a: Atlas, frame: Matrix4) {
    const { nx, ny } = a.grid
    const c = [a.gridToEnu(0, ny), a.gridToEnu(nx, ny), a.gridToEnu(nx, 0), a.gridToEnu(0, 0)] // sw se ne nw
    const pos = new Float64Array(c.flatMap(([e, n]) => [e, n, 0]))
    const geometry = new Geometry({
      attributes: {
        position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos }),
        st: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) }),
        normal: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]) }),
      } as never,
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(Array.from(pos)),
    })
    const blank = document.createElement('canvas')
    blank.width = blank.height = 1
    const material = new Material({
      fabric: { type: 'Image', uniforms: { image: blank, color: new Color(1, 1, 1, 0.92) } },
      minificationFilter: TextureMinificationFilter.NEAREST,
      magnificationFilter: TextureMagnificationFilter.NEAREST,
      translucent: true,
    })
    const plane = this.viewer.scene.primitives.add(new Primitive({
      geometryInstances: new GeometryInstance({ geometry }),
      appearance: new MaterialAppearance({ material, translucent: true, flat: true, faceForward: true, materialSupport: MaterialAppearance.MaterialSupport.TEXTURED }),
      asynchronous: false,
      modelMatrix: frame,
    }))
    return { plane, material }
  }

  setTextures(canvases: (HTMLCanvasElement | null)[]) {
    canvases.forEach((c, i) => { if (c && this.slots[i]) this.slots[i].material.uniforms.image = c })
  }

  private buildRuler() {
    this.updateRuler()
  }

  /** Rebuild the floor ruler (new collections each time: cheap, and avoids mutating in-flight buckets). */
  private updateRuler() {
    const prims = this.viewer.scene.primitives
    if (this.ruler) prims.remove(this.ruler)
    if (this.rulerLabels) prims.remove(this.rulerLabels)
    this.ruler = null
    this.rulerLabels = null
    if (!this.slots.length) return
    const r: PolylineCollection = prims.add(new PolylineCollection({ modelMatrix: this.frame }))
    const l: LabelCollection = prims.add(new LabelCollection({ modelMatrix: this.frame }))
    this.ruler = r
    this.rulerLabels = l
    const top = Math.ceil((this.maxTop + 5) / FLOOR_M) * FLOOR_M
    const x = (this.slots[0].offsetX + this.slots[this.slots.length - 1].offsetX) / 2
    const y = -this.slots[0].atlas.grid.ny * this.slots[0].atlas.grid.dx / 2
    // one Material per polyline: Cesium destroys a polyline's material together with it
    const gray = () => Material.fromType('Color', { color: Color.fromCssColorString('#7d889e').withAlpha(0.7) })
    const hot = () => Material.fromType('Color', { color: Color.fromCssColorString('#ffcf8a') })
    r.add({ positions: [new Cartesian3(x, y, 0), new Cartesian3(x, y, top)], width: 2, material: gray() })
    const [lo, hi] = floorRange(this.floor)
    for (let h = 0; h <= top; h += FLOOR_M) {
      r.add({ positions: [new Cartesian3(x - 14, y, h), new Cartesian3(x + 14, y, h)], width: 1.5, material: gray() })
      if (h < top) {
        const f = h / FLOOR_M + 1
        const on = f === this.floor
        if (!on && f !== 1 && f % 5 !== 0) continue
        l.add({
          position: new Cartesian3(x + 18, y, h + FLOOR_M / 2), text: floorLabel(f),
          font: on ? '700 17px "Noto Sans JP", sans-serif' : '500 12px "Noto Sans JP", sans-serif',
          fillColor: on ? Color.fromCssColorString('#ff9a5c') : Color.fromCssColorString('#a9b3c6'),
          outlineColor: Color.fromCssColorString('#0b0f18'), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        })
      }
    }
    r.add({ positions: [new Cartesian3(x, y, lo), new Cartesian3(x, y, hi)], width: 6, material: hot() })
  }

  private updateSlab() {
    const prims = this.viewer.scene.primitives
    if (this.slab) prims.remove(this.slab)
    if (!this.slots.length) return
    const first = this.slots[0]
    const last = this.slots[this.slots.length - 1]
    const w = last.offsetX - first.offsetX + first.atlas.grid.nx * first.atlas.grid.dx + 40
    const d = first.atlas.grid.ny * first.atlas.grid.dx + 40
    const [lo] = floorRange(this.floor)
    const cx = (first.offsetX + last.offsetX) / 2
    this.slab = prims.add(new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: BoxGeometry.fromDimensions({ dimensions: new Cartesian3(w, d, FLOOR_M), vertexFormat: VertexFormat.POSITION_AND_NORMAL }),
        modelMatrix: Matrix4.multiplyByTranslation(this.frame, new Cartesian3(cx, 0, lo + FLOOR_M / 2), new Matrix4()),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString('#ff9a5c').withAlpha(0.07)) },
      }),
      appearance: new PerInstanceColorAppearance({ translucent: true, closed: true }),
      asynchronous: false,
    }))
  }

  private updateLabels() {
    const small = this.viewer.canvas.clientWidth < 600
    for (const s of this.slots) {
      s.label.removeAll()
      const a = s.atlas
      const half = (a.grid.ny * a.grid.dx) / 2
      const g = a.attrs.title
      const ground = medianGround(a)
      // name plates in front of each block, on the showroom floor
      s.label.add({
        position: new Cartesian3(0, -half - 30, 0),
        text: g, font: `700 ${small ? 14 : 22}px "Noto Sans JP", sans-serif`, fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString('#0b0f18'), outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.TOP,
        pixelOffset: new Cartesian2(0, 6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      })
      s.label.add({
        position: new Cartesian3(0, -half - 30, 0),
        text: `地面 海抜 約${Math.round(ground)}m（${floorLabel(Math.floor(ground / FLOOR_M) + 1)}）`,
        font: `500 ${small ? 10 : 14}px "Noto Sans JP", sans-serif`, fillColor: Color.fromCssColorString('#d7b48a'),
        outlineColor: Color.fromCssColorString('#0b0f18'), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.TOP,
        pixelOffset: new Cartesian2(0, small ? 24 : 36),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      })
    }
  }

  /** Show a floor: highlight its band, put the section planes at the sampled elevation. */
  setFloor(floor: number, elevation: number, force = false) {
    const changed = force || floor !== this.floor || !this.slab
    this.floor = floor
    this.elevation = elevation
    const [lo, hi] = floorRange(floor)
    for (const sh of [this.bShader, this.tShader]) {
      sh.setUniform('u_lo', lo)
      sh.setUniform('u_hi', hi)
    }
    for (const s of this.slots) {
      s.plane.modelMatrix = Matrix4.multiplyByTranslation(s.frame, new Cartesian3(0, 0, elevation), new Matrix4())
    }
    if (changed) {
      this.updateRuler()
      this.updateSlab()
      this.updateLabels()
    }
  }

  /** Orbit camera around the model room (the globe is hidden, so orbit the local frame). */
  flyHome() {
    if (!this.slots.length) return
    const last = this.slots[this.slots.length - 1]
    const width = last.offsetX * 2 + last.atlas.grid.nx * last.atlas.grid.dx
    const target = Matrix4.multiplyByTranslation(this.frame, new Cartesian3(0, 0, 95), new Matrix4())
    this.viewer.camera.lookAtTransform(target, new HeadingPitchRange(CMath.toRadians(-4), CMath.toRadians(-17), width * 1.2))
  }

  /** Screen position → grid cell of slot i on the section plane (for clicks in the 3D view). */
  pick(screen: Cartesian2): { slot: number; index: number } | null {
    const ray = this.viewer.camera.getPickRay(screen)
    if (!ray) return null
    for (const [i, s] of this.slots.entries()) {
      const inv = Matrix4.inverseTransformation(s.frame, new Matrix4())
      const o = Matrix4.multiplyByPoint(inv, ray.origin, new Cartesian3())
      const d = Matrix4.multiplyByPointAsVector(inv, ray.direction, new Cartesian3())
      if (Math.abs(d.z) < 1e-9) continue
      const t = (this.elevation - o.z) / d.z
      if (t < 0) continue
      const [fc, fr] = s.atlas.enuToGrid(o.x + t * d.x, o.y + t * d.y)
      const col = Math.floor(fc)
      const row = Math.floor(fr)
      if (col >= 0 && row >= 0 && col < s.atlas.grid.nx && row < s.atlas.grid.ny) return { slot: i, index: row * s.atlas.grid.nx + col }
    }
    return null
  }
}

export function medianGround(a: Atlas): number {
  const v = Array.from(a.ground).filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
  return v.length ? v[Math.floor(v.length / 2)] : 0
}
