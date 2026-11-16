import type { ShiftType } from '../types'
import { MAIN_SHIFT_BOUNDS } from './shiftCatalog'

export type ManagerNotice = {
  id: string
  at: string
  title: string
  body: string
  kind: 'shift_end' | 'info'
  read: boolean
  shiftId?: string
  date?: string
  shiftType?: ShiftType
}

const STORAGE_KEY = 'getin.manager.notices.v1'
let memoryStore: ManagerNotice[] = []

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function readAll(): ManagerNotice[] {
  try {
    const store = storage()
    if (!store) return memoryStore
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ManagerNotice[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return memoryStore
  }
}

function writeAll(items: ManagerNotice[]) {
  const next = items.slice(0, 80)
  memoryStore = next
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / private mode */
  }
}

export function listManagerNotices(): ManagerNotice[] {
  return readAll().sort((a, b) => b.at.localeCompare(a.at))
}

export function unreadManagerNoticeCount(): number {
  return readAll().filter((n) => !n.read).length
}

export function markManagerNoticeRead(id: string) {
  writeAll(
    readAll().map((n) => (n.id === id ? { ...n, read: true } : n)),
  )
}

export function markAllManagerNoticesRead() {
  writeAll(readAll().map((n) => ({ ...n, read: true })))
}

/** Test helper / logout cleanup. */
export function clearManagerNotices() {
  writeAll([])
}

function noticeId(shiftId: string, kind: string) {
  return `${kind}:${shiftId}`
}

/** Minutes from local midnight. */
export function nowMinutesLocal(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * Only after the shift window has ended (and the board is still open), ensure a
 * gate-manager bell notice exists. No early / “X minutes left” alerts.
 */
export function ensureShiftEndNotice(opts: {
  shiftId: string
  date: string
  shiftType: ShiftType
  signedOff: boolean
  /** @deprecated Ignored — notices fire only once the shift has ended. */
  withinMinutes?: number
  now?: Date
}): ManagerNotice | null {
  if (opts.signedOff) return null
  const bounds = MAIN_SHIFT_BOUNDS[opts.shiftType]
  if (!bounds) return null
  const now = opts.now ?? new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (opts.date !== today) return null

  // Night windows can cross midnight (end > 24h).
  let remaining = bounds.end - nowMinutesLocal(now)
  if (bounds.end > 24 * 60 && nowMinutesLocal(now) < bounds.start) {
    remaining = bounds.end - (nowMinutesLocal(now) + 24 * 60)
  }
  // Strict: only at/after official shift end.
  if (remaining > 0) return null

  const id = noticeId(opts.shiftId, 'shift_end')
  const existing = readAll()
  if (existing.some((n) => n.id === id)) {
    return existing.find((n) => n.id === id) ?? null
  }

  const notice: ManagerNotice = {
    id,
    at: now.toISOString(),
    title: 'המשמרת הסתיימה — נדרשת סגירה',
    body: 'הגיע הזמן לסגור את המשמרת במסך השיבוץ, כדי לנעול את הלוח ולשמור היסטוריה.',
    kind: 'shift_end',
    read: false,
    shiftId: opts.shiftId,
    date: opts.date,
    shiftType: opts.shiftType,
  }
  writeAll([notice, ...existing])
  return notice
}
