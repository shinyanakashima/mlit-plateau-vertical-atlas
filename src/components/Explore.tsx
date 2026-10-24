import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { dataBaseUrl, type Atlas } from '../data/atlas'
import type { BuildingInfo } from '../data/types'
import { fmt } from '../lib/format'

interface Reference {
  stations: { name: string; elevation: number }[]
  routes: { name: string; summit: number; trailhead: string; trailheadElevation: number; gain: number; profile: [number, number][] }[]
  structures: { name: string; height: number }[]
  sources: Record<string, string>
}

let refPromise: Promise<Reference> | null = null
function useReference() {
  const [ref, setRef] = useState<Reference | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    refPromise ??= fetch(`${dataBaseUrl()}reference.json`).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<Reference>
    })
    refPromise.then(setRef).catch((e) => { refPromise = null; setErr(String(e)) })
  }, [])
  return { ref, err }
}

const DEFAULT_FLOOR_M = 4.0

/** Estimated storey height: measured height / storeys above ground, clamped to plausible values. */
export function floorHeight(b: BuildingInfo): { h: number; estimated: 'ratio' | 'default' } {
  if (b.measuredHeight && b.storeysAbove && b.storeysAbove > 0) {
    return { h: Math.min(6, Math.max(2.8, b.measuredHeight / b.storeysAbove)), estimated: 'ratio' }
  }
  return { h: DEFAULT_FLOOR_M, estimated: 'default' }
}

export function floorTP(b: BuildingInfo, floor: number): number {
  return (b.groundTP ?? 0) + (floor - 1) * floorHeight(b).h
}

const nameOf = (b: BuildingInfo) => b.alias ?? b.name ?? `名称なし（${b.usage ?? '用途不明'}・${fmt(b.measuredHeight, 0)}m）`

