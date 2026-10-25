import { Cartesian2 } from 'cesium'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Atlas, dataBaseUrl } from '../data/atlas'
import type { Lod } from '../data/types'
import { describeFloor, type FloorStory } from './describe'
import {
  classifySection, floorLabel, floorRange, levelIndex, representativeElevation, sectionStats, type SectionStats,
} from './floors'
import { MansionScene, medianGround } from './MansionScene'
import { renderSection } from './sectionTexture'
import { AboutDialog, DemoPanel, FloorGuide, FloorPlan, type CellInfo } from './parts'
import { MANSION_STEPS } from './demo'
import './mansion.css'

interface MansionConfig {
  title: string
  left: string
  right: string
  leftLabel: string
  rightLabel: string
  defaultFloor: number
}

export interface AreaState {
  atlas: Atlas
  label: string
  volume: Uint8Array | null
  loaded: number
}

/** per area, per floor: stats of the representative section */
export type FloorTable = (SectionStats | null)[][]

const RIDE_STEP_MS = 1500

export default function MansionApp() {
  const [config, setConfig] = useState<MansionConfig | null>(null)
  const [areas, setAreas] = useState<AreaState[]>([])
  const [error, setError] = useState<string | null>(null)
  const [floor, setFloor] = useState(9)
  const [lod, setLod] = useState<Lod>('lod2')
  const [riding, setRiding] = useState(false)
  const [cell, setCell] = useState<CellInfo | null>(null)
  const [bids, setBids] = useState<(Uint16Array | null)[]>([null, null])
  const [about, setAbout] = useState(false)
  const [demo, setDemo] = useState<number | null>(null)
  const [arrived, setArrived] = useState(0)
  const sceneRef = useRef<MansionScene | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const elevRef = useRef(representativeElevation(9))
  const query = useMemo(() => new URLSearchParams(location.search), [])

  // ---- load config and both areas -------------------------------------------------------------
  useEffect(() => {
    let alive = true
    fetch(`${dataBaseUrl()}mansion.json`)
      .then((r) => { if (!r.ok) throw new Error(`mansion.json ${r.status}`); return r.json() as Promise<MansionConfig> })
      .then(async (c) => {
        if (!alive) return
        setConfig(c)
        const f = Number(query.get('floor')) || c.defaultFloor
        setFloor(f)
        elevRef.current = representativeElevation(f)
        const [a, b] = await Promise.all([Atlas.open(c.left), Atlas.open(c.right)])
        if (!alive) return
        setAreas([{ atlas: a, label: c.leftLabel, volume: null, loaded: 0 }, { atlas: b, label: c.rightLabel, volume: null, loaded: 0 }])
      })
      .catch((e) => alive && setError(String(e)))
    return () => { alive = false }
  }, [query])

  // stream both volumes (Zarr chunks) for the floor guide
  useEffect(() => {
    if (areas.length !== 2 || areas.some((a) => a.volume)) return
    let alive = true
    areas.forEach((a, i) => {
      const k = levelIndex(representativeElevation(floor), a.atlas.grid.z0, a.atlas.grid.dz, a.atlas.grid.nz) ?? 0
      a.atlas.volume(lod, k, (d) => alive && setAreas((s) => s.map((x, j) => (j === i ? { ...x, loaded: d } : x))))
        .then((v) => alive && setAreas((s) => s.map((x, j) => (j === i ? { ...x, volume: v } : x))))
        .catch((e) => alive && setError(String(e)))
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas.length, lod])

  // ---- 3D scene ---------------------------------------------------------------------------------
  useEffect(() => {
    const s = new MansionScene(host.current!)
    s.onError = (e) => setError(`3Dモデルを表示できませんでした: ${String(e)}`)
    sceneRef.current = s
    ;(window as unknown as { __mansion: MansionScene }).__mansion = s
    return () => { s.destroy(); sceneRef.current = null }
  }, [])

  useEffect(() => {
    const s = sceneRef.current
    if (!s || areas.length !== 2) return
    s.setAreas(areas.map((a) => a.atlas), lod).then(() => s.flyHome()).catch((err) => console.error('setAreas failed', err?.message, err?.stack))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas.length])

  useEffect(() => { void sceneRef.current?.setLod(lod) }, [lod])

  // smooth elevator: tween the section planes to the representative elevation of the floor
  useEffect(() => {
    const target = representativeElevation(floor)
    const from = elevRef.current
    const t0 = performance.now()
    const dur = Math.min(900, 250 + Math.abs(target - from) * 12)
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const e = from + (target - from) * (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)
      elevRef.current = e
      try { sceneRef.current?.setFloor(floor, e) } catch (err) { console.error('setFloor failed', (err as Error).message, (err as Error).stack) }
      if (p < 1) raf = requestAnimationFrame(tick)
      else setArrived((n) => n + 1)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [floor, areas.length])

  // ---- sections of the current floor ------------------------------------------------------------
  const elevation = representativeElevation(floor)
  const [levels, setLevels] = useState<(Uint8Array | null)[]>([null, null])
  useEffect(() => {
    let alive = true
    areas.forEach((a, i) => {
      const g = a.atlas.grid
      const k = levelIndex(elevation, g.z0, g.dz, g.nz)
      const n = g.nx * g.ny
      if (k == null) {
        // above the top of the voxel grid: no buildings there, only free space (or ground)
        setLevels((s) => s.map((x, j) => (j === i ? new Uint8Array(n) : x)))
        setBids((s) => s.map((x, j) => (j === i ? new Uint16Array(n) : x)))
        return
      }
      const pv = a.volume ? Promise.resolve(a.volume.subarray(k * n, (k + 1) * n)) : a.atlas.level(lod, k)
      pv.then((lv) => alive && setLevels((s) => s.map((x, j) => (j === i ? lv : x))))
      a.atlas.buildingLevel(lod, k).then((b) => alive && setBids((s) => s.map((x, j) => (j === i ? b : x)))).catch(() => undefined)
    })
    return () => { alive = false }
  }, [areas, elevation, lod])

  const sections = useMemo(() => areas.map((a, i) => {
    const lv = levels[i]
    if (!lv) return null
    const classes = classifySection({ occupancy: lv, ground: a.atlas.ground, coverage: a.atlas.coverage, elevation })
    return { classes, stats: sectionStats(classes) }
  }), [areas, levels, elevation])

  const highlight = useMemo(() => areas.map((_, i) => {
    if (!cell || cell.slot !== i || !cell.buildingId || !bids[i]) return null
    const h = new Uint8Array(bids[i]!.length)
    bids[i]!.forEach((v, j) => { if (v === cell.buildingId) h[j] = 1 })
    return h
  }), [areas, cell, bids])

  const textures = useMemo(() => sections.map((s, i) => (s && areas[i]
    ? renderSection(s.classes, areas[i].atlas.grid.nx, areas[i].atlas.grid.ny, { freeAlpha: 26, highlight: highlight[i] })
    : null)), [sections, areas, highlight])
  // the 2D floor plans show free space clearly (it is the "vacant room")
  const planTextures = useMemo(() => sections.map((s, i) => (s && areas[i]
    ? renderSection(s.classes, areas[i].atlas.grid.nx, areas[i].atlas.grid.ny, { freeAlpha: 70, highlight: highlight[i] })
    : null)), [sections, areas, highlight])
  useEffect(() => { sceneRef.current?.setTextures(textures) }, [textures])

  const stories: (FloorStory | null)[] = useMemo(() => sections.map((s, i) => (s && areas[i]
    ? describeFloor(s.stats, s.classes, bids[i], (id) => areas[i].atlas.building(id), elevation) : null)), [sections, bids, areas, elevation])

  // ---- floor table (all floors × both areas) -----------------------------------------------------
  const maxFloor = useMemo(() => {
    if (areas.length !== 2) return 20
    const top = Math.max(...areas.map((a) => a.atlas.grid.z0 + a.atlas.grid.nz * a.atlas.grid.dz))
    return Math.max(10, Math.ceil(top / 10))
  }, [areas])
  const table: FloorTable | null = useMemo(() => {
    if (areas.length !== 2 || areas.some((a) => !a.volume)) return null
    return areas.map((a) => {
      const g = a.atlas.grid
      const n = g.nx * g.ny
      return Array.from({ length: maxFloor }, (_, fi) => {
        const h = representativeElevation(fi + 1)
        const k = levelIndex(h, g.z0, g.dz, g.nz)
        const occ = k == null ? new Uint8Array(n) : a.volume!.subarray(k * n, (k + 1) * n)
        return sectionStats(classifySection({ occupancy: occ, ground: a.atlas.ground, coverage: a.atlas.coverage, elevation: h }))
      })
    })
  }, [areas, maxFloor])

  // ---- elevator ride --------------------------------------------------------------------------
  const go = useCallback((f: number) => setFloor(Math.min(maxFloor, Math.max(1, f))), [maxFloor])
  const dir = useRef(1)
  useEffect(() => {
    if (!riding) return
    const t = setTimeout(() => {
      setFloor((f) => {
        if (f >= maxFloor) dir.current = -1
        if (f <= 1) dir.current = 1
        return f + dir.current
      })
    }, RIDE_STEP_MS)
    return () => clearTimeout(t)
  }, [riding, floor, maxFloor])

  // ---- demo -------------------------------------------------------------------------------------
  const applyDemo = useCallback((i: number) => {
    const s = MANSION_STEPS[Math.max(0, Math.min(MANSION_STEPS.length - 1, i))]
    setDemo(Math.max(0, Math.min(MANSION_STEPS.length - 1, i)))
    if (s.floor != null) go(s.floor)
    setRiding(!!s.ride)
    if (s.lod) setLod(s.lod)
    if (s.home) sceneRef.current?.flyHome()
    setCell(null)
  }, [go])
  const tourStarted = useRef(false)
  useEffect(() => {
    if (query.has('tour') && areas.length === 2 && !tourStarted.current) { tourStarted.current = true; applyDemo(0) }
  }, [query, areas.length, applyDemo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (demo != null && (e.key === 'ArrowRight' || e.key === 'PageDown')) { e.preventDefault(); applyDemo(demo + 1); return }
      if (demo != null && (e.key === 'ArrowLeft' || e.key === 'PageUp')) { e.preventDefault(); applyDemo(demo - 1); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setRiding(false); go(floor + 1) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setRiding(false); go(floor - 1) }
      else if (e.key === ' ') { e.preventDefault(); setRiding((r) => !r) }
      else if (e.key === 'h' || e.key === 'H') sceneRef.current?.flyHome()
      else if (e.key === 'Escape') { setDemo(null); setAbout(false); setCell(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [demo, applyDemo, floor, go])

  // click in the 3D view → cell on the section plane
  useEffect(() => {
    const s = sceneRef.current
    if (!s || areas.length !== 2) return
    const el = host.current!
    const onClick = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect()
      const hit = s.pick(new Cartesian2(ev.clientX - r.left, ev.clientY - r.top))
      if (hit) pickCell(hit.slot, hit.index)
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  })

  const pickCell = useCallback((slot: number, index: number) => {
    const a = areas[slot]
    const sec = sections[slot]
    if (!a || !sec) return
    const id = bids[slot]?.[index] ?? 0
    setCell({ slot, index, cls: sec.classes[index], groundTP: a.atlas.ground[index], buildingId: id || null, elevation })
  }, [areas, sections, bids, elevation])

  const [lo, hi] = floorRange(floor)
  const ready = areas.length === 2 && sections.every(Boolean)
  const headline = useMemo(() => {
    if (!stories[0] || !stories[1] || areas.length !== 2) return null
    const groundFloor = areas.map((a) => Math.floor(medianGround(a.atlas) / 10) + 1)
    const say = (i: number) => {
      const st = stories[i]!
      if (st.kind === 'ground') return `${areas[i].label}はまだ地面の中`
      if (groundFloor[i] === floor) return `${areas[i].label}はこの階に地面（玄関の階）`
      if (st.kind === 'building') return `${areas[i].label}は${st.headline}`
      if (st.kind === 'sky') return `${areas[i].label}はほぼ空室`
      return `${areas[i].label}は${st.headline}`
    }
    return `${say(0)}、${say(1)}。`
  }, [stories, areas, floor])

  return (
    <div className="mn-app">
      <header className="mn-header">
        <div className="mn-brand">
          <div className="mn-kicker">TOKYO MANSION ─ 仮想フロアガイド</div>
          <h1 className="mn-title">{config?.title ?? '東京は何階建て？'}</h1>
        </div>
        <div className="mn-rule">
          <b>本物件の階数ルール</b>
          <span>海抜10mごとに1フロア（1F＝海抜0〜10m）。実在の建物の階数ではありません。</span>
        </div>
        <div className="mn-actions">
          <div className="seg" role="radiogroup" aria-label="建物形状">
            <button className={lod === 'lod1' ? 'on' : ''} onClick={() => setLod('lod1')}>LOD1</button>
            <button className={lod === 'lod2' ? 'on' : ''} onClick={() => setLod('lod2')}>LOD2</button>
          </div>
          <button className={`btn mn-demo-btn ${demo != null ? 'active' : ''}`} onClick={() => (demo == null ? applyDemo(0) : setDemo(null))}>{demo != null ? 'デモ終了' : '▶ LTデモ'}</button>
          <button className="btn" onClick={() => sceneRef.current?.flyHome()}>視点を戻す</button>
          <button className="btn" onClick={() => setAbout(true)}>物件概要・出典</button>
        </div>
      </header>

      <FloorGuide
        floor={floor} maxFloor={maxFloor} onFloor={(f) => { setRiding(false); go(f) }}
        riding={riding} onRide={() => setRiding((r) => !r)} table={table} labels={areas.map((a) => a.label)}
        progress={areas.map((a) => [a.loaded, a.atlas.grid.nz])} arrived={arrived}
      />

      <main className="mn-stage">
        <div className={`mn-3d ${demo != null ? 'demo' : ''}`}>
          <div ref={host} className="mn-cesium" />
          <div className="mn-floor-banner">
            <div className="mn-led num">{floorLabel(floor)}</div>
            <div>
              <div className="mn-band num">海抜 {lo}〜{hi} m</div>
              <div className="mn-band-sub num">断面の高さ（代表高度）海抜 {elevation} m</div>
            </div>
          </div>
          {headline && <div className="mn-headline">{headline}</div>}
          {demo != null && <DemoPanel index={demo} onPrev={() => applyDemo(demo - 1)} onNext={() => applyDemo(demo + 1)} onClose={() => setDemo(null)} />}
          {!ready && !error && <div className="mn-loading">物件データ（PLATEAU・標高・Zarr）を読み込み中…</div>}
          {error && <div className="mn-error"><b>読み込みエラー</b><span>{error}</span><button className="btn" onClick={() => location.reload()}>再読み込み</button></div>}
        </div>
        <div className="mn-plans">
          {areas.map((a, i) => (
            <FloorPlan
              key={a.atlas.attrs.area_id}
              area={a} floor={floor} section={sections[i]} story={stories[i]} texture={planTextures[i]}
              groundTP={medianGround(a.atlas)} cell={cell && cell.slot === i ? cell : null}
              onPick={(idx) => pickCell(i, idx)} side={i === 0 ? 'left' : 'right'}
            />
          ))}
        </div>
      </main>
      {about && <AboutDialog areas={areas} onClose={() => setAbout(false)} />}
    </div>
  )
}
