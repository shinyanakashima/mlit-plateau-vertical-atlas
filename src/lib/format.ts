export const fmt = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const fmtInt = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('ja-JP'))

export const fmtArea = (m2: number) =>
  m2 >= 10000 ? `${(m2 / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 2 })} ha` : `${Math.round(m2).toLocaleString('ja-JP')} m²`

/** Typical office storey height used to express a height as a floor number (approximation). */
export const FLOOR_HEIGHT_M = 4.0

export function floorLabel(heightAboveGround: number): string {
  if (heightAboveGround < 0) return '地下'
  return `約${Math.floor(heightAboveGround / FLOOR_HEIGHT_M) + 1}階相当`
}

export function median(a: ArrayLike<number>): number {
  const v = Array.from(a).filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
  return v.length ? v[Math.floor(v.length / 2)] : 0
}
