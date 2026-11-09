import type { GuestWorker } from '../api'
import type { Worker } from '../types'

export function guestWorkerAsWorker(g: GuestWorker): Worker {
  return {
    id: g.id,
    fullName: g.fullName,
    phone: g.phone,
    certifications: g.certifications ?? [],
    status: 'active',
    isInspector: true,
    isManager: false,
    ...(g.staffKind ? { staffKind: g.staffKind } : {}),
  }
}

/** Local roster plus borrowed guests (by id, no duplicates). */
export function mergeShiftRoster(workers: Worker[], guests: Worker[]): Worker[] {
  const byId = new Map(workers.map((w) => [w.id, w]))
  for (const guest of guests) {
    if (!byId.has(guest.id)) byId.set(guest.id, guest)
  }
  return [...byId.values()]
}