export function NeighborPanel({ atlas, selected, onSelect, onElevation, elevation, onPickMode }: {
  atlas: Atlas; selected: BuildingInfo | null; onSelect: (id: number | null) => void; onElevation: (z: number) => void
  elevation: number; onPickMode: () => void
}) {
  const { ref } = useReference()
  const maxFloor = selected?.storeysAbove ?? (selected?.measuredHeight ? Math.max(1, Math.floor(selected.measuredHeight / DEFAULT_FLOOR_M)) : 1)
  const initialFloor = (b: BuildingInfo | null) => {
    if (!b) return 1
    const fh = floorHeight(b).h
    const f = Math.floor((elevation - (b.groundTP ?? 0)) / fh) + 1
    const mf = b.storeysAbove ?? Math.max(1, Math.floor((b.measuredHeight ?? 4) / fh))
    return Math.min(Math.max(f, 1), mf)
  }
  const [floor, setFloor] = useState(() => initialFloor(selected))
  const [lastSel, setLastSel] = useState<number | null>(selected?.id ?? null)
  if ((selected?.id ?? null) !== lastSel) {
    setLastSel(selected?.id ?? null)
    setFloor(initialFloor(selected))
  }

  const tall = useMemo(() => atlas.buildings
    .filter((b) => (b.gridCells ?? 0) > 60 && b.measuredHeight)
    .sort((x, y) => (y.measuredHeight ?? 0) - (x.measuredHeight ?? 0))
    .slice(0, 8), [atlas])

  if (!selected) {
    return (
      <>
        <section className="card">
          <h3>空中のご近所さん</h3>
          <p className="hint" style={{ marginTop: 0 }}>「40階に住んでるの？　でも、あそこの地面より低いよ」<br />建物とフロアを選ぶと、同じ標高にある別の建物のフロアや、ほかの街の地面の高さと比べられます。</p>
          <button className="btn" style={{ marginTop: 8 }} onClick={onPickMode}>断面上の建物をクリックして選ぶ</button>
        </section>
        <section className="card">
          <h3>このエリアの高い建物</h3>
          <div className="list">
            {tall.map((b) => (
              <div key={b.id} className="list-item" onClick={() => onSelect(b.id)}>
                <span>{nameOf(b)}</span><span className="r num">{fmt(b.measuredHeight, 0)} m{b.storeysAbove ? `・${b.storeysAbove}F` : ''}</span>
              </div>
            ))}
          </div>
        </section>
      </>
    )
  }

  const fh = floorHeight(selected)
  const tp = floorTP(selected, floor)
  const tol = 1.5
  const neighbors = atlas.buildings.filter((b) => b.id !== selected.id && b.groundTP != null && b.storeysAbove && (b.gridCells ?? 0) > 0)
    .map((b) => {
      const h = floorHeight(b).h
      const n = Math.round((tp - b.groundTP!) / h) + 1
      return { b, n, z: floorTP(b, n) }
    })
    .filter(({ b, n, z }) => n >= 1 && n <= b.storeysAbove! && Math.abs(z - tp) <= tol)
    .sort((x, y) => (y.b.measuredHeight ?? 0) - (x.b.measuredHeight ?? 0))
    .slice(0, 8)

  const stations = ref?.stations ?? []
  const lower = [...stations].filter((s) => s.elevation <= tp).pop()
  const higher = stations.find((s) => s.elevation > tp)

  return (
    <>
      <section className="card">
        <h3>{nameOf(selected)}</h3>
        <dl className="kv num">
          <dt>用途</dt><dd>{selected.usage ?? '—'}</dd>
          <dt>計測高さ</dt><dd>{fmt(selected.measuredHeight, 1)} m</dd>
          <dt>地上階数</dt><dd>{selected.storeysAbove ? `${selected.storeysAbove}階` : '不明'}{selected.storeysBelow ? `・地下${selected.storeysBelow}階` : ''}</dd>
          <dt>地盤の標高</dt><dd>T.P. {fmt(selected.groundTP, 1)} m</dd>
          <dt>1階あたり（推定）</dt><dd>{fmt(fh.h, 2)} m</dd>
        </dl>
        {selected.alias && <p className="hint">PLATEAU上の名称：{selected.name}</p>}
        <div className="pair-row" style={{ marginTop: 8 }}>
          <button className="btn small" onClick={() => onSelect(null)}>選択解除</button>
        </div>
      </section>
      <section className="card">
        <h3>フロアを選ぶ</h3>
        <div className="field-head"><span>{floor}階の床（推定）</span><b className="num">T.P. {fmt(tp, 1)} m</b></div>
        <input type="range" min={1} max={maxFloor} step={1} value={Math.min(floor, maxFloor)} onChange={(e) => setFloor(Number(e.target.value))} aria-label="階" />
        <div className="pair-row" style={{ marginTop: 6 }}>
          <button className="btn small" onClick={() => onElevation(tp + 1.5)}>このフロアの高さで輪切り</button>
        </div>
        <p className="hint">床の標高 = 地盤標高 +（階 − 1）× 計測高さ÷地上階数。{fh.estimated === 'default' ? '階数が不明なため階高4mと仮定。' : ''}屋上設備を含む計測高さを使うため実際の床とは数m異なる場合があります。</p>
      </section>
      <section className="card">
        <h3>同じ標高のご近所さん</h3>
        {neighbors.length ? (
          <div className="list">
            {neighbors.map(({ b, n, z }) => (
              <div key={b.id} className="list-item" onClick={() => onSelect(b.id)}>
                <span>{nameOf(b)}</span><span className="r num">{n}階付近・T.P. {fmt(z, 1)} m</span>
              </div>
            ))}
          </div>
        ) : <div className="empty">±{tol} m以内に該当するフロアは見つかりませんでした</div>}
        <p className="hint">いずれも推定値です。地盤の高さが違うと、同じ標高でも階数が変わります。</p>
      </section>
      <section className="card">
        <h3>ほかの街の地面と比べると</h3>
        {ref ? (
          <>
            <p style={{ margin: '0 0 8px', fontSize: 13.5 }}>
              {floor}階の床（T.P. {fmt(tp, 0)} m）は
              {higher ? <><b>{higher.name}</b>前の地面（{fmt(higher.elevation, 0)} m）より<b style={{ color: 'var(--accent)' }}> {fmt(higher.elevation - tp, 0)} m 低い</b></> : 'リストのどの駅前の地面よりも高い'}
              {lower && <>。{lower.name}前の地面（{fmt(lower.elevation, 0)} m）よりは高い位置です。</>}
            </p>
            <StationLadder stations={stations} tp={tp} label={`${floor}階`} />
            <p className="hint">{ref.sources.stations}</p>
          </>
        ) : <div className="empty">標高データを読み込み中…</div>}
      </section>
    </>
  )
}

