import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as zarr from 'zarrita'
import { computeProfile } from './profile'
import { findRoute3D } from './route3d'
import {
  analyzeSlice, BUILDING, clearanceD2, connected, labelComponents, occupancyStats, passableMask,
  shortestPath, simplifyPath,
} from './slice'

const grid = (rows: string[]) => {
  // '#' building, '.' free, 'x' nodata
  const ny = rows.length
  const nx = rows[0].length
  const a = new Uint8Array(nx * ny)
  rows.forEach((r, y) => [...r].forEach((ch, x) => { a[y * nx + x] = ch === '#' ? 1 : ch === 'x' ? 255 : 0 }))
  return { a, nx, ny }
}

describe('occupancy', () => {
  it('excludes NODATA from the denominator', () => {
    const { a } = grid(['##..', 'xx..'])
    expect(occupancyStats(a)).toEqual({ judged: 6, occupied: 2, free: 4, ratio: (2 / 6) * 100 })
  })
  it('returns null ratio when nothing is judged', () => {
    expect(occupancyStats(new Uint8Array([255, 255])).ratio).toBeNull()
  })
})

describe('distance transform', () => {
  it('is exact against brute force', () => {
    const nx = 23, ny = 17
    const a = new Uint8Array(nx * ny)
    let seed = 7
    for (let i = 0; i < a.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; a[i] = seed % 13 === 0 ? BUILDING : 0 }
    const d2 = clearanceD2(a, nx, ny)
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let best = Infinity
      for (let yy = 0; yy < ny; yy++) for (let xx = 0; xx < nx; xx++) {
        if (a[yy * nx + xx] === BUILDING) best = Math.min(best, (x - xx) ** 2 + (y - yy) ** 2)
      }
      expect(d2[y * nx + x]).toBe(best)
    }
  })
})

describe('connected components', () => {
  it('uses 4-neighbourhood (diagonals do not connect)', () => {
    const { a, nx, ny } = grid(['.#', '#.'])
    const m = passableMask(a, nx, ny, 2, { clearanceM: 0, marginM: 0 })
    expect(labelComponents(m, nx, ny).count).toBe(2)
  })
  it('finds an enclosed courtyard', () => {
    const { a, nx, ny } = grid([
      '.......',
      '.#####.',
      '.#...#.',
      '.#...#.',
      '.#####.',
      '.......',
    ])
    const r = analyzeSlice(a, nx, ny, 2, { clearanceM: 0, marginM: 0 })
    expect(r.summary.componentCount).toBe(2)
    expect(r.comps.sizes[r.comps.bySize[1]]).toBe(6)
    expect(r.comps.touchesBoundary[r.comps.bySize[0]]).toBe(1)
    expect(r.comps.touchesBoundary[r.comps.bySize[1]]).toBe(0)
  })
  it('boundary band removes the detour along the edge', () => {
    const { a, nx, ny } = grid([
      '......',
      '..#...',
      '..#...',
      '..#...',
      '..#...',
      '......',
    ])
    expect(analyzeSlice(a, nx, ny, 2, { clearanceM: 0, marginM: 0 }).summary.componentCount).toBe(1)
    expect(analyzeSlice(a, nx, ny, 2, { clearanceM: 0, marginM: 2 }).summary.componentCount).toBe(2)
  })
  it('clearance closes narrow gaps', () => {
    const { a, nx, ny } = grid([
      '...#...',
      '...#...',
      '.......',
      '.......',
      '...#...',
      '...#...',
    ])
    // gap of 2 cells (4 m): centres 2 cells from the wall ends -> 4 m clearance
    expect(analyzeSlice(a, nx, ny, 2, { clearanceM: 2, marginM: 0 }).summary.componentCount).toBe(1)
    const r = analyzeSlice(a, nx, ny, 2, { clearanceM: 4.5, marginM: 0 })
    const left = 2 * nx + 0
    const right = 2 * nx + 6
    expect(r.comps.labels[left]).not.toBe(r.comps.labels[right])
  })
})

describe('paths', () => {
  it('finds the shortest 4-neighbour path and simplifies it', () => {
    const { a, nx, ny } = grid([
      '.....',
      '.###.',
      '.....',
    ])
    const m = passableMask(a, nx, ny, 2, { clearanceM: 0, marginM: 0 })
    const p = shortestPath(m, nx, ny, 0, 4)!
    expect(p.length).toBe(5)
    expect(simplifyPath(p, m, nx)).toEqual([0, 4])
    expect(connected(m, nx, ny, 0, 2 * nx + 4)).toBe(true)
    expect(shortestPath(m, nx, ny, 0, nx + 1)).toBeNull()
  })
  it('3D route climbs over a wall that blocks the low levels', () => {
    const nx = 9, ny = 5, nz = 4
    const occ = new Uint8Array(nx * ny * nz)
    // wall at col 4 on levels 0..1 spanning the whole width
    for (let k = 0; k < 2; k++) for (let r = 0; r < ny; r++) occ[k * nx * ny + r * nx + 4] = BUILDING
    const res = findRoute3D({ occ, nx, ny, nz, dx: 2, dz: 3, start: [0, 2, 0], goal: [8, 2, 0], clearanceM: 0, maxLevel: 3, climbFactor: 1 })
    expect(res.cells.length).toBeGreaterThan(0)
    expect(Math.max(...res.cells.map((c) => c[2]))).toBe(2)
    expect(res.climbM).toBe(6)
    const blocked = findRoute3D({ occ, nx, ny, nz, dx: 2, dz: 3, start: [0, 2, 0], goal: [8, 2, 0], clearanceM: 0, maxLevel: 1, climbFactor: 1 })
    expect(blocked.reason).toBe('unreachable')
  })
})

// --- cross-check against the Python reference on the generated datasets ----------------------
class FsStore {
  root: string
  constructor(root: string) { this.root = root }
  async get(key: string) {
    const p = resolve(this.root, `.${key}`)
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined
  }
}

for (const area of ['synthetic', 'tokyo-station', 'nishi-shinjuku']) {
  const dir = resolve(__dirname, '../../public/data', area)
  describe.skipIf(!existsSync(`${dir}/stats.json`))(`python parity: ${area}`, () => {
    it('matches pipeline/atlas/analysis.py level by level', async () => {
      const stats = JSON.parse(readFileSync(`${dir}/stats.json`, 'utf8'))
      const root = await zarr.open.v3(new FsStore(`${dir}/atlas.zarr`), { kind: 'group' })
      const attrs = root.attrs as { grid: { nx: number; ny: number; nz: number; dx: number; z0: number; dz: number } }
      const { nx, ny, nz, dx, z0, dz } = attrs.grid
      for (const lod of ['lod1', 'lod2']) {
        const arr = await zarr.open.v3(root.resolve(`${lod}/occupancy`), { kind: 'array' })
        const vol = (await zarr.get(arr, null)).data as Uint8Array
        const prof = computeProfile({ volume: vol, nx, ny, nz, dx, z0, dz, params: { clearanceM: 0, marginM: 0 } })
        prof.forEach((p, k) => {
          const s = stats[lod][k]
          expect(p.judged).toBe(s.judged)
          expect(p.occupied).toBe(s.occupied)
          expect(p.componentCount).toBe(s.cc_count)
          expect(p.passableAreaM2 / (dx * dx)).toBe(s.cc_free_cells)
          expect(p.largestAreaM2 / (dx * dx)).toBe(s.cc_largest_cells)
        })
      }
    })
  })
}
