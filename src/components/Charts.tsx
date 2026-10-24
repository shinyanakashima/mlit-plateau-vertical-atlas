import { memo, useEffect, useState } from 'react'
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { LevelProfile } from '../analysis/profile'
import type { StrataRow } from '../analysis/strata'
import { dataBaseUrl } from '../data/atlas'
import type { AreaIndexEntry } from '../data/types'
import { fmt } from '../lib/format'
import { COLORS } from '../viewer/sliceTexture'

const AXIS = { stroke: '#46526a', tick: { fill: '#7d889e', fontSize: 11 } }
const GRID = <CartesianGrid stroke="#1d2638" vertical={false} />

interface ClickState { activeTooltipIndex?: number | string | null }

function pickHandler<T extends { z: number }>(data: T[], onPick: (z: number) => void) {
  return (s: ClickState | null) => {
    const i = s?.activeTooltipIndex
    if (i == null) return
    const row = data[Number(i)]
    if (row) onPick(row.z)
  }
}

function Tip({ active, payload, label, unit, names }: {
  active?: boolean; payload?: { value: number; dataKey: string; color?: string }[]; label?: number; unit: string; names: Record<string, string>
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <div className="t">T.P. {fmt(Number(label), 1)} m</div>
      {payload.map((p) => (
        <div key={p.dataKey}>
          {names[p.dataKey] ?? p.dataKey}: <b className="num">{fmt(p.value, unit === '' ? 0 : 1)}{unit}</b>
        </div>
      ))}
    </div>
  )
}

interface Props {
  profile: LevelProfile[] | null
  elevation: number
  zMax: number
  onPick: (z: number) => void
  clearanceM: number
  hasPair: boolean
  current: LevelProfile | null
}

function abSpans(profile: LevelProfile[], dz: number) {
  const spans: [number, number][] = []
  let start: number | null = null
  for (const p of profile) {
    if (p.ab && start == null) start = p.z - dz / 2
    if (!p.ab && start != null) { spans.push([start, p.z - dz / 2]); start = null }
  }
  if (start != null) spans.push([start, profile[profile.length - 1].z + dz / 2])
  return spans
}

