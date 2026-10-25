import {
  Axis,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  ComponentDatatype,
  CustomShader,
  CustomShaderTranslucencyMode,
  EllipsoidTerrainProvider,
  Geometry,
  GeometryAttribute,
  GeometryInstance,
  HeadingPitchRange,
  ImageryLayer,
  JulianDate,
  LabelCollection,
  LabelStyle,
  Material,
  MaterialAppearance,
  Math as CMath,
  Matrix4,
  Model,
  PointPrimitiveCollection,
  PolylineCollection,
  Primitive,
  PrimitiveType,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  Transforms,
  UniformType,
  UrlTemplateImageryProvider,
  Credit,
  VerticalOrigin,
  HorizontalOrigin,
  Viewer,
  NearFarScalar,
  DistanceDisplayCondition,
} from 'cesium'
import type { Atlas } from '../data/atlas'
import type { Lod } from '../data/types'

export type UpperMode = 'ghost' | 'cut' | 'solid'

export interface GridPick {
  col: number
  row: number
  /** cell index row*nx+col */
  index: number
  e: number
  n: number
}

const SHADER = (translucent: boolean) => `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  float h = fsInput.attributes.positionMC.y;      // glTF is Y-up: model y = height (m)
  float bid = fsInput.attributes.bid;
  vec3 base = mix(vec3(0.70, 0.74, 0.80), vec3(0.93, 0.95, 0.98), clamp(h / u_hmax, 0.0, 1.0));
  if (abs(bid - u_selected) < 0.5) base = vec3(1.0, 0.80, 0.30);
  float d = h - u_slice;
  float band = 1.0 - smoothstep(0.0, 1.6, abs(d));
  base = mix(base, vec3(1.0, 0.47, 0.20), band * 0.95);
  material.diffuse = base;
  ${translucent
    ? 'if (d > 0.0) { material.alpha = u_ghost; material.diffuse = mix(base, vec3(0.55, 0.70, 0.95), 0.35); }'
    : 'if (u_cut > 0.5 && d > 0.0) discard;'}
}
`

function makeShader(translucent: boolean) {
  return new CustomShader({
    uniforms: {
      u_slice: { type: UniformType.FLOAT, value: 0 },
      u_selected: { type: UniformType.FLOAT, value: -1 },
      u_hmax: { type: UniformType.FLOAT, value: 200 },
      u_ghost: { type: UniformType.FLOAT, value: 0.11 },
      u_cut: { type: UniformType.FLOAT, value: 0 },
    },
    translucencyMode: translucent ? CustomShaderTranslucencyMode.TRANSLUCENT : CustomShaderTranslucencyMode.OPAQUE,
    fragmentShaderText: SHADER(translucent),
  })
}

export class AtlasScene {
  readonly viewer: Viewer
  private atlas: Atlas | null = null
  private enuFrame = Matrix4.IDENTITY.clone()
  private model: Model | null = null
  private modelLod: Lod | null = null
  private modelToken = 0
  private shaderGhost = makeShader(true)
  private shaderOpaque = makeShader(false)
  private upper: UpperMode = 'ghost'
  private slicePrim: Primitive | null = null
  private sliceMaterial: Material | null = null
  private sliceLines: PolylineCollection | null = null
  private staticLines: PolylineCollection | null = null
  private markerPoints: PointPrimitiveCollection | null = null
  private markerLabels: LabelCollection | null = null
  private routeLines: PolylineCollection | null = null
  private orthoLayer: ImageryLayer | null = null
  private baseLayer: ImageryLayer | null = null
  private sliceH = 0
  private handler: ScreenSpaceEventHandler
  onHover: ((p: GridPick | null, screen: Cartesian2) => void) | null = null
  onClick: ((p: GridPick | null, screen: Cartesian2) => void) | null = null
  onModelError: ((e: unknown) => void) | null = null

  constructor(container: HTMLElement) {
    this.viewer = new Viewer(container, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      terrainProvider: new EllipsoidTerrainProvider(),
      msaaSamples: 4,
    })
    const v = this.viewer
    v.clock.currentTime = JulianDate.fromIso8601('2026-10-28T02:30:00Z') // 11:30 JST: soft daylight
    v.clock.shouldAnimate = false
    const scene = v.scene
    scene.globe.baseColor = Color.fromCssColorString('#0c111b')
    scene.globe.showGroundAtmosphere = false
    scene.backgroundColor = Color.fromCssColorString('#070a10')
    scene.highDynamicRange = false
    scene.postProcessStages.fxaa.enabled = true
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true
    scene.fog.enabled = false
    scene.screenSpaceCameraController.minimumZoomDistance = 30
    scene.screenSpaceCameraController.maximumZoomDistance = 20000
    ;(v.cesiumWidget.creditContainer as HTMLElement).classList.add('cesium-credits')

