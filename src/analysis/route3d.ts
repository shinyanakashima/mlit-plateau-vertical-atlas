// Experimental 3D obstacle-avoiding route on the occupancy grid (A*).
// NOT a flight plan: no regulation, wind, GNSS, people/vehicles or safety margins beyond the
// horizontal clearance are considered.

import { BUILDING, clearanceD2, FREE } from './slice'

export interface RouteRequest {
  occ: Uint8Array
  nx: number
  ny: number
  nz: number
  dx: number
  dz: number
  /** start / goal as [col, row, level] */
  start: [number, number, number]
  goal: [number, number, number]
  clearanceM: number
  /** highest level index the route may use */
  maxLevel: number
  /** extra cost factor for vertical moves (energy) */
  climbFactor: number
}

export interface RouteResult {
  /** [col, row, level] cells along the route */
  cells: [number, number, number][]
  lengthM: number
  climbM: number
  expanded: number
  reason?: string
}

class Heap {
  private keys: number[] = []
  private vals: number[] = []
  get size() { return this.keys.length }
  push(key: number, val: number) {
    const k = this.keys, v = this.vals
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]; v[i] = v[p]; i = p
    }
    k[i] = key; v[i] = val
  }
  pop(): number {
    const k = this.keys, v = this.vals
    const top = v[0]
    const lk = k.pop()!, lv = v.pop()!
    if (k.length) {
      let i = 0
      const n = k.length
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && k[r] < k[l] ? r : l
        if (k[c] >= lk) break
        k[i] = k[c]; v[i] = v[c]; i = c
      }
      k[i] = lk; v[i] = lv
    }
    return top
  }
}

export function passableVolume(req: Pick<RouteRequest, 'occ' | 'nx' | 'ny' | 'nz' | 'dx' | 'clearanceM' | 'maxLevel'>): Uint8Array {
  const { occ, nx, ny, nz, dx, clearanceM, maxLevel } = req
  const n = nx * ny
  const ok = new Uint8Array(n * nz)
  const thr = (clearanceM * clearanceM) / (dx * dx)
  for (let k = 0; k <= Math.min(maxLevel, nz - 1); k++) {
    const lv = occ.subarray(k * n, (k + 1) * n)
    let hasB = false
    for (let i = 0; i < n; i++) if (lv[i] === BUILDING) { hasB = true; break }
    const d2 = clearanceM > 0 && hasB ? clearanceD2(lv, nx, ny) : null
    for (let i = 0; i < n; i++) {
      if (lv[i] !== FREE) continue
      if (d2 && d2[i] < thr - 1e-9) continue
      ok[k * n + i] = 1
    }
  }
  return ok
}

export function findRoute3D(req: RouteRequest): RouteResult {
  const { nx, ny, nz, dx, dz, start, goal, climbFactor } = req
  const n = nx * ny
  const ok = passableVolume(req)
  const idx = (c: number, r: number, k: number) => k * n + r * nx + c
  const s = idx(...start)
  const g = idx(...goal)
  if (!ok[s]) return { cells: [], lengthM: 0, climbM: 0, expanded: 0, reason: 'start' }
  if (!ok[g]) return { cells: [], lengthM: 0, climbM: 0, expanded: 0, reason: 'goal' }
  const gScore = new Float32Array(n * nz).fill(Infinity)
  const prev = new Int32Array(n * nz).fill(-1)
  const closed = new Uint8Array(n * nz)
  const heap = new Heap()
  const [gc, gr, gk] = goal
  const h = (c: number, r: number, k: number) =>
    Math.hypot((c - gc) * dx, (r - gr) * dx, (k - gk) * dz)
  gScore[s] = 0
  heap.push(h(...start), s)
  const moves: [number, number, number, number][] = []
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    moves.push([dc, dr, 0, Math.hypot(dc, dr) * dx])
  }
  moves.push([0, 0, 1, dz * climbFactor], [0, 0, -1, dz * climbFactor])
  let expanded = 0
  while (heap.size) {
    const cur = heap.pop()
    if (closed[cur]) continue
    closed[cur] = 1
    expanded++
    if (cur === g) break
    const k = Math.floor(cur / n)
    const rem = cur - k * n
    const r = Math.floor(rem / nx)
    const c = rem - r * nx
    for (const [dc, dr, dk, cost] of moves) {
      const c2 = c + dc, r2 = r + dr, k2 = k + dk
      if (c2 < 0 || r2 < 0 || k2 < 0 || c2 >= nx || r2 >= ny || k2 >= nz) continue
      const j = k2 * n + r2 * nx + c2
      if (!ok[j] || closed[j]) continue
      // no corner cutting through buildings on diagonal moves
      if (dc && dr && (!ok[k * n + r * nx + c2] || !ok[k * n + r2 * nx + c])) continue
      const t = gScore[cur] + cost
      if (t < gScore[j]) {
        gScore[j] = t
        prev[j] = cur
        heap.push(t + h(c2, r2, k2), j)
      }
    }
  }
  if (prev[g] < 0 && s !== g) return { cells: [], lengthM: 0, climbM: 0, expanded, reason: 'unreachable' }
  const cells: [number, number, number][] = []
  for (let i = g; ; i = prev[i]) {
    const k = Math.floor(i / n)
    const rem = i - k * n
    cells.push([rem % nx, Math.floor(rem / nx), k])
    if (i === s) break
  }
  cells.reverse()
  let lengthM = 0
  let climbM = 0
  for (let i = 1; i < cells.length; i++) {
    const [a, b, c] = cells[i - 1]
    const [d, e, f] = cells[i]
    lengthM += Math.hypot((d - a) * dx, (e - b) * dx, (f - c) * dz)
    if (f > c) climbM += (f - c) * dz
  }
  return { cells, lengthM, climbM, expanded }
}
