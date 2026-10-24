/// <reference lib="webworker" />
import { computeProfile, type ProfileRequest } from './profile'
import { usageStrata, type StrataRequest } from './strata'
import { findRoute3D, type RouteRequest } from './route3d'

type Msg =
  | { id: number; type: 'profile'; req: ProfileRequest }
  | { id: number; type: 'strata'; req: StrataRequest }
  | { id: number; type: 'route'; req: RouteRequest }

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data
  try {
    let result: unknown
    if (m.type === 'profile') result = computeProfile(m.req)
    else if (m.type === 'strata') result = usageStrata(m.req)
    else result = findRoute3D(m.req)
    ;(self as unknown as Worker).postMessage({ id: m.id, ok: true, result })
  } catch (e) {
    ;(self as unknown as Worker).postMessage({ id: m.id, ok: false, error: String(e) })
  }
}
