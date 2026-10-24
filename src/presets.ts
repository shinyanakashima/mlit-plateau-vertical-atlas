/** Demo pairs (grid col,row) chosen on open ground in the pipeline output (see docs/DEMO.md). */
export const PRESET_PAIRS: Record<string, { a: [number, number]; b: [number, number]; label: string }> = {
  'tokyo-station': { a: [64, 128], b: [230, 160], label: '丸の内側 ↔ 八重洲側' },
  synthetic: { a: [40, 32], b: [56, 32], label: '壁の西 ↔ 壁の東' },
}
