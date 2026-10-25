import { CLASS_BUILDING, CLASS_FREE, CLASS_GROUND, CLASS_NODATA } from './floors'

/** Colour roles of the four section classes (shared by the 3D planes, floor plans and legends). */
export const SECTION_COLORS: Record<number, string> = {
  [CLASS_FREE]: '#8fc3ff',
  [CLASS_BUILDING]: '#eb6834',
  [CLASS_GROUND]: '#6b4f33',
  [CLASS_NODATA]: '#5c6070',
}

const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

const SCALE = 2

/** Render classified cells; free space is drawn translucent so the 3D model below shows through. */
export function renderSection(classes: Uint8Array, nx: number, ny: number, opts: { freeAlpha: number; highlight?: Uint8Array | null }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = nx * SCALE
  canvas.height = ny * SCALE
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(canvas.width, canvas.height)
  const px = img.data
  const cols = [0, 1, 2, 3].map((c) => rgb(SECTION_COLORS[c]))
  const alpha = [opts.freeAlpha, 240, 235, 150]
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const c = classes[y * nx + x]
      const col = cols[c]
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          const X = x * SCALE + sx
          const Y = y * SCALE + sy
          const p = (Y * canvas.width + X) * 4
          let a = alpha[c]
          let k = 1
          if (c === CLASS_NODATA && ((X + Y) & 3) !== 0) a = 60
          if (c === CLASS_GROUND && ((X - Y) & 7) === 0) k = 0.78 // soil hatch
          if (opts.highlight && opts.highlight[y * nx + x] && c === CLASS_BUILDING) { px[p] = 255; px[p + 1] = 209; px[p + 2] = 102; px[p + 3] = 255; continue }
          px[p] = col[0] * k
          px[p + 1] = col[1] * k
          px[p + 2] = col[2] * k
          px[p + 3] = a
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}