export const ProfileCharts = memo(function ProfileCharts({ profile, elevation, zMax, onPick, clearanceM, hasPair, current }: Props) {
  if (!profile) return <div className="charts one"><div className="chart"><div className="empty">高度別の解析を計算しています…</div></div></div>
  const data = profile.map((p) => ({
    z: p.z,
    ratio: p.ratio ?? undefined,
    share: p.largestShare != null ? p.largestShare * 100 : undefined,
    count: p.componentCount,
    sig: p.significantCount,
  }))
  const dz = profile.length > 1 ? profile[1].z - profile[0].z : 3
  const x = (
    <XAxis dataKey="z" type="number" domain={[profile[0].z - dz / 2, zMax]} {...AXIS} tickCount={8}
      tickFormatter={(v: number) => `${Math.round(v)}`} unit="m" allowDecimals={false} />
  )
  const ref = <ReferenceLine x={elevation} stroke="#ff9a5c" strokeWidth={2} />
  const click = pickHandler(data, onPick)
  const spans = hasPair ? abSpans(profile, dz) : []
  return (
    <div className="charts">
      <div className="chart">
        <div className="chart-title">
          <span>高度別 建物占有率</span>
          <span className="cur num">{fmt(current?.ratio ?? null, 1)}%</span>
        </div>
        <div className="chart-body">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 6, right: 8, left: -4, bottom: 0 }} onClick={click as never}>
              {GRID}
              {x}
              <YAxis {...AXIS} unit="%" width={46} domain={[0, (m: number) => Math.max(10, Math.ceil(m / 10) * 10)]} />
              <Tooltip content={<Tip unit="%" names={{ ratio: '占有率' }} />} cursor={{ stroke: '#7d889e' }} />
              <Area type="stepAfter" dataKey="ratio" stroke={COLORS.building} strokeWidth={2} fill={COLORS.building} fillOpacity={0.28} isAnimationActive={false} />
              {ref}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="chart">
        <div className="chart-title">
          <span>最大連結領域の割合 <span className="sub">離隔 {clearanceM} m</span></span>
          <span className="cur num">{fmt(current?.largestShare != null ? current.largestShare * 100 : null, 1)}%</span>
        </div>
        <div className="chart-body">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 6, right: 8, left: -4, bottom: 0 }} onClick={click as never}>
              {GRID}
              {x}
              <YAxis {...AXIS} unit="%" width={46} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
              {spans.map(([a, b]) => <ReferenceArea key={a} x1={a} x2={b} fill="#3ccf7a" fillOpacity={0.12} stroke="none" />)}
              <Tooltip content={<Tip unit="%" names={{ share: '最大連結領域' }} />} cursor={{ stroke: '#7d889e' }} />
              <Line type="stepAfter" dataKey="share" stroke={COLORS.largest} strokeWidth={2} dot={false} isAnimationActive={false} />
              {ref}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {hasPair && <div className="chart-legend"><span><i className="sw" style={{ background: 'rgba(60,207,122,.35)', width: 12, height: 8 }} />A–Bが連結する高度</span></div>}
      </div>
      <div className="chart">
        <div className="chart-title">
          <span>連結成分の数</span>
          <span className="cur num">{current ? `${current.significantCount} / ${current.componentCount}` : '—'}</span>
        </div>
        <div className="chart-body">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 6, right: 8, left: -4, bottom: 0 }} onClick={click as never}>
              {GRID}
              {x}
              <YAxis {...AXIS} width={46} allowDecimals={false} />
              <Tooltip content={<Tip unit="" names={{ count: 'すべて', sig: '100m²以上' }} />} cursor={{ stroke: '#7d889e' }} />
              <Line type="stepAfter" dataKey="count" stroke={COLORS.small} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="sig" stroke={COLORS.largest} strokeWidth={2} dot={false} isAnimationActive={false} />
              {ref}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-legend">
          <span><i className="sw" style={{ background: COLORS.largest, height: 3, width: 12 }} />100m²以上</span>
          <span><i className="sw" style={{ background: COLORS.small, height: 3, width: 12 }} />すべて</span>
        </div>
      </div>
    </div>
  )
})

export const STRATA_CATEGORIES = ['業務', '商業', '宿泊', '住宅', '公共・文教', '運輸・その他']
export const STRATA_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9']

export function usageCategory(usage: string | null): number {
  if (!usage) return 5
  if (usage === '業務施設') return 0
  if (usage.startsWith('商業')) return 1
  if (usage === '宿泊施設') return 2
  if (usage.includes('住宅')) return 3
  if (usage === '官公庁施設' || usage === '文教厚生施設') return 4
  return 5
}

export const StrataChart = memo(function StrataChart({ rows, z0, dz, elevation, zMax, onPick, areas, currentArea, groundTP }: {
  rows: StrataRow[] | null; z0: number; dz: number; elevation: number; zMax: number; onPick: (z: number) => void
  areas: AreaIndexEntry[]; currentArea: string; groundTP: number
}) {
  if (!rows) return <div className="charts one"><div className="chart"><div className="empty">建物IDのZarrチャンクを読み込んで地層図を作成しています…</div></div></div>
  const data = rows.map((r) => {
    const o: Record<string, number> = { z: z0 + (r.k + 0.5) * dz }
    STRATA_CATEGORIES.forEach((_, i) => { o[`c${i}`] = r.shares[i] })
    return o
  })
  const names = Object.fromEntries(STRATA_CATEGORIES.map((c, i) => [`c${i}`, c]))
  return (
    <div className="charts two">
      <div className="chart">
        <div className="chart-title">
          <span>都市の地層図 <span className="sub">用途別の占有率（T.P.）</span></span>
          <div className="chart-legend">
            {STRATA_CATEGORIES.map((c, i) => <span key={c}><i className="sw" style={{ background: STRATA_COLORS[i] }} />{c}</span>)}
          </div>
        </div>
        <div className="chart-body">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 6, right: 12, left: -4, bottom: 0 }} onClick={pickHandler(data as { z: number }[], onPick) as never}>
              {GRID}
              <XAxis dataKey="z" type="number" domain={[z0, zMax]} {...AXIS} tickCount={10} unit="m" tickFormatter={(v: number) => `${Math.round(v)}`} />
              <YAxis {...AXIS} unit="%" width={46} />
              <Tooltip content={<Tip unit="%" names={names} />} cursor={{ stroke: '#7d889e' }} />
              {STRATA_CATEGORIES.map((c, i) => (
                <Area key={c} type="stepAfter" dataKey={`c${i}`} stackId="1" stroke="#0a0f18" strokeWidth={1} fill={STRATA_COLORS[i]} fillOpacity={0.85} isAnimationActive={false} />
              ))}
              <ReferenceLine x={elevation} stroke="#ff9a5c" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <CompareChart areas={areas} current={currentArea} heightAboveGround={elevation - groundTP} />
    </div>
  )
})

