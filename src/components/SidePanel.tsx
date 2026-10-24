import type { Pair } from '../App'
import type { LevelProfile } from '../analysis/profile'
import type { RouteResult } from '../analysis/route3d'
import type { SliceAnalysis } from '../analysis/slice'
import type { Atlas } from '../data/atlas'
import type { BuildingInfo } from '../data/types'
import { fmt, fmtArea } from '../lib/format'
import type { UpperMode } from '../viewer/AtlasScene'
import { COLORS, type ViewMode } from '../viewer/sliceTexture'
import ElevationSlider from './ElevationSlider'
import { MountainPanel, NeighborPanel } from './Explore'

export type SideTab = 'analysis' | 'pair' | 'neighbors' | 'mountain' | 'route'

interface Props {
  atlas: Atlas | null
  tab: SideTab
  onTab: (t: SideTab) => void
  elevation: number
  onElevation: (z: number) => void
  playing: boolean
  onPlay: () => void
  zMax: number
  groundTP: number
  profile: LevelProfile[] | null
  landmarks: { name: string; tp: number }[]
  analysis: SliceAnalysis | null
  mode: ViewMode
  onMode: (m: ViewMode) => void
  clearanceM: number
  onClearance: (v: number) => void
  marginM: number
  onMargin: (v: number) => void
  upperMode: UpperMode
  onUpperMode: (m: UpperMode) => void
  sliceOpacity: number
  onSliceOpacity: (v: number) => void
  showOrtho: boolean
  onShowOrtho: (v: boolean) => void
  showBase: boolean
  onShowBase: (v: boolean) => void
  pair: Pair
  onPair: (p: Pair) => void
  pickMode: 'a' | 'b' | 'building' | null
  onPickMode: (m: 'a' | 'b' | 'building' | null) => void
  path2d: number[] | null
  pairInfo: { lowest: number | null; stable: number | null } | null
  selected: BuildingInfo | null
  onSelect: (id: number | null) => void
  route: (RouteResult & { running?: boolean }) | null
  onRunRoute: () => void
  routeMaxTP: number
  onRouteMaxTP: (v: number) => void
  volumeReady: boolean
}

const TABS: [SideTab, string][] = [
  ['analysis', '断面解析'],
  ['pair', '2地点'],
  ['neighbors', 'ご近所さん'],
  ['mountain', '山と比べる'],
  ['route', '経路（実験）'],
]

function Metric({ k, v, unit, bar, color, title }: { k: string; v: string; unit?: string; bar?: number | null; color?: string; title?: string }) {
  return (
    <div className="metric" title={title}>
      <div className="k">{k}</div>
      <div className="v num">{v}{unit && <small>{unit}</small>}</div>
      {bar != null && <div className="bar"><div style={{ width: `${Math.min(100, Math.max(0, bar))}%`, background: color }} /></div>}
    </div>
  )
}

/** Demo pairs: west (Marunouchi) ↔ east (Yaesu) of Tokyo Station, chosen on open ground. */
const PRESET_PAIRS: Record<string, { a: [number, number]; b: [number, number]; label: string }> = {
  'tokyo-station': { a: [30, 110], b: [236, 150], label: '丸の内側 ↔ 八重洲側' },
  synthetic: { a: [40, 32], b: [56, 32], label: '壁の西 ↔ 壁の東' },
}

