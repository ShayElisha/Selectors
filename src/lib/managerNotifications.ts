import type {
  IncidentRecord,
  Intensity,
  Lane,
  LaneAssignment,
  SelectorRound,
  ShiftSchedule,
  ShiftType,
  View,
} from '../types'
import { MAIN_SHIFT_BOUNDS } from './shiftCatalog'

export type ManagerNoticeKind =
  | 'shift_end'
  | 'shift_overdue'
  | 'fault'
  | 'equipment'
  | 'board_quality'
  | 'cross_module'
  | 'save_conflict'
  | 'missing_windows'
  | 'hard_lane_streak'
  | 'critical_fault'
  | 'quality_drop'
  | 'new_manager'
  | 'notice_send_failed'
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

/** Save failed after revision conflicts or a hard persist error. */
export function ensureSaveConflictNotice(opts: {
  message: string
  shiftId?: string
  now?: Date
}): ManagerNotice {
  const at = (opts.now ?? new Date()).toISOString()
  // Stable id so keystroke/save storms do not flood the bell.
  const key = opts.shiftId ? `shift:${opts.shiftId}` : 'data'
  return upsertNotice({
    id: noticeId('save_conflict', key),
    at,
    title: 'שמירה נכשלה / קונפליקט גרסה',
    body:
      String(opts.message || '').trim() ||
      'נתוני השרת השתנו בזמן השמירה. נסו לשמור שוב.',
    kind: 'save_conflict',
    read: false,
    shiftId: opts.shiftId,
    view: opts.shiftId ? 'shift' : 'home',
  })
}

/** Present workers still missing a personal-hours selection. */
export function ensureMissingWindowsNotice(opts: {
  shiftId: string
  date: string
  shiftType: ShiftType
  missingNames: string[]
  now?: Date
}): ManagerNotice | null {
  if (!opts.missingNames.length) return null
  const sample = opts.missingNames.slice(0, 3).join(' · ')
  const extra =
    opts.missingNames.length > 3
      ? ` ועוד ${opts.missingNames.length - 3}`
      : ''
  return upsertNotice({
    id: noticeId('missing_windows', opts.shiftId),
    at: (opts.now ?? new Date()).toISOString(),
    title: 'נוכחים בלי בחירת שעות אישיות',
    body: `${opts.missingNames.length} עובדים נוכחים בלי משמרת אישית: ${sample}${extra}`,
    kind: 'missing_windows',
    read: false,
    shiftId: opts.shiftId,
    date: opts.date,
    shiftType: opts.shiftType,
    view: 'shift',
  })
}

const SHIFT_TYPE_RANK: Record<string, number> = {
  morning: 1,
  afternoonA: 2,
  afternoon: 2,
  afternoonB: 3,
  night: 4,
}

function compareShiftChronology(
  a: { date: string; shiftType: string },
  b: { date: string; shiftType: string },
): number {
  const byDate = a.date.localeCompare(b.date)
  if (byDate !== 0) return byDate
  return (SHIFT_TYPE_RANK[a.shiftType] ?? 99) - (SHIFT_TYPE_RANK[b.shiftType] ?? 99)
}

function workerIdsOnHardLanes(
  assignments: LaneAssignment[] | undefined,
  rounds: SelectorRound[] | undefined,
  hardLaneIds: Set<string>,
): string[] {
  const ids = new Set<string>()
  for (const row of assignments || []) {
    if (!hardLaneIds.has(row.laneId)) continue
    for (const workerId of row.workerIds) {
      if (workerId) ids.add(workerId)
    }
  }
  for (const round of rounds || []) {
    for (const row of round.assignments || []) {
      if (!hardLaneIds.has(row.laneId)) continue
      for (const workerId of row.workerIds) {
        if (workerId) ids.add(workerId)
      }
    }
  }
  return [...ids]
}

export type HardLaneStreak = {
  workerId: string
  count: number
  lastLaneNames: string[]
}

