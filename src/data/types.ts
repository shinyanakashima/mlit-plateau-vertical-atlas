// Mirrors the attributes written by pipeline/build_atlas.py (see pipeline/atlas/grid.py for conventions).

export type Lod = 'lod1' | 'lod2'

export interface GridMeta {
  epsg: number
  x0: number
  y1: number
  x1: number
  y0: number
  nx: number
  ny: number
  dx: number
  z0: number
  nz: number
  dz: number
}

export interface AtlasAttrs {
  atlas_version: number
  area_id: string
  title: string
  subtitle: string
  synthetic?: boolean
  crs: { horizontal: string; name: string; vertical: string; axis_order: string }
  grid: GridMeta
  corners_lonlat: Record<'nw' | 'ne' | 'se' | 'sw', [number, number]>
  center_lonlat: [number, number]
  enu: {
    enu_to_grid: number[]
    grid_to_enu: number[]
    origin_lonlat: [number, number]
    max_residual_m: number
  }
  display: { height_offset_m: number; base_tp_m: number }
  lods: Record<Lod, string>
  ground: { source: string }
  sources: {
    buildings: string
    license: string
    files: { mesh: string; city_name: string; year: number; spec: string; url: string; dataset_zip?: string }[]
  }
  building_count: number
  generated_at?: string
}

export interface Manifest {
  id: string
  title: string
  subtitle: string
  kind: 'plateau' | 'synthetic'
  zarr: string
  buildings: string
  models: Record<Lod, string>
  ortho: null | { file: string; rectangle: [number, number, number, number]; attribution: string }
  /** absolute-height meshes for the LT11 mansion prototype */
  mansion?: { models: Record<Lod, string>; terrain: string; terrain_info: { base_tp: number } }
}

export interface BuildingInfo {
  id: number
  gmlId: string
  buildingId: string | null
  name: string | null
  alias?: string | null
  usage: string | null
  measuredHeight: number | null
  storeysAbove: number | null
  storeysBelow: number | null
  groundTP: number | null
  topTP: number | null
  lod2TopTP: number | null
  lon: number
  lat: number
  /** largest per-level footprint inside the analysis grid (cells) */
  gridCells?: number
  topLevel?: number | null
}

export interface AreaIndexEntry {
  id: string
  title: string
  subtitle: string
  kind: 'plateau' | 'synthetic'
}
