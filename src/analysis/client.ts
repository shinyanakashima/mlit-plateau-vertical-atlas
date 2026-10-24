import type { LevelProfile, ProfileRequest } from './profile'
import type { RouteRequest, RouteResult } from './route3d'
import type { StrataRequest, StrataRow } from './strata'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

let worker: Worker | null = null
const pending = new Map<number, Pending>()
let seq = 0

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./profile.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = pending.get(ev.data.id)
      if (!p) return
      pending.delete(ev.data.id)
      if (ev.data.ok) p.resolve(ev.data.result)
      else p.reject(new Error(ev.data.error))
    }
  }
  return worker
}

function call<T>(type: string, req: unknown): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    getWorker().postMessage({ id, type, req })
  })
}

export const runProfile = (req: ProfileRequest) => call<LevelProfile[]>('profile', req)
export const runStrata = (req: StrataRequest) => call<StrataRow[]>('strata', req)
export const runRoute = (req: RouteRequest) => call<RouteResult>('route', req)