function StationLadder({ stations, tp, label }: { stations: Reference['stations']; tp: number; label: string }) {
  const items = [...stations.map((s) => ({ name: s.name, z: s.elevation, me: false })), { name: label, z: tp, me: true }]
    .sort((a, b) => b.z - a.z)
  const meIdx = items.findIndex((i) => i.me)
  const show = items.slice(Math.max(0, meIdx - 3), meIdx + 4)
  return (
    <div className="list" style={{ maxHeight: 'none' }}>
      {show.map((i) => (
        <div key={i.name} className="list-item" style={i.me ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}>
          <span>{i.me ? `◆ ${i.name}（推定）` : `${i.name}前の地面`}</span><span className="r num">T.P. {fmt(i.z, 0)} m</span>
        </div>
      ))}
    </div>
  )
}

export function MountainPanel({ atlas, elevation, groundTP, selected }: {
  atlas: Atlas; elevation: number; groundTP: number; selected: BuildingInfo | null
}) {
  const { ref, err } = useReference()
  const tallest = useMemo(() => atlas.buildings.filter((b) => (b.gridCells ?? 0) > 60)
    .reduce<BuildingInfo | null>((m, b) => ((b.measuredHeight ?? 0) > (m?.measuredHeight ?? 0) ? b : m), null), [atlas])
  const rise = Math.max(0, elevation - groundTP)
  if (err) return <div className="empty">参照データを読み込めませんでした（{err}）</div>
  if (!ref) return <div className="empty">参照データを読み込み中…</div>
  return (
    <>
      <section className="card">
        <h3>登山の高さをビルで体感</h3>
        <p style={{ margin: 0, fontSize: 13.5 }}>
          いまの断面は地表から <b className="num" style={{ color: 'var(--accent)' }}>約{fmt(rise, 0)} m</b>。
          {selected && <>選択中の{nameOf(selected)}は計測高さ {fmt(selected.measuredHeight, 0)} m です。</>}
        </p>
        <p className="hint">断面の標高を動かすと、登山道の「どのあたりまで登った高さか」が変わります（獲得標高差での比較）。</p>
      </section>
      {ref.routes.map((r) => {
        const target = r.trailheadElevation + rise
        const hit = r.profile.find(([, e]) => e >= target)
        const pct = Math.min(100, (rise / r.gain) * 100)
        return (
          <section className="card" key={r.name}>
            <h3>{r.name}</h3>
            <div className="field-head"><span>{r.trailhead}（{fmt(r.trailheadElevation, 0)} m）から山頂 {r.summit} m</span></div>
            <div className="field-head"><span>獲得標高差 約{r.gain} m のうち</span><b className="num">{fmt(pct, 0)}%</b></div>
            <div className="metric" style={{ padding: 0, border: 0, background: 'none' }}>
              <div className="bar" style={{ height: 6 }}><div style={{ width: `${pct}%`, background: 'var(--accent)' }} /></div>
            </div>
            <div style={{ height: 90, marginTop: 6 }}>
              <ResponsiveContainer>
                <AreaChart data={r.profile.map(([d, e]) => ({ d, e }))} margin={{ top: 4, right: 6, left: -24, bottom: 0 }}>
                  <XAxis dataKey="d" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: '#7d889e', fontSize: 10 }} stroke="#46526a" tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}km`} />
                  <YAxis tick={{ fill: '#7d889e', fontSize: 10 }} stroke="#46526a" domain={['dataMin - 20', 'dataMax + 20']} tickFormatter={(v: number) => `${Math.round(v)}`} />
                  <Area dataKey="e" type="monotone" stroke="#8b93a7" fill="#8b93a7" fillOpacity={0.2} isAnimationActive={false} />
                  <ReferenceLine y={target} stroke="#ff9a5c" strokeDasharray="4 3" />
                  {hit && <ReferenceDot x={hit[0]} y={hit[1]} r={5} fill="#ff9a5c" stroke="#1a0d04" />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {tallest?.measuredHeight && (
              <p className="hint num">この標高差は{nameOf(tallest)}（{fmt(tallest.measuredHeight, 0)} m）約{fmt(r.gain / tallest.measuredHeight, 1)}棟分</p>
            )}
          </section>
        )
      })}
      <p className="note">山頂：{ref.sources.summits}。断面図：{ref.sources.profiles}。</p>
    </>
  )
}