interface AreaProfile { id: string; title: string; z0: number; dz: number; groundMedianTP: number; ratio: Record<string, (number | null)[]> }
const profileCache = new Map<string, Promise<AreaProfile>>()

/** Occupancy profiles of all real areas against the height above their own ground. */
function CompareChart({ areas, current, heightAboveGround }: { areas: AreaIndexEntry[]; current: string; heightAboveGround: number }) {
  const real = areas.filter((a) => a.kind === 'plateau')
  const [profiles, setProfiles] = useState<AreaProfile[] | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all(real.map((a) => {
      let p = profileCache.get(a.id)
      if (!p) {
        p = fetch(`${dataBaseUrl()}${a.id}/profile.json`).then((r) => r.json() as Promise<AreaProfile>)
        profileCache.set(a.id, p)
      }
      return p
    })).then((ps) => alive && setProfiles(ps)).catch(() => alive && setProfiles([]))
    return () => { alive = false }
  }, [real.map((a) => a.id).join(',')])
  const colors = ['#3987e5', '#d95926', '#199e70', '#c98500']
  const step = 6
  const rows: Record<string, number>[] = []
  if (profiles) {
    for (let h = 0; h <= 300; h += step) {
      const row: Record<string, number> = { h }
      for (const p of profiles) {
        const k = Math.floor((p.groundMedianTP + h - p.z0) / p.dz)
        const v = p.ratio.lod2?.[k]
        if (v != null && k >= 0) row[p.id] = v
      }
      rows.push(row)
    }
  }
  return (
    <div className="chart">
      <div className="chart-title">
        <span>エリア比較 <span className="sub">地表からの高さ別の占有率（LOD2）</span></span>
      </div>
      <div className="chart-legend">
        {(profiles ?? []).map((p, i) => (
          <span key={p.id} style={{ fontWeight: p.id === current ? 700 : 400 }}>
            <i className="sw" style={{ background: colors[i % colors.length], height: 3, width: 12 }} />{p.title}
          </span>
        ))}
      </div>
      <div className="chart-body">
        {profiles && (
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 6, right: 12, left: -4, bottom: 0 }}>
              {GRID}
              <XAxis dataKey="h" type="number" domain={[0, 300]} {...AXIS} unit="m" ticks={[0, 50, 100, 150, 200, 250, 300]} />
              <YAxis {...AXIS} unit="%" width={46} />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                <div className="chart-tip">
                  <div className="t">地表から {fmt(Number(label), 0)} m</div>
                  {payload.map((p) => <div key={String(p.dataKey)}>{profiles.find((x) => x.id === p.dataKey)?.title}: <b className="num">{fmt(Number(p.value), 1)}%</b></div>)}
                </div>
              ) : null} cursor={{ stroke: '#7d889e' }} />
              {profiles.map((p, i) => (
                <Line key={p.id} type="stepAfter" dataKey={p.id} stroke={colors[i % colors.length]} strokeWidth={p.id === current ? 2.5 : 1.5}
                  strokeOpacity={p.id === current ? 1 : 0.75} dot={false} isAnimationActive={false} connectNulls={false} />
              ))}
              <ReferenceLine x={Math.max(0, heightAboveGround)} stroke="#ff9a5c" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

