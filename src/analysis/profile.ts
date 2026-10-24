import { analyzeSlice, connected, type PassableParams } from './slice'

export interface LevelProfile {
  k: number
  /** T.P. elevation of the level centre */
  z: number
  judged: number
  occupied: number
  ratio: number | null
  componentCount: number
  significantCount: number
  largestShare: number | null
  largestAreaM2: number
  passableAreaM2: number
  /** A–B connectivity on this level; null when no pair is set */
  ab: boolean | null
}

export interface ProfileRequest {
  volume: Uint8Array
  nx: number
  ny: number
  nz: number
  dx: number
  z0: number
  dz: number
  params: PassableParams
  pair?: { a: number; b: number } | null
}

export function computeProfile(req: ProfileRequest): LevelProfile[] {
  const { volume, nx, ny, nz, dx, z0, dz, params, pair } = req
  const cell = dx * dx
  const out: LevelProfile[] = []
  for (let k = 0; k < nz; k++) {
    const level = volume.subarray(k * nx * ny, (k + 1) * nx * ny)
    const r = analyzeSlice(level, nx, ny, dx, params)
    const s = r.summary
    out.push({
      k,
      z: z0 + (k + 0.5) * dz,
      judged: s.judged,
      occupied: s.occupied,
      ratio: s.ratio,
      componentCount: s.componentCount,
      significantCount: s.significantCount,
      largestShare: s.largestShare,
      largestAreaM2: s.largestCells * cell,
      passableAreaM2: s.passableCells * cell,
      ab: pair ? r.comps.labels[pair.a] !== 0 && r.comps.labels[pair.a] === r.comps.labels[pair.b] : null,
    })
  }
  return out
}

/** Lowest level index at which a and b are connected (null if never). */
export function lowestConnectedLevel(profile: LevelProfile[]): number | null {
  for (const p of profile) if (p.ab) return p.k
  return null
}

/** Lowest level from which a and b stay connected all the way up. */
export function stableConnectedLevel(profile: LevelProfile[]): number | null {
  let k: number | null = null
  for (let i = profile.length - 1; i >= 0; i--) {
    if (profile[i].ab) k = profile[i].k
    else break
  }
  return k
}

export { connected }