export default function SidePanel(p: Props) {
  const a = p.atlas
  const s = p.analysis?.summary
  const dx = a?.grid.dx ?? 2
  return (
    <aside className="side">
      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={p.tab === id} className={p.tab === id ? 'on' : ''} onClick={() => p.onTab(id)}>{label}</button>
        ))}
      </nav>
      <div className="side-scroll">
        {p.tab === 'analysis' && a && (
          <>
            <section className="card">
              <h3><span className="step">1</span>標高を動かす</h3>
              <div className="elev-block">
                <ElevationSlider
                  min={a.grid.z0} max={p.zMax} value={p.elevation} step={a.grid.dz} onChange={p.onElevation}
                  profile={p.profile} z0={a.grid.z0} dz={a.grid.dz} groundTP={p.groundTP} landmarks={p.landmarks}
                />
                <div className="metrics">
                  <Metric k="建物占有率" v={fmt(s?.ratio ?? null, 1)} unit="%" bar={s?.ratio} color={COLORS.building}
                    title="建物セル ÷ 判定可能セル（地中を除く）" />
                  <Metric k="空間率" v={fmt(s?.ratio != null ? 100 - s.ratio : null, 1)} unit="%" bar={s?.ratio != null ? 100 - s.ratio : null} color="#8fb8ff" />
                  <Metric k="最大連結領域" v={fmt(s?.largestShare != null ? s.largestShare * 100 : null, 1)} unit="%"
                    bar={s?.largestShare != null ? s.largestShare * 100 : null} color={COLORS.largest}
                    title="通行可能な空きセルのうち、最大の連結領域が占める割合" />
                  <Metric k="連結成分（100m²以上 / すべて）" v={s ? `${s.significantCount} / ${s.componentCount}` : '—'} />
                </div>
              </div>
              <div className="play-row">
                <button className={`btn ${p.playing ? 'active' : 'primary'}`} onClick={p.onPlay} title="Space">
                  {p.playing ? '■ 停止' : '▶ 断面を上下に動かす'}
                </button>
                <button className="btn" onClick={() => p.onElevation(Math.max(a.grid.z0, a.levelCenter(a.levelOf(p.elevation)) - a.grid.dz))} title="↓" aria-label="1段下へ">▼</button>
                <button className="btn" onClick={() => p.onElevation(Math.min(p.zMax - 0.01, a.levelCenter(a.levelOf(p.elevation)) + a.grid.dz))} title="↑" aria-label="1段上へ">▲</button>
              </div>
              {s && (
                <p className="hint num">
                  判定可能 {fmtArea(s.judged * dx * dx)}・建物 {fmtArea(s.occupied * dx * dx)}
                  {s.judged < a.grid.nx * a.grid.ny && <>・地中 {fmtArea((a.grid.nx * a.grid.ny - s.judged) * dx * dx)}（分母から除外）</>}
                </p>
              )}
            </section>

            <section className="card">
              <h3><span className="step">2</span>見方を切り替える</h3>
              <div className="seg full">
                <button className={p.mode === 'occupancy' ? 'on' : ''} onClick={() => p.onMode('occupancy')}>占有</button>
                <button className={p.mode === 'components' ? 'on' : ''} onClick={() => p.onMode('components')}>連結</button>
                <button className={p.mode === 'clearance' ? 'on' : ''} onClick={() => p.onMode('clearance')}>離隔</button>
              </div>
              <p className="hint">
                {p.mode === 'occupancy' && '建物が占めるセル（オレンジ）と空き空間。高さとともに都市が「痩せて」いく様子を見ます。'}
                {p.mode === 'components' && '空きセルを上下左右（4近傍）でつないだ領域ごとに色分け。中庭などの閉じた空間が分かれて見えます。'}
                {p.mode === 'clearance' && '空きセルから最寄りの建物までの距離。明るいほど建物から離れた「ひらけた空」です。'}
              </p>
              <div className="field">
                <div className="field-head"><span>建物からの離隔距離</span><b className="num">{p.clearanceM} m 以上</b></div>
                <input type="range" min={0} max={30} step={1} value={p.clearanceM} onChange={(e) => p.onClearance(Number(e.target.value))} aria-label="離隔距離" />
                <p className="hint">この距離を確保できない狭い隙間は「通れない」として連結解析から除きます。</p>
              </div>
              <div className="field">
                <div className="field-head"><span>境界帯の除外</span><b className="num">{p.marginM} m</b></div>
                <input type="range" min={0} max={40} step={2} value={p.marginM} onChange={(e) => p.onMargin(Number(e.target.value))} aria-label="境界帯" />
                <p className="hint">範囲の縁を回り込むだけでつながる「見かけの連結」を確認するため、外周の帯を解析から外します。</p>
              </div>
            </section>

            <section className="card">
              <h3><span className="step">3</span>表示</h3>
              <div className="field-head" style={{ marginBottom: 6 }}><span>断面より上の建物</span></div>
              <div className="seg full">
                <button className={p.upperMode === 'ghost' ? 'on' : ''} onClick={() => p.onUpperMode('ghost')}>半透明</button>
                <button className={p.upperMode === 'cut' ? 'on' : ''} onClick={() => p.onUpperMode('cut')}>カット</button>
                <button className={p.upperMode === 'solid' ? 'on' : ''} onClick={() => p.onUpperMode('solid')}>そのまま</button>
              </div>
              <div className="field">
                <div className="field-head"><span>断面の不透明度</span><b className="num">{Math.round(p.sliceOpacity * 100)}%</b></div>
                <input type="range" min={0.2} max={1} step={0.02} value={p.sliceOpacity} onChange={(e) => p.onSliceOpacity(Number(e.target.value))} aria-label="断面の不透明度" />
              </div>
              <div className="field" style={{ display: 'flex', gap: 14 }}>
                <label><input type="checkbox" checked={p.showOrtho} onChange={(e) => p.onShowOrtho(e.target.checked)} /> 航空写真</label>
                <label><input type="checkbox" checked={p.showBase} onChange={(e) => p.onShowBase(e.target.checked)} /> 背景地図</label>
              </div>
            </section>
          </>
        )}

        {p.tab === 'pair' && a && <PairPanel {...p} />}
        {p.tab === 'neighbors' && a && <NeighborPanel atlas={a} selected={p.selected} onSelect={p.onSelect} onElevation={p.onElevation} elevation={p.elevation} onPickMode={() => p.onPickMode('building')} />}
        {p.tab === 'mountain' && a && <MountainPanel atlas={a} elevation={p.elevation} groundTP={p.groundTP} selected={p.selected} />}
        {p.tab === 'route' && a && <RoutePanel {...p} />}
      </div>
    </aside>
  )
}

