// Guided walkthrough for the 5-minute LT.  Each step sets the app into a known state, so the
// presenter can advance with → / PageDown (presentation clickers) and never has to hunt for controls.
import type { Lod } from './data/types'
import type { SideTab } from './components/SidePanel'
import type { UpperMode } from './viewer/AtlasScene'
import type { ViewMode } from './viewer/sliceTexture'

export interface DemoContext {
  /** lowest T.P. at which the preset pair connects under the current settings (null = not computed yet) */
  pairLowest: number | null
  groundTP: number
  occupancyAt: (tp: number) => number | null
}

export interface DemoStep {
  title: string
  body: (c: DemoContext) => string
  elevation?: number | 'ground' | 'pairLowest'
  mode?: ViewMode
  clearanceM?: number
  marginM?: number
  lod?: Lod
  sideTab?: SideTab
  bottomTab?: 'profile' | 'strata'
  pair?: 'preset' | 'clear'
  select?: 'tallest' | 'none'
  playing?: boolean
  upperMode?: UpperMode
  camera?: 'home' | 'top'
}

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(0)}%`)

export const TOKYO_STEPS: DemoStep[] = [
  {
    title: '東京駅を、標高3mごとに輪切りにする',
    body: (c) => `PLATEAUの建物を2m×2m×3mのボクセル（Zarr）に変換。地表すぐ上の断面では、判定できる面積の${pct(c.occupancyAt(c.groundTP + 3))}を建物が占めています。`,
    elevation: 'ground', mode: 'occupancy', clearanceM: 0, marginM: 0, lod: 'lod2', sideTab: 'analysis',
    bottomTab: 'profile', pair: 'clear', select: 'none', playing: false, upperMode: 'ghost', camera: 'home',
  },
  {
    title: '上へ動かすと、都市は痩せていく',
    body: () => '断面を上下に動かします。ホームの屋根と駅舎を抜けると一気に空が開け、200mを超えるとタワーの頭だけが残ります。',
    playing: true,
  },
  {
    title: '空き空間を「つながり」で塗り分ける',
    body: () => '空きセルを上下左右（4近傍）でつなぎ、連結した領域ごとに色を変えます。青が最大の領域、それ以外は中庭や建物の隙間に閉じた空間です。',
    playing: false, elevation: 'ground', mode: 'components', clearanceM: 0,
  },
  {
    title: '建物から10m離れて通れる空だけを残す',
    body: () => '建物から10m以上離れたセルだけを通行可能とすると、細い路地は閉じます。丸の内側（A）と八重洲側（B）はこの高さではつながりません。',
    clearanceM: 10, pair: 'preset', sideTab: 'pair', mode: 'components',
  },
  {
    title: '東京の空は、何メートルからつながるのか？',
    body: (c) => c.pairLowest != null
      ? `離隔10mの条件で、AとBが同じ高さでつながる最も低い断面は T.P. ${c.pairLowest.toFixed(1)} m。駅舎とホームの屋根を越えた高さです。`
      : '全高度の連結を計算しています…',
    elevation: 'pairLowest',
  },
  {
    title: 'LOD1（箱）とLOD2（屋根形状）',
    body: (c) => `高さ90m付近の断面をLOD1で。LOD1は建物を一つの箱として押し出すので、低層の基壇部まで塔と同じ高さになり、中層の占有を大きく見積もります（現在 ${pct(c.occupancyAt(90))}）。`,
    elevation: 90, lod: 'lod1', mode: 'occupancy', clearanceM: 0, pair: 'clear', sideTab: 'analysis',
  },
  {
    title: 'LOD2ならセットバックが見える',
    body: (c) => `同じ90mでもLOD2では基壇が消えて塔だけが残ります（${pct(c.occupancyAt(90))}）。逆に180m付近では、LOD1の上端が計測高さより低い超高層があり、LOD1は空を広く見せます。形状の詳しさが空の解析結果を変えます。`,
    lod: 'lod2',
  },
  {
    title: '都市の地層図',
    body: () => '高度ごとの占有率を建物用途で積み上げました。地表付近は駅・商業、上空は業務ビルが占める「垂直の地層」が見えます。',
    bottomTab: 'strata', elevation: 60,
  },
  {
    title: '空中のご近所さん',
    body: () => '「40階に住んでるの？　でも、あそこの地面より低いよ」。床の標高を推定し、同じ高さのフロアやほかの街の地面と比べます。',
    select: 'tallest', sideTab: 'neighbors', bottomTab: 'profile',
  },
  {
    title: '山の高さをビルで体感',
    body: () => '獲得標高差をビルの高さに換算します。断面の高さが、高尾山ならどのあたりまで登った高さかを表示します。',
    sideTab: 'mountain', select: 'none',
  },
]

export const SYNTHETIC_STEPS: DemoStep[] = [
  {
    title: '合成データで計算を検証する',
    body: () => '答えが分かっている合成街区です。中庭（16×16セル）は高さ15mまで独立した連結領域になります。',
    elevation: 4.5, mode: 'components', clearanceM: 0, marginM: 0, lod: 'lod1', sideTab: 'analysis', pair: 'clear', camera: 'top',
  },
  {
    title: '8mの隙間と離隔距離',
    body: () => '壁の隙間は8m。離隔4mまでは通れ、5mにすると東西に分断されます。',
    clearanceM: 5, pair: 'preset', sideTab: 'pair',
  },
]
