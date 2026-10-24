// Horizontal-slice analytics.  Pure functions on a single level (row-major, y=0 is north).
// The Python reference implementation lives in pipeline/atlas/analysis.py and the two are
// cross-checked in src/analysis/slice.test.ts.

export const FREE = 0
export const BUILDING = 1
export const NODATA = 255

/** Squared distance value used when a level contains no building at all. */
export const FAR = 0x3fffffff

export interface OccupancyStats {
  judged: number
  occupied: number
  free: number
  /** occupied / judged * 100, null when nothing can be judged */
  ratio: number | null
}

export function occupancyStats(level: Uint8Array): OccupancyStats {
  let judged = 0
  let occupied = 0
  for (let i = 0; i < level.length; i++) {
    const v = level[i]
    if (v !== NODATA) {
      judged++
      if (v === BUILDING) occupied++
    }
  }
  return { judged, occupied, free: judged - occupied, ratio: judged ? (occupied / judged) * 100 : null }
}

// 1-D squared distance transform (Felzenszwalb & Huttenlocher 2012).
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dq = q - v[k]
    d[q] = dq * dq + f[v[k]]
  }
}

/** Exact squared Euclidean distance (in cells²) from each cell centre to the nearest building cell. */
export function clearanceD2(level: Uint8Array, nx: number, ny: number): Int32Array {
  const out = new Int32Array(nx * ny)
  let any = false
  for (let i = 0; i < level.length; i++) if (level[i] === BUILDING) { any = true; break }
  if (!any) return out.fill(FAR)
  const n = Math.max(nx, ny)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const tmp = new Float64Array(nx * ny)
  const BIG = 1e20
  // columns
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) f[y] = level[y * nx + x] === BUILDING ? 0 : BIG
    edt1d(f, ny, d, v, z)
    for (let y = 0; y < ny; y++) tmp[y * nx + x] = d[y]
  }
  // rows
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) f[x] = tmp[y * nx + x]
    edt1d(f, nx, d, v, z)
    for (let x = 0; x < nx; x++) out[y * nx + x] = d[x] >= BIG ? FAR : Math.round(d[x])
  }
  return out
}

export interface PassableParams {
  /** minimum horizontal distance to any building cell centre (m) */
  clearanceM: number
  /** width of the band along the area boundary that is excluded from the analysis (m) */
  marginM: number
}

/** 1 where a cell is free air, keeps the clearance and lies outside the boundary band. */
export function passableMask(
  level: Uint8Array, nx: number, ny: number, dx: number, p: PassableParams, d2?: Int32Array,
): Uint8Array {
  const m = new Uint8Array(nx * ny)
  const needD2 = p.clearanceM > 0
  const dist = needD2 ? (d2 ?? clearanceD2(level, nx, ny)) : null
  const thr = (p.clearanceM * p.clearanceM) / (dx * dx)
  const mc = Math.round(p.marginM / dx)
  for (let y = 0; y < ny; y++) {
    const inY = y >= mc && y < ny - mc
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x
      if (level[i] !== FREE || !inY || x < mc || x >= nx - mc) continue
      if (dist && dist[i] < thr - 1e-9) continue
      m[i] = 1
    }
  }
  return m
}

export interface Components {
  /** 0 = not passable, otherwise 1-based component id (ids ordered by first appearance, like scipy) */
  labels: Int32Array
  /** sizes[id] = number of cells (index 0 unused) */
  sizes: Int32Array
  count: number
  /** component ids sorted by size (largest first) */
  bySize: number[]
  /** touchesBoundary[id] = component reaches the outer edge of the analysed window */
  touchesBoundary: Uint8Array
}

/** 4-neighbour connected-component labelling (iterative flood fill). */
export function labelComponents(mask: Uint8Array, nx: number, ny: number, marginCells = 0): Components {
  const labels = new Int32Array(nx * ny)
  const stack = new Int32Array(nx * ny)
  const sizes: number[] = [0]
  const touches: number[] = [0]
  const lo = marginCells
  const hiX = nx - 1 - marginCells
  const hiY = ny - 1 - marginCells
  let next = 0
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue
    next++
    let size = 0
    let touch = 0
    let sp = 0
    stack[sp++] = start
    labels[start] = next
    while (sp) {
      const i = stack[--sp]
      size++
      const x = i % nx
      const y = (i - x) / nx
      if (x === lo || y === lo || x === hiX || y === hiY) touch = 1
      if (x > 0) { const j = i - 1; if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j } }
      if (x < nx - 1) { const j = i + 1; if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j } }
      if (y > 0) { const j = i - nx; if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j } }
      if (y < ny - 1) { const j = i + nx; if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j } }
    }
    sizes.push(size)
    touches.push(touch)
  }
  const bySize = Array.from({ length: next }, (_, k) => k + 1).sort((a, b) => sizes[b] - sizes[a] || a - b)
  return {
    labels, sizes: Int32Array.from(sizes), count: next, bySize, touchesBoundary: Uint8Array.from(touches),
  }
}

