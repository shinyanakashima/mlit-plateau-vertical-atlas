import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { runProfile, runRoute, runStrata } from './analysis/client'
import { lowestConnectedLevel, stableConnectedLevel, type LevelProfile } from './analysis/profile'
import type { RouteResult } from './analysis/route3d'
import { analyzeSlice, shortestPath, simplifyPath, type SliceAnalysis } from './analysis/slice'
import type { StrataRow } from './analysis/strata'
import { ProfileCharts, StrataChart, STRATA_CATEGORIES, usageCategory } from './components/Charts'
import Header from './components/Header'
import { AboutModal, HelpModal } from './components/Modals'
import SidePanel, { type SideTab } from './components/SidePanel'
import { HoverTip, Legend } from './components/Overlays'
import DemoBar from './components/DemoBar'
import { GENERIC_STEPS, SYNTHETIC_STEPS, TOKYO_STEPS, type DemoContext, type DemoStep } from './demo'
import { PRESET_PAIRS } from './presets'
import { Atlas, loadIndex } from './data/atlas'
import type { AreaIndexEntry, Lod } from './data/types'
import { floorLabel, fmt, median } from './lib/format'
import type { AtlasScene, GridPick, UpperMode } from './viewer/AtlasScene'
import CesiumView, { type Marker } from './viewer/CesiumView'
import { renderSlice, type ViewMode } from './viewer/sliceTexture'

export interface Pair { a: number | null; b: number | null }
export interface HoverState { pick: GridPick; x: number; y: number }

const PLAY_SPEED_M_S = 22

function readUrl() {
  const q = new URLSearchParams(location.search)
  return {
    area: q.get('area'),
    z: q.get('z') ? Number(q.get('z')) : null,
    mode: q.get('mode') as ViewMode | null,
    demo: q.has('demo'),
    tour: q.has('tour'),
  }
}