    // context base map (online).  If tiles cannot be loaded the bundled aerial photo still shows.
    this.baseLayer = v.imageryLayers.addImageryProvider(new UrlTemplateImageryProvider({
      url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
      minimumLevel: 2,
      maximumLevel: 18,
      credit: new Credit('<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル（全国最新写真）</a>'),
    }))
    this.baseLayer.brightness = 0.45
    this.baseLayer.saturation = 0.35
    this.baseLayer.contrast = 1.05

    this.handler = new ScreenSpaceEventHandler(scene.canvas)
    let pending: Cartesian2 | null = null
    this.handler.setInputAction((m: { endPosition: Cartesian2 }) => {
      if (!pending) {
        requestAnimationFrame(() => {
          const p = pending
          pending = null
          if (p && this.onHover) this.onHover(this.pickGrid(p), p)
        })
      }
      pending = Cartesian2.clone(m.endPosition)
    }, ScreenSpaceEventType.MOUSE_MOVE)
    this.handler.setInputAction((c: { position: Cartesian2 }) => {
      this.onClick?.(this.pickGrid(c.position), c.position)
    }, ScreenSpaceEventType.LEFT_CLICK)
  }

  destroy() {
    this.handler.destroy()
    this.viewer.destroy()
  }

  get currentAtlas() {
    return this.atlas
  }

  async setAtlas(atlas: Atlas, lod: Lod) {
    this.clearAtlas()
    this.atlas = atlas
    const [lon, lat] = atlas.attrs.enu.origin_lonlat
    this.enuFrame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat, 0))
    const hmax = Math.max(...atlas.buildings.map((b) => b.lod2TopTP ?? b.topTP ?? 0), 60)
    for (const s of [this.shaderGhost, this.shaderOpaque]) s.setUniform('u_hmax', atlas.displayHeight(hmax))
    this.addOrtho()
    this.buildSlicePrimitive()
    this.buildStaticFrame()
    this.markerPoints = this.viewer.scene.primitives.add(new PointPrimitiveCollection({ modelMatrix: this.enuFrame }))
    this.markerLabels = this.viewer.scene.primitives.add(new LabelCollection({ modelMatrix: this.enuFrame }))
    this.routeLines = this.viewer.scene.primitives.add(new PolylineCollection({ modelMatrix: this.enuFrame }))
    await this.setLod(lod)
  }

  private clearAtlas() {
    const prims = this.viewer.scene.primitives
    for (const p of [this.model, this.slicePrim, this.sliceLines, this.staticLines, this.markerPoints,
      this.markerLabels, this.routeLines]) {
      if (p) prims.remove(p)
    }
    this.model = null
    this.modelLod = null
    this.slicePrim = null
    this.sliceLines = null
    this.staticLines = null
    this.markerPoints = null
    this.markerLabels = null
    this.routeLines = null
    if (this.orthoLayer) this.viewer.imageryLayers.remove(this.orthoLayer)
    this.orthoLayer = null
  }

  private addOrtho() {
    const a = this.atlas!
    const o = a.manifest.ortho
    if (!o) return
    const provider = new SingleTileImageryProvider({
      url: a.url(o.file),
      rectangle: Rectangle.fromDegrees(...o.rectangle),
      tileWidth: 4096,
      tileHeight: 4096,
      credit: new Credit(`<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">${o.attribution}</a>`),
    })
    this.orthoLayer = this.viewer.imageryLayers.addImageryProvider(provider)
    this.orthoLayer.brightness = 0.62
    this.orthoLayer.saturation = 0.55
    this.orthoLayer.contrast = 1.05
  }

  setImagery(showOrtho: boolean, showBase: boolean) {
    if (this.orthoLayer) this.orthoLayer.show = showOrtho
    if (this.baseLayer) this.baseLayer.show = showBase
  }

  async setLod(lod: Lod) {
    const a = this.atlas
    if (!a || this.modelLod === lod) return
    this.modelLod = lod
    const token = ++this.modelToken
    try {
      const model = await Model.fromGltfAsync({
        url: a.url(a.manifest.models[lod]),
        modelMatrix: this.enuFrame,
        customShader: this.upper === 'ghost' ? this.shaderGhost : this.shaderOpaque,
        backFaceCulling: false,
        // vertices are already in ENU (stored Y-up); keep Cesium from also turning glTF +Z
        // forward into +X, which would rotate the city by 90°.
        upAxis: Axis.Y,
        forwardAxis: Axis.X,
      })
      if (token !== this.modelToken || this.atlas !== a) {
        model.destroy()
        return
      }
      if (this.model) this.viewer.scene.primitives.remove(this.model)
      this.model = this.viewer.scene.primitives.add(model)
    } catch (e) {
      this.onModelError?.(e)
    }
  }

  setUpperMode(mode: UpperMode) {
    this.upper = mode
    this.shaderOpaque.setUniform('u_cut', mode === 'cut' ? 1 : 0)
    if (this.model) this.model.customShader = mode === 'ghost' ? this.shaderGhost : this.shaderOpaque
  }

  setSelectedBuilding(id: number | null) {
    for (const s of [this.shaderGhost, this.shaderOpaque]) s.setUniform('u_selected', id ?? -1)
  }

  // --- slice plane -----------------------------------------------------------------------
  private gridCornerEnu() {
    const a = this.atlas!
    const { nx, ny } = a.grid
    return {
      nw: a.gridToEnu(0, 0),
      ne: a.gridToEnu(nx, 0),
      se: a.gridToEnu(nx, ny),
      sw: a.gridToEnu(0, ny),
    }
  }

  private buildSlicePrimitive() {
    const c = this.gridCornerEnu()
    // vertices: sw, se, ne, nw (canvas row 0 = north = texture top, Cesium flips Y on upload)
    const pos = new Float64Array([...c.sw, 0, ...c.se, 0, ...c.ne, 0, ...c.nw, 0])
    const st = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
    const normal = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
    const geometry = new Geometry({
      attributes: {
        position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos }),
        st: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: st }),
        normal: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: normal }),
      } as never,
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(Array.from(pos)),
    })
    const blank = document.createElement('canvas')
    blank.width = blank.height = 1
    this.sliceMaterial = new Material({
      fabric: { type: 'Image', uniforms: { image: blank, color: new Color(1, 1, 1, 1) } },
      minificationFilter: TextureMinificationFilter.NEAREST,
      magnificationFilter: TextureMagnificationFilter.NEAREST,
      translucent: true,
    })
    this.slicePrim = this.viewer.scene.primitives.add(new Primitive({
      geometryInstances: new GeometryInstance({ geometry }),
      appearance: new MaterialAppearance({
        material: this.sliceMaterial,
        translucent: true,
        flat: true,
        faceForward: true,
        closed: false,
        materialSupport: MaterialAppearance.MaterialSupport.TEXTURED,
      }),
      asynchronous: false,
      modelMatrix: this.enuFrame,
    }))
    const lines = new PolylineCollection({ modelMatrix: this.enuFrame })
    const ring = [c.nw, c.ne, c.se, c.sw, c.nw].map(([e, n]) => new Cartesian3(e, n, 0))
    lines.add({ positions: ring, width: 2.5, material: Material.fromType('Color', { color: Color.fromCssColorString('#ffb27a') }) })
    this.sliceLines = this.viewer.scene.primitives.add(lines)
  }

  private buildStaticFrame() {
    const a = this.atlas!
    const c = this.gridCornerEnu()
    const lines = new PolylineCollection({ modelMatrix: this.enuFrame })
    const top = a.displayHeight(a.levelCenter(a.grid.nz - 1) + a.grid.dz / 2)
    // one Material per polyline: Cesium destroys a polyline's material together with it
    const mat = () => Material.fromType('Color', { color: Color.fromCssColorString('#9fb4d8').withAlpha(0.35) })
    const ring = [c.nw, c.ne, c.se, c.sw, c.nw]
    lines.add({ positions: ring.map(([e, n]) => new Cartesian3(e, n, 0.3)), width: 1.5, material: mat() })
    lines.add({ positions: ring.map(([e, n]) => new Cartesian3(e, n, top)), width: 1, material: mat() })
    for (const [e, n] of ring.slice(0, 4)) {
      lines.add({ positions: [new Cartesian3(e, n, 0.3), new Cartesian3(e, n, top)], width: 1, material: mat() })
    }
    this.staticLines = this.viewer.scene.primitives.add(lines)
  }

  setSliceTexture(canvas: HTMLCanvasElement) {
    if (this.sliceMaterial) this.sliceMaterial.uniforms.image = canvas
  }

  setSliceOpacity(alpha: number) {
    if (this.sliceMaterial) this.sliceMaterial.uniforms.color = new Color(1, 1, 1, alpha)
  }

  /** Move the slice plane to a T.P. elevation. */
  setSliceElevation(tp: number) {
    const a = this.atlas
    if (!a) return
    const h = a.displayHeight(tp)
    this.sliceH = h
    const m = Matrix4.multiplyByTranslation(this.enuFrame, new Cartesian3(0, 0, h), new Matrix4())
    if (this.slicePrim) this.slicePrim.modelMatrix = m
    if (this.sliceLines) this.sliceLines.modelMatrix = m
    for (const s of [this.shaderGhost, this.shaderOpaque]) s.setUniform('u_slice', h)
  }

  // --- markers and paths -------------------------------------------------------------------
  private cellEnu(index: number): [number, number] {
    const a = this.atlas!
    const nx = a.grid.nx
    const col = index % nx
    const row = Math.floor(index / nx)
    return a.gridToEnu(col + 0.5, row + 0.5)
  }

  setMarkers(markers: { index: number; label: string; color: string; tp: number }[]) {
    const pts = this.markerPoints
    const labels = this.markerLabels
    const a = this.atlas
    if (!pts || !labels || !a) return
    pts.removeAll()
    labels.removeAll()
    for (const m of markers) {
      const [e, n] = this.cellEnu(m.index)
      const pos = new Cartesian3(e, n, a.displayHeight(m.tp) + 0.6)
      pts.add({ position: pos, pixelSize: 13, color: Color.fromCssColorString(m.color), outlineColor: Color.WHITE, outlineWidth: 2.5, disableDepthTestDistance: Number.POSITIVE_INFINITY })
      labels.add({
        position: pos, text: m.label, font: '700 15px "Noto Sans JP", sans-serif', fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString('#0b0f17'), outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, -16), verticalOrigin: VerticalOrigin.BOTTOM, horizontalOrigin: HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(300, 1.1, 3000, 0.8),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 1e5),
      })
    }
  }

  /** 2D path on the current slice (cell indices) and/or a 3D route ([col,row,level] + T.P.). */
  setPaths(path2d: number[] | null, tp: number, route3d: { cells: [number, number, number][]; tpOf: (k: number) => number } | null) {
    const lines = this.routeLines
    const a = this.atlas
    if (!lines || !a) return
    lines.removeAll()
    if (path2d && path2d.length > 1) {
      const h = a.displayHeight(tp) + 0.8
      lines.add({
        positions: path2d.map((i) => { const [e, n] = this.cellEnu(i); return new Cartesian3(e, n, h) }),
        width: 6,
        material: Material.fromType('PolylineGlow', { color: Color.fromCssColorString('#7ef0c0'), glowPower: 0.25, taperPower: 1 }),
      })
    }
    if (route3d && route3d.cells.length > 1) {
      lines.add({
        positions: route3d.cells.map(([c, r, k]) => {
          const [e, n] = a.gridToEnu(c + 0.5, r + 0.5)
          return new Cartesian3(e, n, a.displayHeight(route3d.tpOf(k)))
        }),
        width: 7,
        material: Material.fromType('PolylineGlow', { color: Color.fromCssColorString('#ffd166'), glowPower: 0.3, taperPower: 1 }),
      })
    }
  }

  // --- picking -----------------------------------------------------------------------------
  pickGrid(screen: Cartesian2): GridPick | null {
    const a = this.atlas
    if (!a) return null
    const ray = this.viewer.camera.getPickRay(screen)
    if (!ray) return null
    const inv = Matrix4.inverseTransformation(this.enuFrame, new Matrix4())
    const o = Matrix4.multiplyByPoint(inv, ray.origin, new Cartesian3())
    const d = Matrix4.multiplyByPointAsVector(inv, ray.direction, new Cartesian3())
    if (Math.abs(d.z) < 1e-9) return null
    const t = (this.sliceH - o.z) / d.z
    if (t < 0) return null
    const e = o.x + t * d.x
    const n = o.y + t * d.y
    const [fc, fr] = a.enuToGrid(e, n)
    const col = Math.floor(fc)
    const row = Math.floor(fr)
    if (col < 0 || row < 0 || col >= a.grid.nx || row >= a.grid.ny) return null
    return { col, row, index: row * a.grid.nx + col, e, n }
  }

  // --- camera ------------------------------------------------------------------------------
  flyHome(duration = 1.6) {
    const a = this.atlas
    if (!a) return
    const [lon, lat] = a.attrs.enu.origin_lonlat
    const size = a.grid.nx * a.grid.dx
    const target = Cartesian3.fromDegrees(lon, lat, a.displayHeight(a.attrs.display.base_tp_m) + size * 0.08)
    this.viewer.camera.flyToBoundingSphere(new BoundingSphere(target, size * 0.5), {
      offset: new HeadingPitchRange(CMath.toRadians(-62), CMath.toRadians(-27), size * 1.85),
      duration,
    })
  }

  viewTop(duration = 1.2) {
    const a = this.atlas
    if (!a) return
    const [lon, lat] = a.attrs.enu.origin_lonlat
    const size = a.grid.nx * a.grid.dx
    this.viewer.camera.flyToBoundingSphere(new BoundingSphere(Cartesian3.fromDegrees(lon, lat, this.sliceH), size * 0.5), {
      offset: new HeadingPitchRange(0, CMath.toRadians(-89.9), size * 1.9),
      duration,
    })
  }
}