export interface SliceSummary extends OccupancyStats {
  componentCount: number
  /** components of at least `significantCells` cells */
  significantCount: number
  passableCells: number
  largestCells: number
  /** largest / passable (0..1), null when nothing is passable */
  largestShare: number | null
}

export const SIGNIFICANT_AREA_M2 = 100

export function summarize(level: Uint8Array, comps: Components, dx: number): SliceSummary {
  const occ = occupancyStats(level)
  let passable = 0
  let significant = 0
  const minCells = SIGNIFICANT_AREA_M2 / (dx * dx)
  for (let id = 1; id <= comps.count; id++) {
    passable += comps.sizes[id]
    if (comps.sizes[id] >= minCells) significant++
  }
  const largest = comps.count ? comps.sizes[comps.bySize[0]] : 0
  return {
    ...occ,
    componentCount: comps.count,
    significantCount: significant,
    passableCells: passable,
    largestCells: largest,
    largestShare: passable ? largest / passable : null,
  }
}

export interface SliceAnalysis {
  summary: SliceSummary
  comps: Components
  d2: Int32Array | null
  mask: Uint8Array
}

export function analyzeSlice(level: Uint8Array, nx: number, ny: number, dx: number, p: PassableParams,
  withDistance = false): SliceAnalysis {
  const d2 = p.clearanceM > 0 || withDistance ? clearanceD2(level, nx, ny) : null
  const mask = passableMask(level, nx, ny, dx, p, d2 ?? undefined)
  const comps = labelComponents(mask, nx, ny, Math.round(p.marginM / dx))
  return { summary: summarize(level, comps, dx), comps, d2, mask }
}

/** Shortest 4-neighbour path between two cells over passable cells (BFS).  Returns cell indices. */
export function shortestPath(mask: Uint8Array, nx: number, ny: number, a: number, b: number): number[] | null {
  if (!mask[a] || !mask[b]) return null
  const prev = new Int32Array(nx * ny).fill(-1)
  const queue = new Int32Array(nx * ny)
  let qh = 0
  let qt = 0
  queue[qt++] = a
  prev[a] = a
  while (qh < qt) {
    const i = queue[qh++]
    if (i === b) break
    const x = i % nx
    const y = (i - x) / nx
    const nb = [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, y > 0 ? i - nx : -1, y < ny - 1 ? i + nx : -1]
    for (const j of nb) {
      if (j >= 0 && mask[j] && prev[j] < 0) {
        prev[j] = i
        queue[qt++] = j
      }
    }
  }
  if (prev[b] < 0) return null
  const path: number[] = []
  for (let i = b; ; i = prev[i]) {
    path.push(i)
    if (i === a) break
  }
  return path.reverse()
}

/** Remove staircase vertices: keep a vertex only if the straight segment would cut a non-passable cell. */
export function simplifyPath(path: number[], mask: Uint8Array, nx: number): number[] {
  if (path.length <= 2) return path
  const clear = (a: number, b: number) => {
    const ax = (a % nx) + 0.5, ay = Math.floor(a / nx) + 0.5
    const bx = (b % nx) + 0.5, by = Math.floor(b / nx) + 0.5
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 3)
    for (let s = 1; s < n; s++) {
      const t = s / n
      const x = Math.floor(ax + (bx - ax) * t)
      const y = Math.floor(ay + (by - ay) * t)
      if (!mask[y * nx + x]) return false
    }
    return true
  }
  const out = [path[0]]
  let anchor = 0
  for (let i = 2; i < path.length; i++) {
    if (!clear(path[anchor], path[i])) {
      out.push(path[i - 1])
      anchor = i - 1
    }
  }
  out.push(path[path.length - 1])
  return out
}

/** True when cells a and b are in the same component of `mask` (early-exit flood fill). */
export function connected(mask: Uint8Array, nx: number, ny: number, a: number, b: number): boolean {
  if (!mask[a] || !mask[b]) return false
  if (a === b) return true
  const seen = new Uint8Array(nx * ny)
  const stack = new Int32Array(nx * ny)
  let sp = 0
  stack[sp++] = a
  seen[a] = 1
  while (sp) {
    const i = stack[--sp]
    const x = i % nx
    const y = (i - x) / nx
    const nb = [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, y > 0 ? i - nx : -1, y < ny - 1 ? i + nx : -1]
    for (const j of nb) {
      if (j < 0 || seen[j] || !mask[j]) continue
      if (j === b) return true
      seen[j] = 1
      stack[sp++] = j
    }
  }
  return false
}