export default function App() {
  const url = useMemo(readUrl, [])
  const [areas, setAreas] = useState<AreaIndexEntry[]>([])
  const [areaId, setAreaId] = useState<string | null>(null)
  const [atlas, setAtlas] = useState<Atlas | null>(null)
  const [loadState, setLoadState] = useState<{ step: string; error?: string } | null>({ step: 'データ一覧を読み込み中' })
  const [lod, setLod] = useState<Lod>('lod2')
  const [elevation, setElevation] = useState(30)
  const [playing, setPlaying] = useState(false)
  const [mode, setMode] = useState<ViewMode>(url.mode ?? 'occupancy')
  const [clearanceM, setClearanceM] = useState(0)
  const [marginM, setMarginM] = useState(0)
  const [upperMode, setUpperMode] = useState<UpperMode>('ghost')
  const [sliceOpacity, setSliceOpacity] = useState(0.92)
  const [showOrtho, setShowOrtho] = useState(true)
  const [showBase, setShowBase] = useState(true)
  const [pair, setPair] = useState<Pair>({ a: null, b: null })
  const [pickMode, setPickMode] = useState<'a' | 'b' | 'building' | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [level, setLevel] = useState<Uint8Array | null>(null)
  const [bidLevel, setBidLevel] = useState<Uint16Array | null>(null)
  const [volume, setVolume] = useState<Uint8Array | null>(null)
  const [volProgress, setVolProgress] = useState<[number, number]>([0, 0])
  const [profile, setProfile] = useState<LevelProfile[] | null>(null)
  const [strata, setStrata] = useState<StrataRow[] | null>(null)
  const [bottomTab, setBottomTab] = useState<'profile' | 'strata'>('profile')
  const [bottomOpen, setBottomOpen] = useState(true)
  const [sideTab, setSideTab] = useState<SideTab>('analysis')
  const [hover, setHover] = useState<HoverState | null>(null)
  const [help, setHelp] = useState(() => {
    try { return !url.demo && localStorage.getItem('pva-help-seen') !== '1' } catch { return true }
  })
  const [about, setAbout] = useState(false)
  const [route, setRoute] = useState<(RouteResult & { running?: boolean }) | null>(null)
  const [routeMaxTP, setRouteMaxTP] = useState(120)
  const [modelError, setModelError] = useState<string | null>(null)
  const sceneRef = useRef<AtlasScene | null>(null)
  const [demoIndex, setDemoIndex] = useState<number | null>(null)
  const [demoWantsPairLowest, setDemoWantsPairLowest] = useState(false)

  // ---- area index & atlas loading ---------------------------------------------------------
  useEffect(() => {
    loadIndex()
      .then((idx) => {
        setAreas(idx.areas)
        const want = url.area && idx.areas.some((a) => a.id === url.area) ? url.area : idx.default
        setAreaId(want)
      })
      .catch((e) => setLoadState({ step: 'データ一覧を読み込めませんでした', error: String(e) }))
  }, [url.area])

  useEffect(() => {
    if (!areaId) return
    let alive = true
    setLoadState({ step: 'Zarrメタデータと建物属性を読み込み中' })
    setAtlas(null)
    setVolume(null)
    setProfile(null)
    setStrata(null)
    setLevel(null)
    setPair({ a: null, b: null })
    setSelected(null)
    setRoute(null)
    Atlas.open(areaId)
      .then((a) => {
        if (!alive) return
        setAtlas(a)
        const g = median(a.ground)
        const start = url.z ?? (a.attrs.synthetic ? 4.5 : g + 28)
        setElevation(Math.min(Math.max(start, a.grid.z0), a.grid.z0 + a.grid.nz * a.grid.dz))
        setRouteMaxTP(Math.round(g + 120))
        setLoadState(null)
      })
      .catch((e) => alive && setLoadState({ step: 'データを読み込めませんでした', error: String(e) }))
    return () => { alive = false }
  }, [areaId, url.z])

  const groundTP = useMemo(() => (atlas ? median(atlas.ground) : 0), [atlas])
  const k = atlas ? atlas.levelOf(elevation) : 0
  const zMax = atlas ? atlas.grid.z0 + atlas.grid.nz * atlas.grid.dz : 100

  // current level (single chunk) – shown immediately, before the whole volume arrives
  useEffect(() => {
    if (!atlas) return
    let alive = true
    atlas.level(lod, k).then((lv) => alive && setLevel(lv)).catch((e) => alive && setLoadState({ step: '断面を読み込めませんでした', error: String(e) }))
    atlas.buildingLevel(lod, k).then((b) => alive && setBidLevel(b)).catch(() => undefined)
    return () => { alive = false }
  }, [atlas, lod, k])

  // whole volume for the profiles (streams chunks, nearest levels first)
  const kRef = useRef(k)
  kRef.current = k
  useEffect(() => {
    if (!atlas) return
    let alive = true
    setVolume(null)
    setProfile(null)
    setStrata(null)
    setVolProgress([0, atlas.grid.nz])
    atlas.volume(lod, kRef.current, (d, t) => alive && setVolProgress([d, t]))
      .then((v) => alive && setVolume(v))
      .catch((e) => alive && setLoadState({ step: 'ボリュームを読み込めませんでした', error: String(e) }))
    return () => { alive = false }
  }, [atlas, lod])

  // ---- analysis -----------------------------------------------------------------------------
  const params = useMemo(() => ({ clearanceM, marginM }), [clearanceM, marginM])
  const analysis: SliceAnalysis | null = useMemo(() => {
    if (!atlas || !level) return null
    return analyzeSlice(level, atlas.grid.nx, atlas.grid.ny, atlas.grid.dx, params, mode === 'clearance')
  }, [atlas, level, params, mode])

  useEffect(() => {
    if (!atlas || !volume) return
    let alive = true
    const g = atlas.grid
    const pr = pair.a != null && pair.b != null ? { a: pair.a, b: pair.b } : null
    runProfile({ volume, nx: g.nx, ny: g.ny, nz: g.nz, dx: g.dx, z0: g.z0, dz: g.dz, params, pair: pr })
      .then((p) => alive && setProfile(p))
      .catch(() => undefined)
    return () => { alive = false }
  }, [atlas, volume, params, pair])

  useEffect(() => {
    if (!atlas || !volume || bottomTab !== 'strata' || strata) return
    let alive = true
    const g = atlas.grid
    const n = g.nx * g.ny
    Promise.all(Array.from({ length: g.nz }, (_, kk) => atlas.buildingLevel(lod, kk))).then((levels) => {
      if (!alive) return
      const bid = new Uint16Array(n * g.nz)
      levels.forEach((l, kk) => bid.set(l, kk * n))
      const category = new Uint8Array(atlas.buildings.length + 1)
      atlas.buildings.forEach((b) => { category[b.id] = usageCategory(b.usage) })
      return runStrata({ bid, occ: volume, nx: g.nx, ny: g.ny, nz: g.nz, category, categories: STRATA_CATEGORIES })
    }).then((r) => alive && r && setStrata(r)).catch(() => undefined)
    return () => { alive = false }
  }, [atlas, volume, bottomTab, strata, lod])

  const current = profile?.[k] ?? null
  // charts follow the slice with low priority so that dragging/playing stays smooth
  const chartElevation = useDeferredValue(elevation)
  const chartCurrent = useDeferredValue(current)

  // pair: path on the current level
  const path2d = useMemo(() => {
    if (!atlas || !analysis || pair.a == null || pair.b == null) return null
    const p = shortestPath(analysis.mask, atlas.grid.nx, atlas.grid.ny, pair.a, pair.b)
    return p ? simplifyPath(p, analysis.mask, atlas.grid.nx) : null
  }, [atlas, analysis, pair])
  const pairInfo = useMemo(() => {
    if (!profile || pair.a == null || pair.b == null || !atlas) return null
    const low = lowestConnectedLevel(profile)
    const stable = stableConnectedLevel(profile)
    return {
      lowest: low != null ? atlas.levelCenter(low) : null,
      stable: stable != null ? atlas.levelCenter(stable) : null,
    }
  }, [profile, pair, atlas])

  // ---- texture ------------------------------------------------------------------------------
  const focusComponent = analysis && pair.a != null ? analysis.comps.labels[pair.a] || null : null
  const texture = useMemo(() => {
    if (!atlas || !level || !analysis) return null
    return renderSlice(level, analysis, {
      mode, dx: atlas.grid.dx, nx: atlas.grid.nx, ny: atlas.grid.ny, bid: bidLevel, selectedBuilding: selected,
      focusComponent: mode === 'components' ? focusComponent : null,
      marginCells: Math.round(marginM / atlas.grid.dx),
    })
  }, [atlas, level, analysis, mode, bidLevel, selected, focusComponent, marginM])

  // ---- animation ----------------------------------------------------------------------------
  const dirRef = useRef(1)
  useEffect(() => {
    if (!playing || !atlas) return
    let raf = 0
    let last = performance.now()
    const lo = Math.max(atlas.grid.z0 + atlas.grid.dz, groundTP + 1)
    const hi = zMax - 0.01
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      setElevation((e) => {
        let n = e + dirRef.current * PLAY_SPEED_M_S * dt
        if (n >= hi) { n = hi; dirRef.current = -1 }
        if (n <= lo) { n = lo; dirRef.current = 1 }
        return n
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, atlas, groundTP, zMax])

  // ---- interaction --------------------------------------------------------------------------
  const setElev = useCallback((z: number) => {
    setPlaying(false)
    setElevation(z)
  }, [])

  const onClick = useCallback((p: GridPick | null) => {
    if (!p || !atlas) return
    if (pickMode === 'a' || pickMode === 'b') {
      setPair((s) => ({ ...s, [pickMode]: p.index }))
      setPickMode(pickMode === 'a' && pair.b == null ? 'b' : null)
      setRoute(null)
      return
    }
    const id = bidLevel?.[p.index] ?? 0
    if (id) {
      setSelected(id)
      if (sideTab === 'analysis' || sideTab === 'pair') setSideTab('neighbors')
    } else if (pickMode === 'building') {
      setSelected(null)
    }
    if (pickMode === 'building') setPickMode(null)
  }, [atlas, pickMode, bidLevel, pair.b, sideTab])

  const onHover = useCallback((p: GridPick | null, x: number, y: number) => {
    setHover(p ? { pick: p, x, y } : null)
  }, [])


  const runRoute3D = useCallback(() => {
    if (!atlas || !volume || pair.a == null || pair.b == null) return
    const g = atlas.grid
    const kk = atlas.levelOf(elevation)
    const maxLevel = Math.max(kk, atlas.levelOf(routeMaxTP))
    setRoute({ cells: [], lengthM: 0, climbM: 0, expanded: 0, running: true })
    runRoute({
      occ: volume, nx: g.nx, ny: g.ny, nz: g.nz, dx: g.dx, dz: g.dz,
      start: [pair.a % g.nx, Math.floor(pair.a / g.nx), kk],
      goal: [pair.b % g.nx, Math.floor(pair.b / g.nx), kk],
      clearanceM, maxLevel, climbFactor: 1.6,
    }).then(setRoute).catch((e) => setRoute({ cells: [], lengthM: 0, climbM: 0, expanded: 0, reason: String(e) }))
  }, [atlas, volume, pair, elevation, routeMaxTP, clearanceM])

  const markers: Marker[] = useMemo(() => {
    const m: Marker[] = []
    if (pair.a != null) m.push({ index: pair.a, label: 'A', color: '#7ef0c0', tp: elevation })
    if (pair.b != null) m.push({ index: pair.b, label: 'B', color: '#ffd166', tp: elevation })
    return m
  }, [pair, elevation])

  const landmarks = useMemo(() => {
    if (!atlas) return []
    const seen = new Set<string>()
    return atlas.buildings
      .filter((b) => b.name && b.lod2TopTP && (b.gridCells ?? 0) > 150)
      .sort((x, y) => (y.lod2TopTP ?? 0) - (x.lod2TopTP ?? 0))
      .filter((b) => { const n = b.alias ?? b.name!; if (seen.has(n)) return false; seen.add(n); return true })
      .slice(0, 6)
      .map((b) => ({ name: b.alias ?? b.name!, tp: b.lod2TopTP! }))
  }, [atlas])

  // ---- LT demo walkthrough ------------------------------------------------------------------
  const demoSteps: DemoStep[] = atlas?.attrs.synthetic ? SYNTHETIC_STEPS
    : atlas?.attrs.area_id === 'tokyo-station' ? TOKYO_STEPS : GENERIC_STEPS
  const applyStep = useCallback((step: DemoStep) => {
    if (!atlas) return
    if (step.lod) setLod(step.lod)
    if (step.mode) setMode(step.mode)
    if (step.clearanceM != null) setClearanceM(step.clearanceM)
    if (step.marginM != null) setMarginM(step.marginM)
    if (step.upperMode) setUpperMode(step.upperMode)
    if (step.sideTab) setSideTab(step.sideTab)
    if (step.bottomTab) { setBottomTab(step.bottomTab); setBottomOpen(true) }
    if (step.pair === 'clear') setPair({ a: null, b: null })
    if (step.pair === 'preset') {
      const pr = PRESET_PAIRS[atlas.attrs.area_id]
      if (pr) setPair({ a: pr.a[1] * atlas.grid.nx + pr.a[0], b: pr.b[1] * atlas.grid.nx + pr.b[0] })
    }
    let elev: number | null = null
    if (step.elevation === 'ground') elev = atlas.levelCenter(atlas.levelOf(groundTP + 3))
    else if (typeof step.elevation === 'number') elev = step.elevation
    setDemoWantsPairLowest(step.elevation === 'pairLowest')
    if (step.select === 'tallest') {
      const t = atlas.buildings.filter((b) => (b.gridCells ?? 0) > 60)
        .reduce((m, b) => ((b.measuredHeight ?? 0) > (m?.measuredHeight ?? 0) ? b : m), atlas.buildings[0])
      // put the slice at the estimated 40th floor so the neighbour panel opens there
      elev = (t.groundTP ?? groundTP) + 39 * 4 + 1.5
      setSelected(t.id)
    }
    if (step.select === 'none') setSelected(null)
    if (elev != null) setElevation(elev)
    if (step.playing != null) setPlaying(step.playing)
    else if (elev != null) setPlaying(false)
    if (step.camera === 'home') sceneRef.current?.flyHome()
    if (step.camera === 'top') sceneRef.current?.viewTop()
  }, [atlas, groundTP])

  const goDemo = useCallback((i: number) => {
    const n = Math.max(0, Math.min(demoSteps.length - 1, i))
    setDemoIndex(n)
    setHelp(false)
    applyStep(demoSteps[n])
  }, [demoSteps, applyStep])

  useEffect(() => {
    if (demoWantsPairLowest && pairInfo?.lowest != null) {
      setElevation(pairInfo.lowest)
      setDemoWantsPairLowest(false)
    }
  }, [demoWantsPairLowest, pairInfo])

  const tourStarted = useRef(false)
  useEffect(() => {
    if (url.tour && atlas && !tourStarted.current) {
      tourStarted.current = true
      goDemo(0)
    }
  }, [url.tour, atlas, goDemo])

  const demoCtx: DemoContext = {
    pairLowest: pairInfo?.lowest ?? null,
    groundTP,
    occupancyAt: (tp) => (atlas && profile ? profile[atlas.levelOf(tp)]?.ratio ?? null : null),
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!atlas || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return
      const dz = atlas.grid.dz
      if (demoIndex != null && (e.key === 'ArrowRight' || e.key === 'PageDown')) { e.preventDefault(); goDemo(demoIndex + 1); return }
      if (demoIndex != null && (e.key === 'ArrowLeft' || e.key === 'PageUp')) { e.preventDefault(); goDemo(demoIndex - 1); return }
      if (demoIndex != null && e.key === 'Escape') { setDemoIndex(null); setPlaying(false); return }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); setElev(Math.min(zMax - 0.01, atlas.levelCenter(k) + dz)) }
      else if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); setElev(Math.max(atlas.grid.z0, atlas.levelCenter(k) - dz)) }
      else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
      else if (e.key === '1') setMode('occupancy')
      else if (e.key === '2') setMode('components')
      else if (e.key === '3') setMode('clearance')
      else if (e.key === 'h' || e.key === 'H') sceneRef.current?.flyHome()
      else if (e.key === 't' || e.key === 'T') sceneRef.current?.viewTop()
      else if (e.key === 'Escape') { setPickMode(null); setHelp(false); setAbout(false) }
      else if (e.key === '?') setHelp(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [atlas, k, zMax, setElev, demoIndex, goDemo])

  const synthetic = atlas?.attrs.synthetic === true
  const selectedInfo = selected && atlas ? atlas.building(selected) ?? null : null

  return (
    <div className={`app ${bottomOpen ? '' : 'bottom-collapsed'}`}>
      <Header
        areas={areas}
        areaId={areaId}
        onArea={(id) => { setAreaId(id); const q = new URLSearchParams(location.search); q.set('area', id); history.replaceState(null, '', `?${q}`) }}
        lod={lod}
        onLod={setLod}
        synthetic={synthetic}
        onHome={() => sceneRef.current?.flyHome()}
        onTop={() => sceneRef.current?.viewTop()}
        onHelp={() => setHelp(true)}
        demoActive={demoIndex != null}
        onDemo={() => (demoIndex == null ? goDemo(0) : (setDemoIndex(null), setPlaying(false)))}
        onAbout={() => setAbout(true)}
      />
      <div className="viewer-wrap">
        <CesiumView
          atlas={atlas}
          lod={lod}
          elevation={elevation}
          texture={texture}
          sliceOpacity={sliceOpacity}
          upperMode={upperMode}
          selectedBuilding={selected}
          markers={markers}
          path2d={sideTab === 'pair' || sideTab === 'route' ? path2d : null}
          route3d={sideTab === 'route' && route && route.cells.length ? route : null}
          showOrtho={showOrtho}
          showBase={showBase}
          onHover={onHover}
          onClick={onClick}
          onReady={(s) => { sceneRef.current = s; (window as unknown as { __pva: AtlasScene }).__pva = s }}
          onModelError={(e) => setModelError(String(e))}
        />
        {atlas && (
          <div className="overlay-tl">
            <div className="glass elev-hud">
              <div className="k">断面の標高（T.P.）</div>
              <div className="v num">{fmt(elevation, 1)}<small>m</small></div>
              <div className="sub num">
                地表から約{fmt(Math.max(0, elevation - groundTP), 0)} m ・ {floorLabel(elevation - groundTP)}
              </div>
              <div className="sub num" style={{ color: 'var(--muted)' }}>
                解析レベル {k + 1}/{atlas.grid.nz}（{fmt(atlas.grid.z0 + k * atlas.grid.dz, 0)}–{fmt(atlas.grid.z0 + (k + 1) * atlas.grid.dz, 0)} m）
              </div>
            </div>
            {synthetic && <div className="badge warn">合成データ（検証用・実在しない街区）を表示中</div>}
          </div>
        )}
        {atlas && (
          <div className="overlay-tr">
            <div className="glass chunk-chip" title="Zarrのチャンク（1高度=1チャンク）を必要な分だけHTTPで取得しています">
              <span>Zarr</span>
              <div className="chunk-bar"><div style={{ width: `${(volProgress[0] / Math.max(1, volProgress[1])) * 100}%` }} /></div>
              <span className="num">{volProgress[0]}/{volProgress[1]} 高度</span>
            </div>
          </div>
        )}
        {pickMode && (pickMode === 'a' || pickMode === 'b') && (
          <div className="glass pick-banner">
            <span>断面上をクリックして<b>{pickMode === 'a' ? '地点A' : '地点B'}</b>を指定</span>
            <button className="btn small" onClick={() => setPickMode(null)}>やめる</button>
          </div>
        )}
        {atlas && <Legend mode={mode} clearanceM={clearanceM} marginM={marginM} />}
        {atlas && demoIndex != null && (
          <DemoBar steps={demoSteps} index={demoIndex} ctx={demoCtx}
            onPrev={() => goDemo(demoIndex - 1)} onNext={() => goDemo(demoIndex + 1)}
            onClose={() => { setDemoIndex(null); setPlaying(false) }} />
        )}
        {atlas && hover && analysis && level && (
          <HoverTip hover={hover} atlas={atlas} level={level} bid={bidLevel} analysis={analysis} mode={mode} />
        )}
        {loadState && (
          <div className="loading-veil">
            <div className={`glass ${loadState.error ? 'error-card' : 'loading-card'}`}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{loadState.error ? '読み込みエラー' : 'PLATEAU Vertical Atlas'}</div>
              <div className="note" style={{ marginTop: 6 }}>{loadState.step}</div>
              {loadState.error ? (
                <>
                  <pre className="note" style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>{loadState.error}</pre>
                  <button className="btn" onClick={() => location.reload()}>再読み込み</button>
                </>
              ) : (
                <div className="progress"><div style={{ width: '60%' }} /></div>
              )}
            </div>
          </div>
        )}
        {modelError && (
          <div className="glass" style={{ position: 'absolute', bottom: 120, left: '50%', transform: 'translateX(-50%)', padding: '8px 14px', zIndex: 5 }}>
            建物モデルを表示できませんでした（断面と解析は利用できます）
            <button className="btn small" style={{ marginLeft: 10 }} onClick={() => setModelError(null)}>閉じる</button>
          </div>
        )}
        <div className="credits">
          建物: 国土交通省 Project PLATEAU ／ 背景: 地理院タイル ／ 表示: CesiumJS
        </div>
      </div>
      <SidePanel
        atlas={atlas}
        tab={sideTab}
        onTab={setSideTab}
        elevation={elevation}
        onElevation={setElev}
        playing={playing}
        onPlay={() => setPlaying((p) => !p)}
        zMax={zMax}
        groundTP={groundTP}
        profile={profile}
        landmarks={landmarks}
        analysis={analysis}
        mode={mode}
        onMode={setMode}
        clearanceM={clearanceM}
        onClearance={setClearanceM}
        marginM={marginM}
        onMargin={setMarginM}
        upperMode={upperMode}
        onUpperMode={setUpperMode}
        sliceOpacity={sliceOpacity}
        onSliceOpacity={setSliceOpacity}
        showOrtho={showOrtho}
        onShowOrtho={setShowOrtho}
        showBase={showBase}
        onShowBase={setShowBase}
        pair={pair}
        onPair={(p) => { setPair(p); setRoute(null) }}
        pickMode={pickMode}
        onPickMode={setPickMode}
        path2d={path2d}
        pairInfo={pairInfo}
        selected={selectedInfo}
        onSelect={setSelected}
        route={route}
        onRunRoute={runRoute3D}
        routeMaxTP={routeMaxTP}
        onRouteMaxTP={setRouteMaxTP}
        volumeReady={!!volume}
      />
      <div className="bottom">
        <div className="bottom-head">
          <div className="tabs">
            <button className={bottomTab === 'profile' ? 'on' : ''} onClick={() => { setBottomTab('profile'); setBottomOpen(true) }}>高度プロファイル</button>
            <button className={bottomTab === 'strata' ? 'on' : ''} onClick={() => { setBottomTab('strata'); setBottomOpen(true) }}>都市の地層図</button>
          </div>
          <span className="note">グラフをクリックすると、その標高へ断面が移動します</span>
          <button className="btn ghost small" onClick={() => setBottomOpen((o) => !o)}>{bottomOpen ? '折りたたむ' : '開く'}</button>
        </div>
        {bottomOpen && atlas && (bottomTab === 'profile'
          ? <ProfileCharts profile={profile} elevation={chartElevation} zMax={zMax} onPick={setElev} clearanceM={clearanceM} hasPair={pair.a != null && pair.b != null} current={chartCurrent} />
          : <StrataChart rows={strata} z0={atlas.grid.z0} dz={atlas.grid.dz} elevation={chartElevation} zMax={zMax} onPick={setElev} areas={areas} currentArea={atlas.attrs.area_id} groundTP={groundTP} />)}
      </div>
      {help && <HelpModal onClose={() => { setHelp(false); try { localStorage.setItem('pva-help-seen', '1') } catch { /* private mode */ } }} />}
      {about && <AboutModal atlas={atlas} onClose={() => setAbout(false)} />}
    </div>
  )
}
