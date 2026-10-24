import { useCallback, useRef } from 'react'
import type { LevelProfile } from '../analysis/profile'
import { COLORS } from '../viewer/sliceTexture'

interface Props {
  min: number
  max: number
  value: number
  step: number
  onChange: (v: number) => void
  profile: LevelProfile[] | null
  z0: number
  dz: number
  groundTP: number
  landmarks: { name: string; tp: number }[]
  height?: number
}

const W = 112
const PAD_T = 10
const PAD_B = 10
const TRACK_X = 36
const BAR_X0 = 44
const BAR_W = 62

/** Vertical elevation slider: altitude goes up, the occupancy profile is drawn beside the track. */
export default function ElevationSlider(p: Props) {
  const H = p.height ?? 300
  const ref = useRef<HTMLDivElement>(null)
  const y = useCallback((tp: number) => PAD_T + (1 - (tp - p.min) / (p.max - p.min)) * (H - PAD_T - PAD_B), [p.min, p.max, H])
  const fromY = (py: number) => {
    const t = 1 - (py - PAD_T) / (H - PAD_T - PAD_B)
    return Math.min(p.max, Math.max(p.min, p.min + t * (p.max - p.min)))
  }
  const drag = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    p.onChange(fromY(e.clientY - r.top))
  }
  const ticks: number[] = []
  const tickStep = p.max - p.min > 150 ? 50 : p.max - p.min > 60 ? 20 : 10
  for (let t = Math.ceil(p.min / tickStep) * tickStep; t <= p.max; t += tickStep) ticks.push(t)
  const maxRatio = Math.max(20, ...(p.profile ?? []).map((l) => l.ratio ?? 0))
  const thumbY = y(p.value)
  return (
    <div
      ref={ref}
      className="vslider"
      style={{ height: H, width: W }}
      role="slider"
      tabIndex={0}
      aria-label="断面の標高"
      aria-valuemin={p.min}
      aria-valuemax={p.max}
      aria-valuenow={Math.round(p.value * 10) / 10}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag(e) }}
      onPointerMove={(e) => { if (e.buttons & 1) drag(e) }}
      onWheel={(e) => p.onChange(Math.min(p.max, Math.max(p.min, p.value - Math.sign(e.deltaY) * p.step)))}
    >
      <svg width={W} height={H}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={TRACK_X - 5} x2={TRACK_X} y1={y(t)} y2={y(t)} stroke="#55627a" />
            <text x={TRACK_X - 8} y={y(t) + 4} fontSize={10.5} fill="#7d889e" textAnchor="end" className="num">{t}</text>
          </g>
        ))}
        {/* occupancy profile bars */}
        {p.profile?.map((l) => {
          const top = y(Math.min(p.max, p.z0 + (l.k + 1) * p.dz))
          const bot = y(Math.max(p.min, p.z0 + l.k * p.dz))
          const w = ((l.ratio ?? 0) / maxRatio) * BAR_W
          return <rect key={l.k} x={BAR_X0} y={top + 0.5} width={Math.max(w, 0)} height={Math.max(bot - top - 1, 0.5)} fill={COLORS.building} opacity={0.55} />
        })}
        {/* ground */}
        <line x1={TRACK_X - 4} x2={W} y1={y(p.groundTP)} y2={y(p.groundTP)} stroke="#3ccf7a" strokeDasharray="3 3" opacity={0.8} />
        <rect x={TRACK_X - 2} y={PAD_T} width={4} height={H - PAD_T - PAD_B} rx={2} fill="#1f2a3f" />
        <rect x={TRACK_X - 2} y={thumbY} width={4} height={Math.max(0, H - PAD_B - thumbY)} rx={2} fill="#ff9a5c" opacity={0.55} />
        {p.landmarks.map((l) => (
          <g key={l.name}>
            <title>{`${l.name}（T.P. ${l.tp.toFixed(0)} m）`}</title>
            <path d={`M${TRACK_X + 3} ${y(l.tp)} l6 -4 v8 z`} fill="#c8d3e8" opacity={0.8} />
          </g>
        ))}
        <line x1={TRACK_X - 10} x2={W} y1={thumbY} y2={thumbY} stroke="#ff9a5c" strokeWidth={1.5} />
        <circle cx={TRACK_X} cy={thumbY} r={8} fill="#ff9a5c" stroke="#1a0d04" strokeWidth={2} />
      </svg>
    </div>
  )
}