/** Workers placed on hard lanes in the last N consecutive shifts (default 3). */
export function findHardLaneStreaks(opts: {
  history: Array<
    Pick<
      ShiftSchedule,
      'id' | 'date' | 'shiftType' | 'assignments' | 'rounds' | 'audience'
    >
  >
  lanes: Array<Pick<Lane, 'id' | 'name' | 'intensity'>>
  workerIds?: string[]
  minStreak?: number
  audience?: string
}): HardLaneStreak[] {
  const minStreak = opts.minStreak ?? 3
  const hardLaneIds = new Set(
    opts.lanes
      .filter((lane) => (lane.intensity as Intensity) === 'hard')
      .map((lane) => lane.id),
  )
  if (hardLaneIds.size === 0) return []
  const laneName = new Map(opts.lanes.map((lane) => [lane.id, lane.name]))
  const audience = opts.audience ?? 'inspector'
  const shifts = [...opts.history]
    .filter((shift) => (shift.audience ?? 'inspector') === audience)
    .sort(compareShiftChronology)
  if (shifts.length === 0) return []

  const focus =
    opts.workerIds && opts.workerIds.length > 0
      ? new Set(opts.workerIds)
      : null
  const streaks = new Map<string, { count: number; laneNames: string[] }>()

  for (const shift of shifts) {
    const onHard = new Set(
      workerIdsOnHardLanes(shift.assignments, shift.rounds, hardLaneIds),
    )
    const hardNames = [...hardLaneIds]
      .filter((id) =>
        (shift.assignments || []).some(
          (row) =>
            row.laneId === id && row.workerIds.some((workerId) => Boolean(workerId)),
        ) ||
        (shift.rounds || []).some((round) =>
          round.assignments.some(
            (row) =>
              row.laneId === id &&
              row.workerIds.some((workerId) => Boolean(workerId)),
          ),
        ),
      )
      .map((id) => laneName.get(id) || id)

    const candidates = focus
      ? [...focus]
      : [
          ...new Set([
            ...onHard,
            ...[...streaks.keys()],
          ]),
        ]

    for (const workerId of candidates) {
      if (focus && !focus.has(workerId)) continue
      const prev = streaks.get(workerId) || { count: 0, laneNames: [] }
      if (onHard.has(workerId)) {
        const namesForWorker = [
          ...new Set(
            [
              ...(shift.assignments || []),
              ...(shift.rounds || []).flatMap((round) => round.assignments),
            ]
              .filter(
                (row) =>
                  hardLaneIds.has(row.laneId) &&
                  row.workerIds.includes(workerId),
              )
              .map((row) => laneName.get(row.laneId) || row.laneId),
          ),
        ]
        streaks.set(workerId, {
          count: prev.count + 1,
          laneNames: namesForWorker.length ? namesForWorker : hardNames,
        })
      } else {
        streaks.set(workerId, { count: 0, laneNames: [] })
      }
    }
  }

  const out: HardLaneStreak[] = []
  for (const [workerId, row] of streaks) {
    if (row.count >= minStreak) {
      out.push({
        workerId,
        count: row.count,
        lastLaneNames: row.laneNames,
      })
    }
  }
  return out.sort((a, b) => b.count - a.count || a.workerId.localeCompare(b.workerId))
}

export function ensureHardLaneStreakNotices(
  streaks: Array<HardLaneStreak & { workerName: string }>,
  opts?: { shiftId?: string; now?: Date },
): ManagerNotice[] {
  const created: ManagerNotice[] = []
  const now = opts?.now ?? new Date()
  for (const row of streaks) {
    if (!row.workerId || row.count < 3) continue
    const lanes =
      row.lastLaneNames.length > 0
        ? row.lastLaneNames.join(' · ')
        : 'נתיב קשה'
    created.push(
      upsertNotice({
        id: noticeId(
          'hard_lane_streak',
          `${opts?.shiftId || 'hist'}:${row.workerId}:${row.count}`,
        ),
        at: now.toISOString(),
        title: 'שיבוץ חוזר לנתיב קשה',
        body: `${row.workerName} שובץ/ה לנתיב קשה ${row.count} פעמים ברצף (${lanes}).`,
        kind: 'hard_lane_streak',
        read: false,
        shiftId: opts?.shiftId,
        entityId: row.workerId,
        view: 'tracking',
      }),
    )
  }
  return created
}

