import type { DemoContext, DemoStep } from '../demo'

export default function DemoBar({ steps, index, ctx, onPrev, onNext, onClose }: {
  steps: DemoStep[]; index: number; ctx: DemoContext; onPrev: () => void; onNext: () => void; onClose: () => void
}) {
  const s = steps[index]
  return (
    <div className="glass demo-bar" role="region" aria-label="デモ">
      <div className="demo-head">
        <span className="demo-count num">{index + 1} / {steps.length}</span>
        <div className="demo-dots">
          {steps.map((_, i) => <i key={i} className={i === index ? 'on' : i < index ? 'done' : ''} />)}
        </div>
        <button className="btn ghost small" onClick={onClose} aria-label="デモを終了">終了 Esc</button>
      </div>
      <div className="demo-title">{s.title}</div>
      <div className="demo-body">{s.body(ctx)}</div>
      <div className="demo-nav">
        <button className="btn small" onClick={onPrev} disabled={index === 0}>← 前へ</button>
        <span className="note">→ / PageDown で次へ</span>
        <button className="btn small primary" onClick={onNext} disabled={index === steps.length - 1}>次へ →</button>
      </div>
    </div>
  )
}
