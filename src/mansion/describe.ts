import type { BuildingInfo } from '../data/types'
import { CLASS_BUILDING, type SectionStats } from './floors'

export interface FloorStory {
  kind: 'ground' | 'slope' | 'building' | 'sky' | 'unknown'
  headline: string
  detail: string
  /** tallest building cut by the section, with the estimated storey at that elevation */
  building?: { info: BuildingInfo; storey: number | null; floorHeight: number | null }
}

/** Storey of a building at an absolute elevation, from measured height / storeys above ground. */
export function storeyAt(b: BuildingInfo, elevation: number): { storey: number | null; floorHeight: number | null } {
  if (!b.measuredHeight || !b.storeysAbove || b.groundTP == null) return { storey: null, floorHeight: null }
  const fh = b.measuredHeight / b.storeysAbove
  if (fh < 2.5 || fh > 8) return { storey: null, floorHeight: null }
  const s = Math.floor((elevation - b.groundTP) / fh) + 1
  return { storey: s >= 1 && s <= b.storeysAbove ? s : null, floorHeight: fh }
}

export function buildingName(b: BuildingInfo): string {
  return b.alias ?? b.name ?? `名称未登録の建物（${b.usage ?? '用途不明'}）`
}

/** True when PLATEAU's LOD1 top and LOD2 top disagree by > 30 m: attributes worth double-checking. */
export function needsCheck(b: BuildingInfo): boolean {
  return b.topTP != null && b.lod2TopTP != null && Math.abs(b.lod2TopTP - b.topTP) > 30
}

export function describeFloor(stats: SectionStats, classes: Uint8Array, bid: Uint16Array | null,
  building: (id: number) => BuildingInfo | undefined, elevation: number): FloorStory {
  if (stats.vacancy == null) return { kind: 'unknown', headline: '判定できません', detail: 'この範囲にはデータがありません' }
  const g = stats.groundShare ?? 0
  const b = stats.buildingShare ?? 0
  if (g >= 90) return { kind: 'ground', headline: 'ほぼ地面の中', detail: `断面の${g.toFixed(0)}%が地盤` }
  // tallest building (with a known number of storeys) cut by the section
  let best: BuildingInfo | undefined
  if (bid) {
    const seen = new Set<number>()
    for (let i = 0; i < classes.length; i++) {
      if (classes[i] !== CLASS_BUILDING || !bid[i] || seen.has(bid[i])) continue
      seen.add(bid[i])
      const info = building(bid[i])
      // the storey estimate needs storeys above ground; buildings without it are not named here
      if (info && info.storeysAbove && (info.measuredHeight ?? 0) > (best?.measuredHeight ?? -1)) best = info
    }
  }
  if (g >= 10) {
    return { kind: 'slope', headline: '地面の高さ', detail: `断面の${g.toFixed(0)}%が地盤、${b.toFixed(0)}%が建物` }
  }
  if (b > 0 && best) {
    const s = storeyAt(best, elevation)
    return {
      kind: 'building',
      headline: s.storey ? `${buildingName(best)}の約${s.storey}階` : `${buildingName(best)}の途中`,
      detail: `建物は断面の${b.toFixed(1)}%。地上${best.storeysAbove ?? '?'}階・計測高さ${best.measuredHeight?.toFixed(0) ?? '?'}m（階は推定）`,
      building: { info: best, ...s },
    }
  }
  return { kind: 'sky', headline: 'ほぼ空室', detail: `建物も地面もない空間が${stats.vacancy.toFixed(0)}%` }
}
