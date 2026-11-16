import type { IncidentRecord, ShiftType, View } from '../types'
import { MAIN_SHIFT_BOUNDS } from './shiftCatalog'

export type ManagerNoticeKind =
  | 'shift_end'
  | 'shift_overdue'
  | 'fault'
  | 'equipment'
  | 'board_quality'
  | 'cross_module'
  | 'info'

export type ManagerNotice = {
  id: string
  at: string
  title: string
  body: string
  kind: ManagerNoticeKind
  read: boolean
  shiftId?: string
  date?: string
  shiftType?: ShiftType
  entityId?: string
  view?: View
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

function upsertNotice(notice: ManagerNotice): ManagerNotice {
  const existing = readAll()
  const prev = existing.find((n) => n.id === notice.id)
  if (prev) return prev
  writeAll([notice, ...existing])
  return notice
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

function noticeId(kind: string, key: string) {
  return `${kind}:${key}`
}

function digits(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '')
}

/** True when the signed-in manager is מנהל שער of this shift. */
export function isActingGateManager(opts: {
  userId?: string | null
  userPhone?: string | null
  gateManagerWorkerId?: string | null
  workers?: { id: string; phone?: string }[] | null
}): boolean {
  const gateId = String(opts.gateManagerWorkerId || '').trim()
  if (!gateId) return false
  if (opts.userId && String(opts.userId) === gateId) return true
  const phone = digits(opts.userPhone)
  if (!phone) return false
  const gate = (opts.workers || []).find((w) => String(w.id) === gateId)
  return Boolean(gate && digits(gate.phone) === phone)
}

/** Minutes from local midnight. */
export function nowMinutesLocal(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes()
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Minutes past official shift end; null if still inside the window / wrong day. */
export function minutesPastShiftEnd(opts: {
  date: string
  shiftType: ShiftType
  now?: Date
}): number | null {
  const bounds = MAIN_SHIFT_BOUNDS[opts.shiftType]
  if (!bounds) return null
  const now = opts.now ?? new Date()
  const today = localDateKey(now)
  // Night windows that cross midnight: still "today's" shift after midnight.
  if (opts.date !== today) {
    if (!(bounds.end > 24 * 60 && opts.date < today)) return null
  }

  let remaining = bounds.end - nowMinutesLocal(now)
  if (bounds.end > 24 * 60 && nowMinutesLocal(now) < bounds.start) {
    remaining = bounds.end - (nowMinutesLocal(now) + 24 * 60)
  }
  if (remaining > 0) return null
  return Math.abs(remaining)
}

/**
 * Only after the shift window has ended (and the board is still open), ensure a
 * gate-manager bell notice exists. Scoped to מנהל שער of that shift.
 */
export function ensureShiftEndNotice(opts: {
  shiftId: string
  date: string
  shiftType: ShiftType
  signedOff: boolean
  viewerIsGateManager: boolean
  /** @deprecated Ignored — notices fire only once the shift has ended. */
  withinMinutes?: number
  now?: Date
}): ManagerNotice | null {
  if (opts.signedOff || !opts.viewerIsGateManager) return null
  const past = minutesPastShiftEnd({
    date: opts.date,
    shiftType: opts.shiftType,
    now: opts.now,
  })
  if (past == null) return null

  return upsertNotice({
    id: noticeId('shift_end', opts.shiftId),
    at: (opts.now ?? new Date()).toISOString(),
    title: 'המשמרת הסתיימה — נדרשת סגירה',
    body: 'אתה מנהל השער של המשמרת. הגיע הזמן לסגור את הלוח ולנעול את השיבוץ.',
    kind: 'shift_end',
    read: false,
    shiftId: opts.shiftId,
    date: opts.date,
    shiftType: opts.shiftType,
    view: 'shift',
  })
}

/**
 * Escalation: still open ~1 hour after official end — only for that shift's
 * gate manager.
 */
export function ensureShiftOverdueNotice(opts: {
  shiftId: string
  date: string
  shiftType: ShiftType
  signedOff: boolean
  viewerIsGateManager: boolean
  afterMinutes?: number
  now?: Date
}): ManagerNotice | null {
  if (opts.signedOff || !opts.viewerIsGateManager) return null
  const past = minutesPastShiftEnd({
    date: opts.date,
    shiftType: opts.shiftType,
    now: opts.now,
  })
  const after = opts.afterMinutes ?? 60
  if (past == null || past < after) return null

  return upsertNotice({
    id: noticeId('shift_overdue', opts.shiftId),
    at: (opts.now ?? new Date()).toISOString(),
    title: 'המשמרת עדיין פתוחה',
    body: `עברה כבר כשעה מסיום המשמרת והלוח עדיין לא נסגר. כמנהל שער — סגור עכשיו כדי לשמור היסטוריה.`,
    kind: 'shift_overdue',
    read: false,
    shiftId: opts.shiftId,
    date: opts.date,
    shiftType: opts.shiftType,
    view: 'shift',
  })
}

/** Pending worker fault reports awaiting manager approval. */
export function ensurePendingFaultNotices(
  incidents: IncidentRecord[] | null | undefined,
  now = new Date(),
): ManagerNotice[] {
  const created: ManagerNotice[] = []
  for (const incident of incidents || []) {
    if (incident.status !== 'pending_approval') continue
    if (incident.kind !== 'fault' && incident.kind !== 'event') continue
    const who = incident.reportedByName?.trim() || 'עובד'
    const label = incident.kind === 'event' ? 'אירוע' : 'תקלה'
    const notice = upsertNotice({
      id: noticeId('fault', incident.id),
      at: incident.createdAt || now.toISOString(),
      title: `${label} חדשה ממתינה לאישור`,
      body: `${who}: ${incident.title || 'דיווח מהפורטל'}`,
      kind: 'fault',
      read: false,
      entityId: incident.id,
      view: 'incidents',
    })
    if (!notice.read && notice.at === (incident.createdAt || now.toISOString())) {
      /* newly inserted or existing */
    }
    created.push(notice)
  }
  return created
}

export type EquipmentNoticeInput = {
  id: string
  workerName?: string
  equipmentLabel?: string
  status?: string
  createdAt?: string
}

/** Pending equipment requests waiting for a manager response. */
export function ensurePendingEquipmentNotices(
  requests: EquipmentNoticeInput[] | null | undefined,
  now = new Date(),
): ManagerNotice[] {
  const created: ManagerNotice[] = []
  for (const req of requests || []) {
    if (String(req.status || '') !== 'pending') continue
    const who = String(req.workerName || '').trim() || 'עובד'
    const item = String(req.equipmentLabel || '').trim() || 'ציוד'
    created.push(
      upsertNotice({
        id: noticeId('equipment', req.id),
        at: req.createdAt || now.toISOString(),
        title: 'בקשת ציוד ממתינה',
        body: `${who} ביקש/ה: ${item}`,
        kind: 'equipment',
        read: false,
        entityId: req.id,
        view: 'equipment',
      }),
    )
  }
  return created
}

/** Weak / bad board quality after auto-assign. */
export function ensureBoardQualityNotice(opts: {
  shiftId: string
  level: 'warn' | 'bad'
  message: string
  now?: Date
}): ManagerNotice | null {
  if (!opts.shiftId || !opts.message) return null
  const title =
    opts.level === 'bad' ? 'איכות שיבוץ חריגה' : 'איכות שיבוץ נמוכה'
  return upsertNotice({
    id: noticeId('board_quality', `${opts.shiftId}:${opts.level}`),
    at: (opts.now ?? new Date()).toISOString(),
    title,
    body: opts.message,
    kind: 'board_quality',
    read: false,
    shiftId: opts.shiftId,
    view: 'shift',
  })
}

export type CrossModuleNoticeInput = {
  workerId: string
  workerName: string
  otherModule: string
  otherShiftId?: string
  date: string
  shiftType: string
}

/** Someone on this board is already present/assigned in another module. */
export function ensureCrossModuleConflictNotices(
  conflicts: CrossModuleNoticeInput[] | null | undefined,
  opts?: { shiftId?: string; now?: Date },
): ManagerNotice[] {
  const created: ManagerNotice[] = []
  const now = opts?.now ?? new Date()
  for (const row of conflicts || []) {
    if (!row.workerId || !row.otherModule) continue
    const who = String(row.workerName || '').trim() || 'עובד'
    created.push(
      upsertNotice({
        id: noticeId(
          'cross_module',
          `${opts?.shiftId || row.date}:${row.workerId}:${row.otherModule}`,
        ),
        at: now.toISOString(),
        title: 'שיבוץ כפול בין מודולים',
        body: `${who} כבר משובץ/נוכח במודול ${row.otherModule} באותו תאריך ומשמרת.`,
        kind: 'cross_module',
        read: false,
        shiftId: opts?.shiftId,
        date: row.date,
        shiftType: row.shiftType as ShiftType,
        entityId: row.workerId,
        view: 'shift',
      }),
    )
  }
  return created
}

/** When save fails with the server cross-module message, keep a bell copy. */
export function ensureCrossModuleConflictFromMessage(
  message: string,
  opts?: { shiftId?: string; now?: Date },
): ManagerNotice | null {
  const text = String(message || '')
  if (!/בין מודולים|כבר משובץ/.test(text)) return null
  return upsertNotice({
    id: noticeId(
      'cross_module',
      `msg:${opts?.shiftId || 'shift'}:${text.slice(0, 80)}`,
    ),
    at: (opts?.now ?? new Date()).toISOString(),
    title: 'שיבוץ כפול בין מודולים',
    body: text,
    kind: 'cross_module',
    read: false,
    shiftId: opts?.shiftId,
    view: 'shift',
  })
}
