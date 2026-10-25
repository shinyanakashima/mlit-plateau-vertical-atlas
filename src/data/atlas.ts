import * as zarr from 'zarrita'
import type { AreaIndexEntry, AtlasAttrs, BuildingInfo, Lod, Manifest } from './types'

/** Root of the static data (public/data).  Point VITE_DATA_BASE_URL at R2 / a CDN to move the data out. */
export function dataBaseUrl(): string {
  const env = import.meta.env.VITE_DATA_BASE_URL as string | undefined
  const base = env && env.length ? env : 'data/'
  return new URL(base.endsWith('/') ? base : `${base}/`, document.baseURI).href
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`)
  return (await r.json()) as T
}

export async function loadIndex(): Promise<{ default: string; areas: AreaIndexEntry[] }> {
  return fetchJson(`${dataBaseUrl()}index.json`)
}

type U8Array = zarr.Array<'uint8', zarr.FetchStore>
type U16Array = zarr.Array<'uint16', zarr.FetchStore>

export class Atlas {
  readonly base: string
  readonly manifest: Manifest
  readonly attrs: AtlasAttrs
  readonly buildings: BuildingInfo[]
  readonly ground: Float32Array
  /** 1 where PLATEAU buildings were surveyed (null for datasets without the layer) */
  readonly coverage: Uint8Array | null
  private readonly occArrays: Record<Lod, U8Array>
  private readonly bidArrays: Record<Lod, U16Array>
  private readonly levelCache = new Map<string, Promise<Uint8Array>>()
  private readonly bidCache = new Map<string, Promise<Uint16Array>>()
  /** number of chunk requests issued (for the "Zarr chunk" counter in the UI) */
  chunkRequests = 0

  private constructor(base: string, manifest: Manifest, attrs: AtlasAttrs, buildings: BuildingInfo[],
    ground: Float32Array, occ: Record<Lod, U8Array>, bid: Record<Lod, U16Array>, coverage: Uint8Array | null) {
    this.base = base
    this.manifest = manifest
    this.attrs = attrs
    this.buildings = buildings
    this.ground = ground
    this.coverage = coverage
    this.occArrays = occ
    this.bidArrays = bid
  }

  static async open(areaId: string): Promise<Atlas> {
    const base = `${dataBaseUrl()}${areaId}/`
    const manifest = await fetchJson<Manifest>(`${base}manifest.json`)
    const store = new zarr.FetchStore(`${base}${manifest.zarr}`)
    const root = await zarr.open.v3(store, { kind: 'group' })
    const attrs = root.attrs as unknown as AtlasAttrs
    const [o1, o2, b1, b2, g, buildings] = await Promise.all([
      zarr.open.v3(root.resolve('lod1/occupancy'), { kind: 'array' }),
      zarr.open.v3(root.resolve('lod2/occupancy'), { kind: 'array' }),
      zarr.open.v3(root.resolve('lod1/building'), { kind: 'array' }),
      zarr.open.v3(root.resolve('lod2/building'), { kind: 'array' }),
      zarr.open.v3(root.resolve('ground'), { kind: 'array' }),
      fetchJson<BuildingInfo[]>(`${base}${manifest.buildings}`),
    ])
    for (const a of [o1, o2]) if (!a.is('uint8')) throw new Error('occupancy must be uint8')
    for (const a of [b1, b2]) if (!a.is('uint16')) throw new Error('building index must be uint16')
    if (!g.is('float32')) throw new Error('ground must be float32')
    const groundChunk = await zarr.get(g, null)
    // optional layer (added for the LT11 mansion areas)
    let coverage: Uint8Array | null = null
    try {
      const c = await zarr.open.v3(root.resolve('coverage'), { kind: 'array' })
      if (c.is('uint8')) coverage = (await zarr.get(c, null)).data as Uint8Array
    } catch {
      coverage = null
    }
    return new Atlas(base, manifest, attrs, buildings, groundChunk.data as Float32Array,
      { lod1: o1 as U8Array, lod2: o2 as U8Array }, { lod1: b1 as U16Array, lod2: b2 as U16Array }, coverage)
  }

  get grid() {
    return this.attrs.grid
  }

  /** T.P. elevation of the centre of level k */
  levelCenter(k: number): number {
    return this.grid.z0 + (k + 0.5) * this.grid.dz
  }

  levelOf(tp: number): number {
    const k = Math.floor((tp - this.grid.z0) / this.grid.dz)
    return Math.min(Math.max(k, 0), this.grid.nz - 1)
  }

  isLevelLoaded(lod: Lod, k: number): boolean {
    return this.levelCache.has(`${lod}/${k}`)
  }

  level(lod: Lod, k: number): Promise<Uint8Array> {
    const key = `${lod}/${k}`
    let p = this.levelCache.get(key)
    if (!p) {
      this.chunkRequests++
      p = zarr.get(this.occArrays[lod], [k, null, null]).then((c) => c.data as Uint8Array)
      p.catch(() => this.levelCache.delete(key))
      this.levelCache.set(key, p)
    }
    return p
  }

  buildingLevel(lod: Lod, k: number): Promise<Uint16Array> {
    const key = `${lod}/${k}`
    let p = this.bidCache.get(key)
    if (!p) {
      this.chunkRequests++
      p = zarr.get(this.bidArrays[lod], [k, null, null]).then((c) => c.data as Uint16Array)
      p.catch(() => this.bidCache.delete(key))
      this.bidCache.set(key, p)
    }
    return p
  }

  /** Load the whole volume level by level (nearest levels first) and report progress. */
  async volume(lod: Lod, around: number, onProgress?: (loaded: number, total: number) => void,
    concurrency = 6): Promise<Uint8Array> {
    const { nx, ny, nz } = this.grid
    const out = new Uint8Array(nx * ny * nz)
    const order = Array.from({ length: nz }, (_, k) => k).sort((a, b) => Math.abs(a - around) - Math.abs(b - around))
    let done = 0
    let next = 0
    const worker = async () => {
      while (next < order.length) {
        const k = order[next++]
        const lv = await this.level(lod, k)
        out.set(lv, k * nx * ny)
        done++
        onProgress?.(done, nz)
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    return out
  }

  url(file: string): string {
    return `${this.base}${file}`
  }

  building(id: number): BuildingInfo | undefined {
    return id > 0 ? this.buildings[id - 1] : undefined
  }

  /** fractional grid coordinates (col,row) from local ENU metres */
  enuToGrid(e: number, n: number): [number, number] {
    const a = this.attrs.enu.enu_to_grid
    return [a[0] * e + a[1] * n + a[2], a[3] * e + a[4] * n + a[5]]
  }

  gridToEnu(col: number, row: number): [number, number] {
    const a = this.attrs.enu.grid_to_enu
    return [a[0] * col + a[1] * row + a[2], a[3] * col + a[4] * row + a[5]]
  }

  /** Cesium (ellipsoidal, no terrain) height of a T.P. elevation */
  displayHeight(tp: number): number {
    return tp + this.attrs.display.height_offset_m
  }
}
