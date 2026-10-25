import type { AreaIndexEntry, Lod } from '../data/types'

interface Props {
  areas: AreaIndexEntry[]
  areaId: string | null
  onArea: (id: string) => void
  lod: Lod
  onLod: (l: Lod) => void
  synthetic: boolean
  onHome: () => void
  onTop: () => void
  onHelp: () => void
  onAbout: () => void
  demoActive: boolean
  onDemo: () => void
}

export default function Header(p: Props) {
  return (
    <header className="header">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="7" fill="#141c2c" />
          <rect x="7" y="9" width="5" height="17" rx="1" fill="#eb6834" />
          <rect x="14" y="5" width="5" height="21" rx="1" fill="#eb6834" />
          <rect x="21" y="13" width="5" height="13" rx="1" fill="#eb6834" />
          <rect x="3.5" y="15" width="25" height="2.6" rx="1.3" fill="#5ab0ff" />
        </svg>
        <div>
          <div className="brand-title">PLATEAU Vertical Atlas</div>
          <div className="brand-sub">都市の垂直地図帳 ― 3D都市モデルを標高ごとに輪切りにする</div>
        </div>
      </div>
      <div className="header-spacer" />
      <div className="header-group">
        <span className="header-label">対象エリア</span>
        <select className="select" value={p.areaId ?? ''} onChange={(e) => p.onArea(e.target.value)} aria-label="対象エリア">
          {p.areas.map((a) => (
            <option key={a.id} value={a.id}>{a.title}・{a.subtitle}</option>
          ))}
        </select>
        {p.synthetic ? <span className="badge warn">合成データ</span> : <span className="badge real">PLATEAU実データ</span>}
      </div>
      <div className="header-group">
        <span className="header-label">建物形状</span>
        <div className="seg" role="radiogroup" aria-label="LOD">
          <button className={p.lod === 'lod1' ? 'on' : ''} onClick={() => p.onLod('lod1')} title="LOD1: 建物を高さ一定の箱（押出し形状）として扱う">LOD1<span className="lod-desc"> 箱型</span></button>
          <button className={p.lod === 'lod2' ? 'on' : ''} onClick={() => p.onLod('lod2')} title="LOD2: 屋根形状・セットバックを反映">LOD2<span className="lod-desc"> 屋根形状</span></button>
        </div>
      </div>
      <div className="header-group">
        <button className={`btn demo-btn ${p.demoActive ? 'active' : ''}`} onClick={p.onDemo} title="LT用のガイド付きデモ（→で次へ）">{p.demoActive ? 'デモ終了' : '▶ LTデモ'}</button>
        <button className="btn" onClick={p.onHome} title="初期視点に戻る（H）">初期視点</button>
        <button className="btn" onClick={p.onTop} title="真上から見る（T）">真上</button>
        <button className="btn" onClick={p.onAbout}>出典・制約</button>
        <button className="btn icon" onClick={p.onHelp} title="使い方（?）" aria-label="使い方">?</button>
      </div>
    </header>
  )
}
