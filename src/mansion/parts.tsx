import { useEffect, useRef } from 'react'
import type { AreaState, FloorTable } from './MansionApp'
import { buildingName, needsCheck, storeyAt, type FloorStory } from './describe'
import {
  CLASS_BUILDING, CLASS_FREE, CLASS_GROUND, CLASS_NAMES, CLASS_NODATA, floorLabel, floorRange, type SectionStats,
} from './floors'
import { MANSION_STEPS } from './demo'
import { SECTION_COLORS } from './sectionTexture'

const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v.toFixed(d)}%`)

export interface CellInfo {
  slot: number
  index: number
  cls: number
  groundTP: number
  buildingId: number | null
  elevation: number
}

// ---------------------------------------------------------------------------------------------
function MiniBar({ s }: { s: SectionStats | null }) {
  if (!s || !s.judged) return <div className="mn-mini empty" />
  const seg = [
    [CLASS_GROUND, s.groundShare ?? 0],
    [CLASS_BUILDING, s.buildingShare ?? 0],
    [CLASS_FREE, s.vacancy ?? 0],
  ] as const
  return (
    <div className="mn-mini" title={`地盤 ${pct(s.groundShare)} ／ 建物 ${pct(s.buildingShare)} ／ 空室 ${pct(s.vacancy)}`}>
      {seg.map(([c, v]) => v > 0 && <i key={c} style={{ width: `${v}%`, background: SECTION_COLORS[c] }} />)}
    </div>
  )
}

/** Elevator panel + building directory: one row per virtual floor, both areas side by side. */
export function FloorGuide({ floor, maxFloor, onFloor, riding, onRide, table, labels, progress, arrived }: {
  floor: number; maxFloor: number; onFloor: (f: number) => void; riding: boolean; onRide: () => void
  table: FloorTable | null; labels: string[]; progress: [number, number][]; arrived: number
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('.mn-row.on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [floor])
  const floors = Array.from({ length: maxFloor }, (_, i) => maxFloor - i)
  const [lo, hi] = floorRange(floor)
  return (
    <aside className="mn-guide">
      <div className="mn-elevator">
        <div className="mn-elev-display">
          <span className={`mn-arrow ${riding ? 'run' : ''}`}>▲</span>
          <span key={arrived} className="mn-elev-floor num ding">{floorLabel(floor)}</span>
          <span className="mn-elev-band num">{lo}–{hi} m</span>
        </div>
        <div className="mn-elev-buttons">
          <button className="mn-ebtn" onClick={() => onFloor(floor - 1)} disabled={floor <= 1} aria-label="1つ下の階へ">▼</button>
          <button className={`mn-ebtn wide ${riding ? 'on' : ''}`} onClick={onRide}>{riding ? '■ 停止' : '▶ 自動運転'}</button>
          <button className="mn-ebtn" onClick={() => onFloor(floor + 1)} disabled={floor >= maxFloor} aria-label="1つ上の階へ">▲</button>
        </div>
      </div>
      <div className="mn-dir-head">
        <span>フロア案内</span>
        {labels.map((l) => <span key={l}>{l}</span>)}
      </div>
      <div className="mn-dir" ref={listRef}>
        {floors.map((f) => (
          <button key={f} className={`mn-row ${f === floor ? 'on' : ''}`} onClick={() => onFloor(f)}>
            <span className="mn-fl num">{floorLabel(f)}</span>
            {[0, 1].map((i) => <MiniBar key={i} s={table?.[i]?.[f - 1] ?? null} />)}
          </button>
        ))}
      </div>
      <div className="mn-dir-legend">
        {[CLASS_GROUND, CLASS_BUILDING, CLASS_FREE].map((c) => (
          <span key={c}><i style={{ background: SECTION_COLORS[c] }} />{c === CLASS_FREE ? '空室' : CLASS_NAMES[c]}</span>
        ))}
      </div>
      {!table && (
        <div className="mn-dir-loading num">
          Zarrチャンクを読み込み中 {progress.map(([d, t]) => `${d}/${t}`).join('・')}
        </div>
      )}
    </aside>
  )
}

// ---------------------------------------------------------------------------------------------
export function FloorPlan({ area, floor, section, story, texture, groundTP, cell, onPick, side }: {
  area: AreaState; floor: number; section: { classes: Uint8Array; stats: SectionStats } | null
  story: FloorStory | null; texture: HTMLCanvasElement | null; groundTP: number; cell: CellInfo | null
  onPick: (index: number) => void; side: 'left' | 'right'
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const a = area.atlas
  const { nx, ny, dx } = a.grid
  useEffect(() => {
    const c = ref.current
    if (!c || !texture) return
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#0d1422'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(texture, 0, 0, c.width, c.height)
    if (cell) {
      const x = ((cell.index % nx) + 0.5) * (c.width / nx)
      const y = (Math.floor(cell.index / nx) + 0.5) * (c.height / ny)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.stroke()
    }
    // scale bar 100 m
    const px = (100 / (nx * dx)) * c.width
    ctx.fillStyle = 'rgba(233,238,247,.9)'
    ctx.fillRect(10, c.height - 14, px, 3)
    ctx.font = '11px "Noto Sans JP", sans-serif'
    ctx.fillText('100 m', 10, c.height - 19)
    ctx.fillText('N ↑', c.width - 30, 18)
  }, [texture, cell, nx, ny, dx])
  const s = section?.stats
  const info = cell ? describeCell(cell, area) : null
  return (
    <section className={`mn-plan ${side}`}>
      <div className="mn-plan-head">
        <div>
          <div className="mn-plan-area">{area.label}<small>{a.attrs.title.replace(/^(港区|多摩)\s*/, '')}</small></div>
          <div className="mn-plan-sub num">地面 海抜 約{Math.round(groundTP)} m（{floorLabel(Math.floor(groundTP / 10) + 1)}）・{a.attrs.subtitle}</div>
        </div>
        <div className="mn-vacancy">
          <div className="k">{floorLabel(floor)} の仮想空室率</div>
          <div className="v num">{s?.vacancy != null ? s.vacancy.toFixed(1) : '—'}<small>%</small></div>
        </div>
      </div>
      <div className="mn-plan-body">
        <canvas
          ref={ref} width={nx * 2} height={ny * 2} className="mn-canvas" aria-label={`${area.label}の${floorLabel(floor)}フロアマップ`}
          onClick={(e) => {
            const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
            const col = Math.floor(((e.clientX - r.left) / r.width) * nx)
            const row = Math.floor(((e.clientY - r.top) / r.height) * ny)
            if (col >= 0 && row >= 0 && col < nx && row < ny) onPick(row * nx + col)
          }}
        />
        <div className="mn-plan-side">
          {story && (
            <div className={`mn-story ${story.kind}`}>
              <div className="h">{story.headline}</div>
              <div className="d">{story.detail}</div>
            </div>
          )}
          <div className="mn-comp">
            {s && [CLASS_BUILDING, CLASS_GROUND, CLASS_FREE, CLASS_NODATA].map((c) => {
              const n = c === CLASS_BUILDING ? s.building : c === CLASS_GROUND ? s.ground : c === CLASS_FREE ? s.free : s.nodata
              const share = c === CLASS_NODATA ? null : c === CLASS_BUILDING ? s.buildingShare : c === CLASS_GROUND ? s.groundShare : s.vacancy
              return (
                <div key={c} className="mn-comp-row">
                  <i className={c === CLASS_NODATA ? 'hatch' : ''} style={{ background: c === CLASS_NODATA ? undefined : SECTION_COLORS[c] }} />
                  <span>{CLASS_NAMES[c]}</span>
                  <b className="num">{c === CLASS_NODATA ? `${(n * dx * dx / 10000).toFixed(2)} ha` : pct(share)}</b>
                </div>
              )
            })}
          </div>
          {info ? (
            <div className="mn-cell">
              <div className="h">{info.title}</div>
              {info.lines.map((l) => <div key={l}>{l}</div>)}
            </div>
          ) : (
            <div className="mn-cell hint">フロアマップをクリックすると、その地点の地面の標高や建物を表示します</div>
          )}
        </div>
      </div>
    </section>
  )
}

function describeCell(c: CellInfo, area: AreaState): { title: string; lines: string[] } {
  const lines: string[] = []
  const ground = Number.isFinite(c.groundTP) ? `地面の標高 海抜${c.groundTP.toFixed(1)} m（${floorLabel(Math.floor(c.groundTP / 10) + 1)}）` : '地面の標高 データなし'
  if (c.cls === CLASS_GROUND) {
    return { title: '地盤（地面の中）', lines: [ground, `断面の高さ海抜${c.elevation} mより ${(c.groundTP - c.elevation).toFixed(1)} m 上に地面`] }
  }
  if (c.cls === CLASS_NODATA) return { title: '未整備・判定不能', lines: [ground, 'PLATEAUの整備範囲外または標高データなし'] }
  if (c.cls === CLASS_BUILDING && c.buildingId) {
    const b = area.atlas.building(c.buildingId)
    if (b) {
      const s = storeyAt(b, c.elevation)
      lines.push(`計測高さ ${b.measuredHeight?.toFixed(1) ?? '—'} m・地上${b.storeysAbove ?? '?'}階・${b.usage ?? '用途不明'}`)
      if (s.storey) lines.push(`この高さは約${s.storey}階（1階あたり${s.floorHeight!.toFixed(2)} mとして推定）`)
      lines.push(ground)
      if (needsCheck(b)) lines.push('※ LOD1とLOD2の上端が大きく異なる建物です（PLATEAU属性の確認推奨）')
      return { title: buildingName(b), lines }
    }
  }
  return { title: c.cls === CLASS_FREE ? '空室（自由空間）' : '建物', lines: [ground, `地面から ${(c.elevation - c.groundTP).toFixed(1)} m 上空`] }
}

// ---------------------------------------------------------------------------------------------
export function DemoPanel({ index, onPrev, onNext, onClose }: { index: number; onPrev: () => void; onNext: () => void; onClose: () => void }) {
  const s = MANSION_STEPS[index]
  return (
    <div className="mn-demo">
      <div className="mn-demo-head">
        <span className="num">{index + 1} / {MANSION_STEPS.length}</span>
        <div className="dots">{MANSION_STEPS.map((_, i) => <i key={i} className={i === index ? 'on' : i < index ? 'done' : ''} />)}</div>
        <button className="btn ghost small" onClick={onClose}>終了 Esc</button>
      </div>
      <div className="mn-demo-title">{s.title}</div>
      <div className="mn-demo-body">{s.body}</div>
      <div className="mn-demo-nav">
        <button className="btn small" onClick={onPrev} disabled={index === 0}>← 前へ</button>
        <span className="note">→ / PageDown で次へ</span>
        <button className="btn small primary" onClick={onNext} disabled={index === MANSION_STEPS.length - 1}>次へ →</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
export function AboutDialog({ areas, onClose }: { areas: AreaState[]; onClose: () => void }) {
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="glass modal mn-about" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="物件概要">
        <div className="mn-kicker">物件概要</div>
        <h2>東京は何階建て？（TOKYO MANSION）</h2>
        <h4>階数のルール（仮想フロア）</h4>
        <ul>
          <li>海抜（東京湾平均海面 T.P.）10mごとに1フロア。1F＝0m以上10m未満、8F＝70〜80m、15F＝140〜150m。海抜0m未満はB1F</li>
          <li>実在の建物の階数・階高とは関係のない、比較のための仮想的な番号です</li>
        </ul>
        <h4>仮想空室率の定義</h4>
        <ul>
          <li>各フロアの代表高度（帯の中央。8Fなら海抜75m）で水平に切った断面を、2m四方のセルごとに「建物」「地盤」「空室（自由空間）」「未整備・判定不能」に分類</li>
          <li>仮想空室率 ＝ 空室セル ÷（建物＋地盤＋空室セル）× 100。未整備・判定不能は分母から除外</li>
          <li>代表高度1枚の<b>面積割合</b>です。10mの帯全体の体積割合ではありません。実際の住宅の空室率ではありません</li>
          <li>地盤：国土地理院の標高（DEM）より低い位置。建物：PLATEAUの建物モデルをボクセル化した占有。未整備：PLATEAU整備範囲外または標高データなし</li>
        </ul>
        <h4>物件（対象範囲）</h4>
        <ul>
          {areas.map((a) => (
            <li key={a.atlas.attrs.area_id}>
              <b>{a.label}：{a.atlas.attrs.title}</b>（{a.atlas.attrs.subtitle}、建物{a.atlas.attrs.building_count}棟、格子 {a.atlas.grid.nx}×{a.atlas.grid.ny}×{a.atlas.grid.nz}・水平{a.atlas.grid.dx}m・鉛直{a.atlas.grid.dz}m）
              <div className="note">
                {a.atlas.attrs.sources.files.map((f) => `${f.city_name} ${f.year}年度 CityGML ${f.spec} メッシュ${f.mesh}`).join('／')}
              </div>
            </li>
          ))}
        </ul>
        <h4>出典</h4>
        <ul>
          <li>建物：国土交通省 Project PLATEAU 3D都市モデル（2025年度、LOD1／LOD2）</li>
          <li>地盤：国土地理院 標高タイル（DEM5A。欠損はDEM5B・DEM10Bで補完）</li>
          <li>航空写真：国土地理院 地理院タイル（全国最新写真（シームレス））</li>
        </ul>
        <h4>注意・制約</h4>
        <ul>
          <li>3Dの「モデルルーム」は2つの範囲を比較のため横に並べた展示です。実際の位置関係ではありません（高さは共通の絶対標高）</li>
          <li>建物は2mセルの中心で判定。階数の推定は「計測高さ÷地上階数」によるもので、実際のフロアとは異なる場合があります</li>
          <li>PLATEAU上の名称・属性はそのまま表示しています（例：「立川北駅」のオブジェクトは計測高さ約128mの塔状部分を含み、LOD1とLOD2の上端が大きく異なります）</li>
          <li>建築物以外（高架・橋梁・樹木など）は含みません。水面は標高データの値をそのまま地面として扱います</li>
        </ul>
        <div style={{ textAlign: 'right', marginTop: 14 }}><button className="btn" onClick={onClose}>閉じる</button></div>
      </div>
    </div>
  )
}
