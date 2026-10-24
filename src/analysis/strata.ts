// 「都市の地層図」: building occupancy per level, split by building usage.

export interface StrataRequest {
  bid: Uint16Array
  occ: Uint8Array
  nx: number
  ny: number
  nz: number
  /** category index for each building id (index 0 unused) */
  category: Uint8Array
  categories: string[]
}

export interface StrataRow {
  k: number
  judged: number
  /** % of judged cells occupied by buildings of each category */
  shares: number[]
}

export function usageStrata(req: StrataRequest): StrataRow[] {
  const { bid, occ, nx, ny, nz, category, categories } = req
  const n = nx * ny
  const rows: StrataRow[] = []
  for (let k = 0; k < nz; k++) {
    const counts = new Array<number>(categories.length).fill(0)
    let judged = 0
    for (let i = k * n; i < (k + 1) * n; i++) {
      const v = occ[i]
      if (v === 255) continue
      judged++
      if (v === 1) counts[category[bid[i]] ?? categories.length - 1]++
    }
    rows.push({ k, judged, shares: counts.map((c) => (judged ? (c / judged) * 100 : 0)) })
  }
  return rows
}
