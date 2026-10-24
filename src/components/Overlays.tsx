import type { HoverState } from '../App'
import { BUILDING, NODATA, type SliceAnalysis } from '../analysis/slice'
import type { Atlas } from '../data/atlas'
import { fmt, fmtArea } from '../lib/format'
import { CLEARANCE_MAX_M, CLEARANCE_RAMP, COLORS, type ViewMode } from '../viewer/sliceTexture'

export function Legend({ mode, clearanceM, marginM }: { mode: ViewMode; clearanceM: number; marginM: number }) {
  return (
    <div className="overlay-bl">
      <div className="glass legend">
        <h4>{mode === 'occupancy' ? '断面：建物占有' : mode === 'components' ? '断面：空間の連結領域（4近傍）' : '断面：建物からの離隔距離'}</h4>
        <div className="legend-row"><i className="sw" style={{ background: COLORS.building }} />建物が占有するセル</div>
        {mode === 'occupancy' && <div className="legend-row"><i className="sw" style={{ background: 'rgba(143,184,255,.25)' }} />空き空間</div>}
        {mode === 'components' && (
          <>
            <div className="legend-row"><i className="sw" style={{ background: COLORS.largest }} />最大の連結領域</div>
            <div className="legend-row">
              {COLORS.others.map((c) => <i key={c} className="sw" style={{ background: c, width: 10 }} />)}
              <span>2番目以降の領域</span>
            </div>
            <div className="legend-row"><i className="sw" style={{ background: COLORS.small }} />100m²未満の小領域</div>
          </>
        )}
        {mode === 'clearance' && (
          <>
            <div className="ramp" style={{ background: `linear-gradient(90deg, ${CLEARANCE_RAMP.join(',')})` }} />
            <div className="ramp-labels num"><span>近い</span><span>{CLEARANCE_MAX_M} m以上</span></div>
          </>
        )}
        {(mode !== 'occupancy' || clearanceM > 0 || marginM > 0) && (
          <div className="legend-row"><i className="sw" style={{ background: COLORS.blocked }} />離隔{clearanceM > 0 ? `${clearanceM} m` : ''}不足・境界帯</div>
        )}
        <div className="legend-row"><i className="sw hatch" />地中・判定対象外</div>
      </div>
    </div>
  )
}

export function HoverTip({ hover, atlas, level, bid, analysis, mode }: {
  hover: HoverState; atlas: Atlas; level: Uint8Array; bid: Uint16Array | null; analysis: SliceAnalysis; mode: ViewMode
}) {
  const i = hover.pick.index
  const v = level[i]
  const dx = atlas.grid.dx
  let title = ''
  const lines: string[] = []
  if (v === BUILDING) {
    const b = bid ? atlas.building(bid[i]) : undefined
    title = b ? (b.alias ?? b.name ?? '名称なしの建物') : '建物'
    if (b) {
      if (b.usage) lines.push(b.usage)
      const h = b.measuredHeight != null ? `計測高さ ${fmt(b.measuredHeight, 1)} m` : ''
      const f = b.storeysAbove ? `地上${b.storeysAbove}階` : ''
      if (h || f) lines.push([h, f].filter(Boolean).join(' ・ '))
      lines.push('クリックで建物を選択')
    }
  } else if (v === NODATA) {
    title = '判定対象外'
    lines.push('地表面より下（地中）のため解析から除外')
  } else {
    const id = analysis.comps.labels[i]
    if (!id) {
      title = '空き空間（解析対象外）'
      lines.push('離隔距離の不足、または境界帯に含まれます')
    } else {
      const rank = analysis.comps.bySize.indexOf(id)
      title = rank === 0 ? '最大の連結領域' : `連結領域 #${rank + 1}`
      lines.push(`面積 ${fmtArea(analysis.comps.sizes[id] * dx * dx)}`)
      if (!analysis.comps.touchesBoundary[id]) lines.push('周囲を建物に囲まれた閉じた空間')
    }
    if (analysis.d2 && mode !== 'occupancy') lines.push(`最寄りの建物まで ${fmt(Math.sqrt(analysis.d2[i]) * dx, 1)} m`)
  }
  return (
    <div className="glass hover-tip" style={{ left: hover.x, top: hover.y }}>
      <div className="t">{title}</div>
      {lines.map((l) => <div key={l} className="m">{l}</div>)}
    </div>
  )
}
