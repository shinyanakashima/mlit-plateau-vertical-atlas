import { Component, type ReactNode } from 'react'

/** Last line of defence for the live demo: show what failed and offer a reload instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[PLATEAU Vertical Atlas]', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="loading-veil" style={{ position: 'fixed' }}>
        <div className="glass error-card">
          <div style={{ fontWeight: 700, fontSize: 16 }}>表示中にエラーが発生しました</div>
          <pre className="note" style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error?.message ?? this.state.error)}</pre>
          <button className="btn primary" onClick={() => location.reload()}>再読み込み</button>
        </div>
      </div>
    )
  }
}
