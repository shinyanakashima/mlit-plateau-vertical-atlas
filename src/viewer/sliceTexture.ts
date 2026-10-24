import { BUILDING, NODATA, type SliceAnalysis } from '../analysis/slice'

export type ViewMode = 'occupancy' | 'components' | 'clearance'

type RGBA = [number, number, number, number]

const hex = (h: string, a = 255): RGBA => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a,
]

// Colour roles (dark categorical palette, validated adjacent-pair order; see docs/TECHNICAL.md)
export const COLORS = {
  building: '#eb6834',
  free: '#8fb8ff',
  largest: '#3987e5',
  others: ['#199e70', '#c98500', '#d55181', '#9085e9', '#e66767'],
  small: '#8b93a7',
  blocked: '#1b2333',
  nodata: '#6b6f78',
  selected: '#ffd166',
}

/** Sequential ramp for clearance distance: dark (near buildings) → light (open sky). */
export const CLEARANCE_RAMP = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb']
export const CLEARANCE_MAX_M = 36

function rampColor(t: number): RGBA {
  const x = Math.min(Math.max(t, 0), 1) * (CLEARANCE_RAMP.length - 1)
  const i = Math.min(Math.floor(x), CLEARANCE_RAMP.length - 2)
  const f = x - i
  const a = hex(CLEARANCE_RAMP[i])
  const b = hex(CLEARANCE_RAMP[i + 1])
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, 215]
}

export interface TextureOptions {
  mode: ViewMode
  dx: number
  nx: number
  ny: number
  /** building ids of this level (for highlighting the selected building) */
  bid?: Uint16Array | null
  selectedBuilding?: number | null
  /** component id to emphasise (e.g. the one containing point A) */
  focusComponent?: number | null
  /** draw the excluded boundary band */
  marginCells: number
}

const SCALE = 2 // 2x upscale so NODATA hatching and cell edges stay crisp

/**
 * Render a slice to a new canvas.  Cesium re-uploads a Material image uniform only when the
 * object reference changes, so every render returns a fresh (small, 512²) canvas.
 */
export function renderSlice(level: Uint8Array, an: SliceAnalysis, o: TextureOptions): HTMLCanvasElement {
  const { nx, ny } = o
  const canvas = document.createElement('canvas')
  canvas.width = nx * SCALE
  canvas.height = ny * SCALE
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(nx * SCALE, ny * SCALE)
  const px = img.data
  const cBuilding = hex(COLORS.building, 235)
  const cSelected = hex(COLORS.selected, 255)
  const cFree = hex(COLORS.free, 34)
  const cLargest = hex(COLORS.largest, 190)
  const cOthers = COLORS.others.map((c) => hex(c, 215))
  const cSmall = hex(COLORS.small, 170)
  const cBlocked = hex(COLORS.blocked, 150)
  const cNodata = hex(COLORS.nodata, 120)
  const cNodata2 = hex(COLORS.nodata, 50)
  const comps = an.comps
  const rank = new Int32Array(comps.count + 1).fill(-1)
  comps.bySize.forEach((id, r) => { rank[id] = r })
  const smallCells = 100 / (o.dx * o.dx)
  const thrMax = (CLEARANCE_MAX_M / o.dx) ** 2
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x
      const v = level[i]
      let c: RGBA
      if (v === BUILDING) {
        c = o.selectedBuilding && o.bid && o.bid[i] === o.selectedBuilding ? cSelected : cBuilding
      } else if (v === NODATA) {
        c = cNodata
      } else if (o.mode === 'occupancy') {
        c = cFree
      } else if (o.mode === 'components') {
        const id = comps.labels[i]
        if (!id) c = cBlocked
        else {
          const r = rank[id]
          if (r === 0) c = cLargest
          else if (comps.sizes[id] < smallCells) c = cSmall
          else c = r - 1 < cOthers.length ? cOthers[r - 1] : cSmall
          if (o.focusComponent && id !== o.focusComponent) c = [c[0], c[1], c[2], c[3] * 0.45]
        }
      } else {
        // clearance
        const d2 = an.d2 ? an.d2[i] : 1e9
        c = an.mask[i] ? rampColor(Math.sqrt(Math.min(d2, thrMax)) / Math.sqrt(thrMax)) : cBlocked
      }
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          const X = x * SCALE + sx
          const Y = y * SCALE + sy
          let cc = c
          if (v === NODATA && ((X + Y) & 3) !== 0) cc = cNodata2
          const p = (Y * nx * SCALE + X) * 4
          px[p] = cc[0]
          px[p + 1] = cc[1]
          px[p + 2] = cc[2]
          px[p + 3] = cc[3]
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  if (o.marginCells > 0) {
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)'
    ctx.setLineDash([6, 4])
    ctx.lineWidth = 2
    const m = o.marginCells * SCALE
    ctx.strokeRect(m, m, nx * SCALE - 2 * m, ny * SCALE - 2 * m)
    ctx.setLineDash([])
  }
  return canvas
}