function PairPanel(p: Props) {
  const a = p.atlas!
  const nx = a.grid.nx
  const preset = PRESET_PAIRS[a.attrs.area_id]
  const ready = p.pair.a != null && p.pair.b != null
  const abHere = ready && p.analysis ? p.analysis.comps.labels[p.pair.a!] !== 0 && p.analysis.comps.labels[p.pair.a!] === p.analysis.comps.labels[p.pair.b!] : null
  const pathLen = p.path2d ? p.path2d.slice(1).reduce((acc, idx, i) => {
    const prev = p.path2d![i]
    return acc + Math.hypot((idx % nx) - (prev % nx), Math.floor(idx / nx) - Math.floor(prev / nx)) * a.grid.dx
  }, 0) : null
  const straight = ready ? Math.hypot((p.pair.a! % nx) - (p.pair.b! % nx), Math.floor(p.pair.a! / nx) - Math.floor(p.pair.b! / nx)) * a.grid.dx : null
  return (
    <>
      <section className="card">
        <h3><span className="step">1</span>2つの地点を指定する</h3>
        <div className="pair-row">
          <button className={`btn ${p.pickMode === 'a' ? 'active' : ''}`} onClick={() => p.onPickMode(p.pickMode === 'a' ? null : 'a')}>
            <i className="sw" style={{ background: '#7ef0c0', borderRadius: '50%' }} />地点A{p.pair.a != null ? '（変更）' : 'を指定'}
          </button>
          <button className={`btn ${p.pickMode === 'b' ? 'active' : ''}`} onClick={() => p.onPickMode(p.pickMode === 'b' ? null : 'b')}>
            <i className="sw" style={{ background: '#ffd166', borderRadius: '50%' }} />地点B{p.pair.b != null ? '（変更）' : 'を指定'}
          </button>
        </div>
        <div className="pair-row" style={{ marginTop: 8 }}>
          {preset && (
            <button className="btn small" onClick={() => p.onPair({ a: preset.a[1] * nx + preset.a[0], b: preset.b[1] * nx + preset.b[0] })}>
              例：{preset.label}
            </button>
          )}
          <button className="btn small ghost" onClick={() => p.onPair({ a: null, b: null })} disabled={p.pair.a == null && p.pair.b == null}>クリア</button>
        </div>
        <p className="hint">地点は水平位置だけを指定します。標高は断面のスライダーで動かし、同じ高さどうしでつながっているかを判定します。</p>
      </section>

      {ready && (
        <section className="card">
          <h3><span className="step">2</span>結果</h3>
          <div className={`result ${abHere ? 'ok' : 'ng'}`}>
            <div className="note">T.P. {fmt(p.elevation, 1)} m の断面で</div>
            <div className="status" style={{ fontSize: 18, marginTop: 2 }}>
              <span className="dot" style={{ background: abHere ? 'var(--good)' : 'var(--bad)' }} />
              {abHere ? 'AとBは空でつながっています' : 'AとBはつながっていません'}
            </div>
            {abHere && pathLen != null && straight != null && (
              <div className="note num" style={{ marginTop: 4 }}>
                最短の通り道 約{fmt(pathLen, 0)} m（直線距離 {fmt(straight, 0)} m の {fmt(pathLen / Math.max(straight, 1), 2)} 倍）
              </div>
            )}
            {!abHere && p.analysis && (p.analysis.comps.labels[p.pair.a!] === 0 || p.analysis.comps.labels[p.pair.b!] === 0) && (
              <div className="note">地点が建物内・地中、または離隔不足の位置にあります</div>
            )}
          </div>
          <div className="result">
            <div className="note">この2地点が同じ高さでつながる最も低い標高</div>
            {p.pairInfo ? (
              <>
                <div className="big num">{p.pairInfo.lowest != null ? `T.P. ${fmt(p.pairInfo.lowest, 1)} m` : 'つながりません'}</div>
                {p.pairInfo.stable != null && p.pairInfo.stable !== p.pairInfo.lowest && (
                  <div className="note num">T.P. {fmt(p.pairInfo.stable, 1)} m より上では常につながります</div>
                )}
                <div className="pair-row" style={{ marginTop: 8 }}>
                  {p.pairInfo.lowest != null && <button className="btn small" onClick={() => p.onElevation(p.pairInfo!.lowest!)}>その高さへ移動</button>}
                </div>
              </>
            ) : <div className="note">全高度を解析中…</div>}
            <p className="hint">条件：離隔 {p.clearanceM} m 以上・境界帯 {p.marginM} m 除外（「断面解析」タブで変更）。グラフの緑の帯がつながる高度です。</p>
          </div>
        </section>
      )}
      <div className="disclaimer">空間の連結性は建物形状だけから求めた幾何学的な結果です。ドローンの飛行安全性や法的な飛行可否を示すものではありません。</div>
    </>
  )
}