/** Critical fault/event that still needs attention. */
export function ensureCriticalFaultNotices(
  incidents: IncidentRecord[] | null | undefined,
  now = new Date(),
): ManagerNotice[] {
  const created: ManagerNotice[] = []
  for (const incident of incidents || []) {
    if (incident.severity !== 'critical') continue
    if (
      incident.status !== 'pending_approval' &&
      incident.status !== 'open' &&
      incident.status !== 'in_progress'
    ) {
      continue
    }
    const who =
      incident.reportedByName?.trim() ||
      incident.createdBy?.trim() ||
      'מערכת'
    const label = incident.kind === 'event' ? 'אירוע' : 'תקלה'
    created.push(
      upsertNotice({
        id: noticeId('critical_fault', incident.id),
        at: incident.createdAt || now.toISOString(),
        title: `${label} קריטית`,
        body: `${who}: ${incident.title || 'דיווח קריטי'}`,
        kind: 'critical_fault',
        read: false,
        entityId: incident.id,
        view: 'incidents',
      }),
    )
  }
  return created
}

/** Auto-assign score dropped (or cleared) after manual board edits. */
export function ensureQualityDropAfterManualNotice(opts: {
  shiftId: string
  previousScore: number
  currentScore?: number | null
  date?: string
  shiftType?: ShiftType
  now?: Date
}): ManagerNotice | null {
  const prev = Number(opts.previousScore)
  if (!Number.isFinite(prev)) return null
  const current =
    opts.currentScore == null || !Number.isFinite(Number(opts.currentScore))
      ? null
      : Number(opts.currentScore)
  if (current != null && current >= prev - 5) return null
  const body =
    current == null
      ? `ציון השיבוץ האוטומטי היה ${Math.round(prev)} ונמחק אחרי עריכה ידנית. כדאי לבדוק את הלוח לפני שמירה.`
      : `ציון השיבוץ ירד מ-${Math.round(prev)} ל-${Math.round(current)} אחרי עריכה ידנית.`
  return upsertNotice({
    id: noticeId('quality_drop', `${opts.shiftId}:${Math.round(prev)}`),
    at: (opts.now ?? new Date()).toISOString(),
    title: 'ציון שיבוץ ירד אחרי עריכה ידנית',
    body,
    kind: 'quality_drop',
    read: false,
    shiftId: opts.shiftId,
    date: opts.date,
    shiftType: opts.shiftType,
    view: 'shift',
  })
}

/** A worker was newly appointed as manager. */
export function ensureNewManagerNotice(opts: {
  workerId: string
  workerName: string
  now?: Date
}): ManagerNotice {
  const who = String(opts.workerName || '').trim() || 'עובד'
  return upsertNotice({
    id: noticeId('new_manager', `${opts.workerId}:${(opts.now ?? new Date()).toISOString().slice(0, 10)}`),
    at: (opts.now ?? new Date()).toISOString(),
    title: 'מנהל חדש מונה',
    body: `${who} קיבל/ה הרשאת מנהל במערכת.`,
    kind: 'new_manager',
    read: false,
    entityId: opts.workerId,
    view: 'workers',
  })
}

/** Broadcast to the worker portal failed. */
export function ensureWorkerNoticeSendFailedNotice(opts: {
  message: string
  title?: string
  now?: Date
}): ManagerNotice {
  const detail = String(opts.message || '').trim() || 'שליחת ההודעה נכשלה'
  const headline = String(opts.title || '').trim()
  return upsertNotice({
    id: noticeId(
      'notice_send_failed',
      `${(opts.now ?? new Date()).toISOString()}:${detail.slice(0, 40)}`,
    ),
    at: (opts.now ?? new Date()).toISOString(),
    title: 'הודעת מערכת לעובדים לא נשלחה',
    body: headline ? `«${headline}» — ${detail}` : detail,
    kind: 'notice_send_failed',
    read: false,
    view: 'settings',
  })
}
