// Elevator sounds synthesised with the Web Audio API (no audio files).
//   chime: bell-like "ding" on arrival (1 strike going up, 2 going down, as many Japanese lifts do)
//   hum:   low motor hum while the cabin moves
//   click: short beep when a button is pressed
//   announce: optional "8階です" with the browser's speech synthesis (ja-JP)
// Browsers only allow audio after a user gesture, so nothing plays until the page was touched.

export type SoundMode = 'off' | 'chime' | 'voice'

const STORAGE_KEY = 'tokyo-mansion-sound'

export function loadSoundMode(): SoundMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'off' || v === 'voice' ? v : 'chime'
  } catch {
    return 'chime'
  }
}

export function saveSoundMode(m: SoundMode) {
  try { localStorage.setItem(STORAGE_KEY, m) } catch { /* private mode */ }
}

class ElevatorSound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private unlocked = false
  mode: SoundMode = loadSoundMode()

  /** Call from a user gesture (pointerdown / keydown). */
  unlock() {
    if (this.mode === 'off') return
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        this.ctx = new AC()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.5
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      this.unlocked = true
    } catch {
      this.ctx = null
    }
  }

  private ready(): AudioContext | null {
    return this.mode !== 'off' && this.unlocked && this.ctx && this.ctx.state === 'running' ? this.ctx : null
  }

  /** One bell strike: a few inharmonic partials with exponential decay. */
  private bell(ctx: AudioContext, t: number, freq: number, level: number) {
    const partials: [number, number, number][] = [[1, 1, 2.6], [2.0, 0.35, 1.3], [2.76, 0.18, 0.8], [5.4, 0.05, 0.35]]
    for (const [ratio, amp, decay] of partials) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq * ratio
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(amp * level, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
      osc.connect(g).connect(this.master!)
      osc.start(t)
      osc.stop(t + decay + 0.05)
    }
  }

  chime(direction: 1 | -1, level = 1) {
    const ctx = this.ready()
    if (!ctx) return
    const t = ctx.currentTime + 0.02
    if (direction > 0) {
      this.bell(ctx, t, 880, 0.55 * level)
    } else {
      this.bell(ctx, t, 880, 0.5 * level)
      this.bell(ctx, t + 0.42, 740, 0.5 * level)
    }
  }

  /** Motor hum for `seconds`, fading in and out. */
  hum(seconds: number) {
    const ctx = this.ready()
    if (!ctx || seconds < 0.15) return
    const t = ctx.currentTime
    const end = t + seconds
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 220
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.09, t + Math.min(0.25, seconds / 3))
    g.gain.setValueAtTime(0.09, Math.max(t + 0.26, end - 0.25))
    g.gain.exponentialRampToValueAtTime(0.0001, end)
    lp.connect(g).connect(this.master!)
    for (const [type, f] of [['sawtooth', 55], ['sine', 110]] as const) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.setValueAtTime(f, t)
      o.frequency.linearRampToValueAtTime(f * 1.04, end) // slight pitch rise while accelerating
      o.connect(lp)
      o.start(t)
      o.stop(end + 0.05)
    }
  }

  click() {
    const ctx = this.ready()
    if (!ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'square'
    o.frequency.value = 1760
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    o.connect(g).connect(this.master!)
    o.start(t)
    o.stop(t + 0.08)
  }

  announce(text: string) {
    if (this.mode !== 'voice' || !this.unlocked || !('speechSynthesis' in window)) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'ja-JP'
      u.rate = 1.05
      u.pitch = 1.1
      const ja = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith('ja'))
      if (ja) u.voice = ja
      window.speechSynthesis.speak(u)
    } catch { /* speech not available */ }
  }

  setMode(m: SoundMode) {
    this.mode = m
    saveSoundMode(m)
    if (m === 'off') {
      try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    } else {
      this.unlock()
    }
  }
}

export const elevatorSound = new ElevatorSound()
;(window as unknown as { __elevatorSound: ElevatorSound }).__elevatorSound = elevatorSound

/** Japanese floor announcement: "8階です" / "地下1階です". */
export function floorAnnouncement(floor: number): string {
  return floor >= 1 ? `${floor}階です` : `地下${-floor}階です`
}
