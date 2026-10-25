// Elevator speed presets and travel time (trapezoidal velocity profile with constant acceleration).

export type ElevatorSpeed = 'slow' | 'tower' | 'fast' | 'instant'

export const SPEEDS: Record<ElevatorSpeed, { label: string; mps: number | null; note: string }> = {
  slow: { label: 'ゆっくり', mps: 1.5, note: '分速90m・中低層マンション程度' },
  tower: { label: '超高層', mps: 6, note: '分速360m・タワーマンション程度' },
  fast: { label: '高速', mps: 10, note: '分速600m・展望台などの高速エレベーター' },
  instant: { label: '一瞬', mps: null, note: '待たずに移動（プレゼン用）' },
}

/** acceleration / deceleration (m/s²); real lifts use about 1 m/s², slightly faster here for the demo */
export const ACCEL = 2

const KEY = 'tokyo-mansion-speed'

export function loadSpeed(): ElevatorSpeed {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'slow' || v === 'tower' || v === 'fast' || v === 'instant') return v
  } catch { /* private mode */ }
  return 'tower'
}

export function saveSpeed(s: ElevatorSpeed) {
  try { localStorage.setItem(KEY, s) } catch { /* private mode */ }
}

/** Travel time in ms for `dist` metres at the preset speed. */
export function travelMs(dist: number, speed: ElevatorSpeed): number {
  if (dist <= 0) return 0
  const v = SPEEDS[speed].mps
  if (v == null) return Math.min(900, 250 + dist * 12)
  const a = ACCEL
  // short trips never reach the rated speed: triangular profile
  const t = dist < (v * v) / a ? 2 * Math.sqrt(dist / a) : dist / v + v / a
  return t * 1000
}

/** Position along the trip (0..1) for normalised time p (0..1): smooth start and stop. */
export function easeElevator(p: number): number {
  const x = Math.min(1, Math.max(0, p))
  return x * x * x * (x * (6 * x - 15) + 10) // smootherstep
}
