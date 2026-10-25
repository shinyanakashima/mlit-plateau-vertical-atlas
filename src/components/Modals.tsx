import type { Atlas } from '../data/atlas'
import { fmt } from '../lib/format'

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="glass modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="使い方">
        <h2>東京の空は、何メートルからつながるのか？</h2>
        <p>PLATEAUの3D都市モデルを2m×2m×3mのボクセルに変換し、標高ごとに水平に輪切りにして「建物がどれだけ空を占めているか」「空き空間がどうつながっているか」を調べます。</p>
        <div className="steps">
          <div><span className="n">STEP 1</span><b>標高を動かす</b>右パネルの縦スライダー、<kbd>↑</kbd><kbd>↓</kbd>キー、または▶再生で断面が上下します。</div>
          <div><span className="n">STEP 2</span><b>見方を切り替える</b>「占有」「連結」「離隔」の3モード（<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>）。離隔距離を上げると細い隙間が閉じていきます。</div>
          <div><span className="n">STEP 3</span><b>2地点をつなぐ</b>「2地点」タブで断面上の地点A・Bを指定すると、何mから空でつながるかが分かります。</div>
        </div>
        <h4>3D操作</h4>
        <ul>
          <li>左ドラッグ：移動　右ドラッグ／ホイール：拡大縮小　中ドラッグ（Ctrl＋左ドラッグ）：回転・傾き</li>
          <li>スマホ・タブレット：1本指で移動、2本指のピンチで拡大縮小、2本指をひねると回転、2本指を上下になぞると傾き。標高は下のパネルの縦スライダーで動かします</li>
          <li><kbd>H</kbd> 初期視点　<kbd>T</kbd> 真上から　<kbd>Space</kbd> 再生／停止　<kbd>Esc</kbd> 操作をキャンセル</li>
          <li>断面の建物セルをクリックすると建物の情報と「空中のご近所さん」を表示します</li>
        </ul>
        <h4>ご注意</h4>
        <ul>
          <li>空間の連結性は幾何学的な解析結果です。ドローンの飛行安全性や法的な飛行可否を示すものではありません。</li>
          <li>階数・床の標高は計測高さと地上階数からの推定値です。</li>
        </ul>
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <button className="btn primary" onClick={onClose}>はじめる</button>
        </div>
      </div>
    </div>
  )
}

export function AboutModal({ atlas, onClose }: { atlas: Atlas | null; onClose: () => void }) {
  const a = atlas?.attrs
  const g = a?.grid
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="glass modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="出典と制約">
        <h2>データ出典・手法・制約</h2>
        {a && g && (
          <>
            <h4>データ出典</h4>
            <ul>
              <li>建築物：{a.sources.buildings}（{a.building_count}棟）</li>
              {a.sources.files.map((f) => (
                <li key={f.url} className="note">
                  {f.city_name} {f.year}年度（CityGML {f.spec}）メッシュ {f.mesh}：<a href={f.url} target="_blank" rel="noreferrer">{f.url.split('/').pop()}</a>
                </li>
              ))}
              <li>地表面の標高：{a.ground.source}</li>
              <li>航空写真：国土地理院 地理院タイル（全国最新写真（シームレス））。中心部は同梱、周辺はオンライン取得</li>
              <li>ライセンス：{a.sources.license}</li>
            </ul>
            <h4>ボクセル化の仕様</h4>
            <ul>
              <li>座標系：{a.crs.horizontal}（{a.crs.name}）、高さ：{a.crs.vertical}</li>
              <li>格子：{g.nx}×{g.ny}×{g.nz}（水平 {g.dx} m、鉛直 {g.dz} m、標高 {g.z0}〜{fmt(g.z0 + g.nz * g.dz, 0)} m）</li>
              <li>原点（北西隅）：X={fmt(g.x0, 1)} m, Y={fmt(g.y1, 1)} m。配列は occupancy[z, y, x]（y=0が北端）</li>
              <li>値：0=空き、1=建物、255=判定対象外（地表面より下）。各セルは中心点で判定</li>
              <li>LOD1：建物の底面形状を地表から上端まで押し出した箱。LOD2：屋根・底面・附属物の面を鉛直方向にレイキャストして内外を判定</li>
              <li>表示上の高さ：楕円体高 = T.P. {a.display.height_offset_m < 0 ? '−' : '+'} {fmt(Math.abs(a.display.height_offset_m), 2)} m（地形なしの地球儀に建物を接地させるための一律補正）</li>
            </ul>
          </>
        )}
        <h4>解析の定義</h4>
        <ul>
          <li>占有率 = 建物占有セル数 ÷ 判定可能セル数（255を除く）× 100、空間率 = 100 − 占有率</li>
          <li>連結性：空きセルの4近傍連結成分（斜めはつながらない）。ID順はscipy.ndimage.labelと一致し、Python実装と全高度で照合済み</li>
          <li>離隔：建物セル中心までの厳密なユークリッド距離（Felzenszwalb法）が指定値以上の空きセルだけを通行可能とする</li>
          <li>境界帯：対象範囲の外周から指定幅のセルを除外。範囲の縁を回り込むだけで連結してしまう見かけ上の連結を確認するための設定</li>
        </ul>
        <h4>既知の制約</h4>
        <ul>
          <li>対象は建築物（bldg）のみ。高架橋・鉄道施設・樹木・電線・看板などは含みません。駅のホーム屋根はPLATEAU上で建物として整備されています</li>
          <li>LOD1は箱として扱うため、セットバックやピロティは表現されません。PLATEAUのLOD1上端が計測高さより低い超高層もあります。LOD2は屋根・底面の鉛直レイキャストで推定し、開いた形状は上下端の間を埋めます</li>
          <li>2m格子の中心で判定するため、幅2m未満の部材や屋上の細い突起は欠落することがあります。地下構造は対象外です</li>
          <li>範囲外の建物は考慮しないため、境界付近の連結性は実際と異なる場合があります</li>
          <li>階・床の標高は「計測高さ÷地上階数」による推定値です</li>
          <li>空間の連結性・経路は幾何学的な実験結果で、ドローンの飛行安全性や法的な飛行可否（航空法・小型無人機等飛行禁止法など）を保証しません</li>
        </ul>
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <button className="btn" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}