function RoutePanel(p: Props) {
  const a = p.atlas!
  const ready = p.pair.a != null && p.pair.b != null
  const r = p.route
  const reason: Record<string, string> = {
    start: '地点Aがこの高さでは建物内・地中・離隔不足です',
    goal: '地点Bがこの高さでは建物内・地中・離隔不足です',
    unreachable: '上限高度までの範囲では経路が見つかりませんでした',
  }
  return (
    <>
      <div className="disclaimer">
        実験的な機能です。3D占有グリッド上でA*探索した幾何学的な経路で、航空法・飛行禁止区域・気象・電波・第三者上空などの条件は考慮していません。飛行計画には使用できません。
      </div>
      <section className="card">
        <h3><span className="step">1</span>出発地と目的地</h3>
        {ready ? (
          <p className="hint" style={{ marginTop: 0 }}>「2地点」タブで指定したA→Bを、現在の断面の高さ（T.P. {fmt(a.levelCenter(a.levelOf(p.elevation)), 1)} m）から出発・到着として探索します。</p>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>先に「2地点」タブで地点A・Bを指定してください。</p>
            <button className="btn small" onClick={() => p.onTab('pair')}>2地点を指定する</button>
          </>
        )}
      </section>
      <section className="card">
        <h3><span className="step">2</span>条件</h3>
        <div className="field">
          <div className="field-head"><span>飛行上限（T.P.）</span><b className="num">{p.routeMaxTP} m</b></div>
          <input type="range" min={Math.ceil(a.grid.z0 + a.grid.dz)} max={Math.floor(p.zMax)} step={3} value={p.routeMaxTP} onChange={(e) => p.onRouteMaxTP(Number(e.target.value))} aria-label="飛行上限" />
        </div>
        <p className="hint">水平の離隔は「断面解析」タブの設定（現在 {p.clearanceM} m）を使います。上昇は水平移動の1.6倍のコストとして、なるべく高度を変えない経路を優先します。</p>
        <button className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={!ready || !p.volumeReady || r?.running} onClick={p.onRunRoute}>
          {r?.running ? '探索中…' : !p.volumeReady ? 'ボリューム読み込み中…' : '経路を探索'}
        </button>
      </section>
      {r && !r.running && (
        <section className="card">
          <h3>結果</h3>
          {r.cells.length ? (
            <dl className="kv num">
              <dt>経路長</dt><dd>{fmt(r.lengthM, 0)} m</dd>
              <dt>上昇量の合計</dt><dd>{fmt(r.climbM, 0)} m</dd>
              <dt>最高到達</dt><dd>T.P. {fmt(a.levelCenter(Math.max(...r.cells.map((c) => c[2]))), 1)} m</dd>
              <dt>探索したボクセル</dt><dd>{r.expanded.toLocaleString('ja-JP')}</dd>
            </dl>
          ) : <p className="hint">{reason[r.reason ?? ''] ?? r.reason}</p>}
        </section>
      )}
    </>
  )
}
