import { describe, expect, it } from 'vitest'
import {
  CLASS_BUILDING, CLASS_FREE, CLASS_GROUND, CLASS_NODATA, classifySection, floorLabel, floorOf, floorRange,
  levelIndex, representativeElevation, sectionStats,
} from './floors'

describe('virtual floors', () => {
  it('maps absolute elevation to floors of 10 m', () => {
    expect(floorOf(0)).toBe(1)
    expect(floorOf(9.99)).toBe(1)
    expect(floorOf(10)).toBe(2)
    expect(floorOf(75)).toBe(8)
    expect(floorOf(145)).toBe(15)
    expect(floorOf(-0.5)).toBe(-1)
    expect(floorLabel(floorOf(-0.5))).toBe('B1F')
  })
  it('gives ranges and representative heights', () => {
    expect(floorRange(1)).toEqual([0, 10])
    expect(floorRange(8)).toEqual([70, 80])
    expect(floorRange(15)).toEqual([140, 150])
    expect(floorRange(-1)).toEqual([-10, 0])
    expect(representativeElevation(8)).toBe(75)
  })
  it('representative heights are level centres of a z0=0, dz=2 grid', () => {
    for (let f = 1; f <= 30; f++) {
      const h = representativeElevation(f)
      const k = levelIndex(h, 0, 2, 200)!
      expect(0 + (k + 0.5) * 2).toBe(h)
    }
  })
})

describe('section classification', () => {
  const occ = new Uint8Array([0, 1, 255, 0, 255, 0])
  const ground = new Float32Array([3, 3, 84, 84, NaN, 3])
  const coverage = new Uint8Array([1, 1, 1, 1, 1, 0])
  it('separates building, ground, free and no-data', () => {
    const c = classifySection({ occupancy: occ, ground, coverage, elevation: 75 })
    expect(Array.from(c)).toEqual([CLASS_FREE, CLASS_BUILDING, CLASS_GROUND, CLASS_GROUND, CLASS_NODATA, CLASS_NODATA])
  })
  it('vacancy excludes no-data from the denominator', () => {
    const s = sectionStats(classifySection({ occupancy: occ, ground, coverage, elevation: 75 }))
    expect(s.judged).toBe(4)
    expect(s.vacancy).toBe(25)
    expect(s.groundShare).toBe(50)
    expect(s.nodata).toBe(2)
  })
  it('returns null when nothing can be judged', () => {
    expect(sectionStats(new Uint8Array([3, 3])).vacancy).toBeNull()
  })
})
