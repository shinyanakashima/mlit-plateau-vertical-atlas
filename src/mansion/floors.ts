// "東京は何階建て？" — virtual floors of absolute elevation and their horizontal sections.
// Pure functions only (tested in floors.test.ts).

/** Height of one virtual floor (m of absolute elevation, T.P.). */
export const FLOOR_M = 10

/** Virtual floor number of an absolute elevation: 1F = [0, 10) m, 2F = [10, 20) m … B1F = [-10, 0) m. */
export function floorOf(elevation: number): number {
  const f = Math.floor(elevation / FLOOR_M)
  return f >= 0 ? f + 1 : f // no "0F": -1 = B1F
}

export function floorLabel(floor: number): string {
  return floor >= 1 ? `${floor}F` : `B${-floor}F`
}

/** [bottom, top) elevation range of a floor. */
export function floorRange(floor: number): [number, number] {
  const lo = floor >= 1 ? (floor - 1) * FLOOR_M : floor * FLOOR_M
  return [lo, lo + FLOOR_M]
}

/** Representative elevation sampled for a floor: the middle of the band (8F → 75 m). */
export function representativeElevation(floor: number): number {
  const [lo, hi] = floorRange(floor)
  return (lo + hi) / 2
}

export const CLASS_FREE = 0
export const CLASS_BUILDING = 1
export const CLASS_GROUND = 2
export const CLASS_NODATA = 3
export type CellClass = typeof CLASS_FREE | typeof CLASS_BUILDING | typeof CLASS_GROUND | typeof CLASS_NODATA

export const CLASS_NAMES = ['空室（自由空間）', '建物', '地盤', '未整備・判定不能'] as const

export interface SectionInput {
  /** occupancy of the level containing the sampled elevation (0 free, 1 building, 255 not judged) */
  occupancy: Uint8Array
  /** ground elevation (T.P. m) per cell, NaN where no DEM */
  ground: Float32Array
  /** 1 where PLATEAU buildings were surveyed */
  coverage: Uint8Array | null
  /** sampled elevation (T.P. m) */
  elevation: number
}

/**
 * Classify every cell of a horizontal section into building / ground / free / no-data.
 * Ground is decided by the DEM (elevation below the ground surface), buildings by the PLATEAU
 * voxels, and cells without DEM or outside the PLATEAU survey are "no data" — never "free".
 */
export function classifySection({ occupancy, ground, coverage, elevation }: SectionInput): Uint8Array {
  const n = occupancy.length
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const g = ground[i]
    if (Number.isNaN(g) || (coverage && !coverage[i])) out[i] = CLASS_NODATA
    else if (elevation < g) out[i] = CLASS_GROUND
    else if (occupancy[i] === 1) out[i] = CLASS_BUILDING
    else if (occupancy[i] === 0) out[i] = CLASS_FREE
    else out[i] = CLASS_NODATA
  }
  return out
}

export interface SectionStats {
  free: number
  building: number
  ground: number
  nodata: number
  /** cells that can be judged (free + building + ground) */
  judged: number
  /** virtual vacancy rate = free / judged × 100 (area of the representative section) */
  vacancy: number | null
  buildingShare: number | null
  groundShare: number | null
}

export function sectionStats(classes: Uint8Array): SectionStats {
  const c = [0, 0, 0, 0]
  for (let i = 0; i < classes.length; i++) c[classes[i]]++
  const judged = c[0] + c[1] + c[2]
  const pct = (v: number) => (judged ? (v / judged) * 100 : null)
  return {
    free: c[0], building: c[1], ground: c[2], nodata: c[3], judged,
    vacancy: pct(c[0]), buildingShare: pct(c[1]), groundShare: pct(c[2]),
  }
}

/** Level index (in a grid with origin z0 and spacing dz) that contains an elevation. */
export function levelIndex(elevation: number, z0: number, dz: number, nz: number): number | null {
  const k = Math.floor((elevation - z0) / dz)
  return k >= 0 && k < nz ? k : null
}
