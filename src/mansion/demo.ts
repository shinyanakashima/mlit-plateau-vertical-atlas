// 1–2 minute walkthrough of the mansion prototype, matching the LT11 slides.
import type { Lod } from '../data/types'

export interface MansionStep {
  title: string
  body: string
  floor?: number
  ride?: boolean
  lod?: Lod
  home?: boolean
}

export const MANSION_STEPS: MansionStep[] = [
  {
    title: '東京は何階建て？',
    body: '東京都をひとつの巨大マンションに見立てます。海抜10mごとに1フロア。1Fは海抜0〜10m、9Fは80〜90m。',
    floor: 1, home: true, lod: 'lod2',
  },
  {
    title: '1F：どちらも同じ「海抜0〜10m」',
    body: '港区・芝浦の1Fは地上そのもの。同じ1Fでも、立川では地面のはるか下（地盤）です。',
    floor: 1,
  },
  {
    title: '8F：港区の高層階と、多摩の地面',
    body: '海抜70〜80mの8F。芝浦ではタワーマンションの20階前後、立川ではまだ地面の中。同じフロアなのに、片方は眺望、片方は地中です。',
    floor: 8,
  },
  {
    title: '9F：立川の「玄関」',
    body: '立川駅前の地面（海抜80m台）は9Fにあります。港区の住人にとっての9Fはタワーの上層階、多摩の住人にとっては玄関の階です。',
    floor: 9,
  },
  {
    title: '仮想空室率',
    body: '代表高度の水平断面で、建物にも地面にも占められていないセルの割合を「空室率」と呼びます。実際の住宅の空室率ではありません。未整備・判定不能のセルは分母から除きます。',
    floor: 9,
  },
  {
    title: 'エレベーターで最上階へ',
    body: 'フロアを上がるほど空室が増えます。左の案内板が、各フロアの建物・地盤・空室の割合です。',
    floor: 2, ride: true,
  },
  {
    title: 'しくみ',
    body: 'PLATEAUの建物（LOD2）と国土地理院の標高データを、2m×2m×2mのボクセルに変換し、Zarrで1高度＝1チャンクとして配信。ブラウザで必要な階だけを読みます。',
    floor: 9, ride: false,
  },
  {
    title: 'つぎの物件案内',
    body: '都市の地層図、天空ダンジョン、空の抜け道――同じ垂直の地図帳から、次の作品を育てていきます。',
    home: true,
  },
]
