import { normalizeHeSearch } from './trackingHeatmap'
import type { Lane, ShiftSchedule, Worker, WorkerStatus } from '../types'

/** ASSUMPTION — product has no defined “rare cert” threshold. */
export const RARE_CERT_HOLDER_THRESHOLD = 3

export type WorkerSortKey = 'name' | 'phone' | 'email' | 'role' | 'status'
export type SortDir = 'asc' | 'desc'
export type StatusTab = 'active' | 'inactive' | 'all'

export function digitsOnlyPhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

/** Israeli mobile: 05XXXXXXXX (10 digits). */
export function isValidIsraeliMobile(phone: string): boolean {
  const d = digitsOnlyPhone(phone)
  return /^05\d{8}$/.test(d)
}

/** Format as 050-867-6524; returns original trimmed if not a valid mobile. */
export function formatIsraeliMobile(phone: string): string {
  const d = digitsOnlyPhone(phone)
  if (!/^05\d{8}$/.test(d)) return phone.trim()
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export function orderedCertifications(
  catalog: string[],
  held: string[],
): string[] {
  const order = new Map(catalog.map((c, i) => [c, i]))
  const known = held
    .filter((c) => order.has(c))
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  const unknown = held
    .filter((c) => !order.has(c))
    .slice()
    .sort((a, b) => a.localeCompare(b, 'he'))
  return [...known, ...unknown]
}

export function workerMatchesQuery(worker: Worker, query: string): boolean {
  const q = normalizeHeSearch(query)
  if (!q) return true
  const name = normalizeHeSearch(worker.fullName)
  const phone = digitsOnlyPhone(worker.phone)
  const qDigits = digitsOnlyPhone(query)
  if (name.includes(q)) return true
  if (qDigits.length >= 3 && phone.includes(qDigits)) return true
  return false
}

export function filterWorkers(
  workers: Worker[],
  opts: {
    query: string
    statusTab: StatusTab
    role: 'all' | 'manager' | 'inspector'
    /** AND: must hold every selected certification */
    certs: string[]
  },
): Worker[] {
  return workers.filter((w) => {
    if (opts.statusTab === 'active' && w.status !== 'active') return false
    if (opts.statusTab === 'inactive' && w.status !== 'inactive') return false
    if (opts.role === 'manager' && !w.isManager) return false
    if (opts.role === 'inspector' && !w.isInspector) return false
    if (opts.certs.length > 0) {
      const held = new Set(w.certifications)
      if (!opts.certs.every((c) => held.has(c))) return false
    }
    return workerMatchesQuery(w, opts.query)
  })
}

export function compareWorkers(
  a: Worker,
  b: Worker,
  key: WorkerSortKey,
  dir: SortDir,
): number {
  let cmp = 0
  if (key === 'name') cmp = a.fullName.localeCompare(b.fullName, 'he')
  else if (key === 'phone') {
    cmp = digitsOnlyPhone(a.phone).localeCompare(digitsOnlyPhone(b.phone))
  } else if (key === 'email') {
    cmp = (a.email || '').localeCompare(b.email || '', 'he')
  } else if (key === 'role') {
    cmp =
      Number(b.isManager) - Number(a.isManager) ||
      Number(b.isInspector) - Number(a.isInspector)
  } else {
    cmp = a.status.localeCompare(b.status)
  }
  if (cmp === 0) cmp = a.fullName.localeCompare(b.fullName, 'he')
  return dir === 'asc' ? cmp : -cmp
}

export function findDuplicateWorkers(
  workers: Worker[],
  candidate: { fullName: string; phone: string },
  excludeId?: string,
): { samePhone: Worker[]; sameName: Worker[] } {
  const phone = digitsOnlyPhone(candidate.phone)
  const name = normalizeHeSearch(candidate.fullName)
  const samePhone: Worker[] = []
  const sameName: Worker[] = []
  for (const w of workers) {
    if (excludeId && w.id === excludeId) continue
    if (phone && digitsOnlyPhone(w.phone) === phone) samePhone.push(w)
    if (name && normalizeHeSearch(w.fullName) === name) sameName.push(w)
  }
  return { samePhone, sameName }
}

/** Lanes with no required certs — open to everyone including no-cert inspectors. */
export function openLanesCount(lanes: Lane[]): number {
  return lanes.filter((l) => l.requiredCertifications.length === 0).length
}

/** Lanes that list this certification as required. */
export function lanesOpenedByCert(lanes: Lane[], cert: string): number {
  return lanes.filter((l) => l.requiredCertifications.includes(cert)).length
}

export function certHolderCounts(
  workers: Worker[],
  catalog: string[],
): Map<string, number> {
  const map = new Map(catalog.map((c) => [c, 0]))
  for (const w of workers) {
    for (const c of w.certifications) {
      map.set(c, (map.get(c) ?? 0) + 1)
    }
  }
  return map
}

export function isRareCert(holderCount: number): boolean {
  return holderCount > 0 && holderCount < RARE_CERT_HOLDER_THRESHOLD
}

export function noCertTooltip(lanes: Lane[]): string {
  const n = openLanesCount(lanes)
  if (n === 0) return 'ללא הסמכה — לא יתאים לנתיבים עם דרישת הסמכה'
  return `משובץ בנתיבים פתוחים בלבד (${n} נתיבים ללא דרישת הסמכה)`
}

export function countByStatus(workers: Worker[]): {
  active: number
  inactive: number
} {
  let active = 0
  let inactive = 0
  for (const w of workers) {
    if (w.status === 'active') active += 1
    else inactive += 1
  }
  return { active, inactive }
}

export function statusLabel(status: WorkerStatus): string {
  return status === 'active' ? 'פעיל' : 'לא פעיל'
}

export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`
}

/** Exact name match for typed-confirm (trim + normalize spaces). */
export function typedNameMatches(typed: string, fullName: string): boolean {
  return typed.trim().replace(/\s+/g, ' ') === fullName.trim().replace(/\s+/g, ' ')
}

export function workerShiftHistoryCount(
  history: ShiftSchedule[],
  workerId: string,
): number {
  let n = 0
  for (const shift of history) {
    const inPresent = shift.presentWorkerIds.includes(workerId)
    const inAssigned = shift.assignments.some((a) =>
      a.workerIds.includes(workerId),
    )
    if (inPresent || inAssigned) n += 1
  }
  return n
}

export function formsEqual(
  a: Omit<Worker, 'id'>,
  b: Omit<Worker, 'id'>,
): boolean {
  if (a.fullName.trim() !== b.fullName.trim()) return false
  if (digitsOnlyPhone(a.phone) !== digitsOnlyPhone(b.phone)) return false
  if ((a.email || '').trim().toLowerCase() !== (b.email || '').trim().toLowerCase())
    return false
  if (a.status !== b.status) return false
  if (Boolean(a.isManager) !== Boolean(b.isManager)) return false
  if (Boolean(a.isInspector) !== Boolean(b.isInspector)) return false
  if (a.certifications.length !== b.certifications.length) return false
  const setB = new Set(b.certifications)
  return a.certifications.every((c) => setB.has(c))
}

export type WorkerFormErrors = {
  fullName?: string
  phone?: string
  email?: string
  role?: string
}

export function validateWorkerForm(
  form: Omit<Worker, 'id'>,
): WorkerFormErrors {
  const errors: WorkerFormErrors = {}
  if (!form.fullName.trim()) errors.fullName = 'נא להזין שם מלא'
  if (!form.phone.trim()) errors.phone = 'נא להזין מספר טלפון'
  else if (!isValidIsraeliMobile(form.phone)) {
    errors.phone = 'מספר נייד ישראלי לא תקין (למשל 050-123-4567)'
  }
  if (!form.isInspector && !form.isManager) {
    errors.role = 'יש לבחור לפחות תפקיד אחד: בודק או מנהל'
  }
  const email = (form.email || '').trim()
  if (form.isManager) {
    if (!email) errors.email = 'למנהל חובה להזין כתובת מייל'
    else if (!isValidEmail(email)) errors.email = 'כתובת מייל לא תקינה'
  } else if (email && !isValidEmail(email)) {
    errors.email = 'כתובת מייל לא תקינה'
  }
  return errors
}
