import {
  findScopedWorkers,
  loadWorkerPortalBundle,
  upsertShift,
} from './data.js'
import {
  getOrganization,
  listOrgPortalContacts,
  normalizePhone,
  refreshOrgSession,
} from './orgs.js'
import { requireUser } from './session.js'
import { appendAuditLog } from './audit.js'

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

const IL_TZ = 'Asia/Jerusalem'

function israelParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: IL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  )
  const hour = Number(parts.hour === '24' ? '0' : parts.hour)
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  }
}

function toDateISO(d = new Date()) {
  return israelParts(d).date
}

function localMinutes(d = new Date()) {
  return israelParts(d).minutes
}

function currentSlotFromModels(models, now = new Date()) {
  const list = Array.isArray(models)
    ? [...models].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : []
  if (list.length === 0) return null
  const minutes = localMinutes(now)
  for (const model of list) {
    const start = Number(model.startMinutes)
    const endRaw = Number(model.endMinutes)
    if (!Number.isFinite(start) || !Number.isFinite(endRaw)) continue
    const end = endRaw <= start ? endRaw + 24 * 60 : endRaw
    let clock = minutes
    if (end > 24 * 60 && clock < start && clock < 12 * 60) clock += 24 * 60
    if (clock >= start && clock < end) {
      return {
        date:
          endRaw <= start && minutes < 12 * 60
            ? toDateISO(new Date(now.getTime() - 86400000))
            : toDateISO(now),
        shiftType: String(model.id),
        windowLabel: String(model.name || model.id),
      }
    }
  }
  return null
}

function fallbackSlot(module, now = new Date()) {
  const minutes = localMinutes(now)
  if (module === 'inspectors') {
    if (minutes >= 6 * 60 && minutes < 14 * 60 + 30) {
      return { date: toDateISO(now), shiftType: 'morning', windowLabel: 'בוקר' }
    }
    if (minutes >= 14 * 60 + 30 && minutes < 21 * 60 + 30) {
      return { date: toDateISO(now), shiftType: 'afternoon', windowLabel: 'צהריים' }
    }
  } else {
    if (minutes >= 6 * 60 && minutes < 14 * 60 + 30) {
      return { date: toDateISO(now), shiftType: 'morning', windowLabel: 'בוקר' }
    }
    if (minutes >= 14 * 60 + 30 && minutes < 18 * 60) {
      return { date: toDateISO(now), shiftType: 'afternoonA', windowLabel: 'צהריים א' }
    }
    if (minutes >= 18 * 60 && minutes < 21 * 60) {
      return { date: toDateISO(now), shiftType: 'afternoonB', windowLabel: 'צהריים ב' }
    }
  }
  if (minutes >= 21 * 60) {
    return { date: toDateISO(now), shiftType: 'night', windowLabel: 'לילה' }
  }
  return {
    date: toDateISO(new Date(now.getTime() - 86400000)),
    shiftType: 'night',
    windowLabel: 'לילה',
  }
}

function publicWorker(worker) {
  if (!worker) return null
  return {
    id: String(worker.id),
    fullName: worker.fullName || '',
    phone: worker.phone || '',
    email: worker.email || '',
    certifications: Array.isArray(worker.certifications) ? worker.certifications : [],
    staffKind:
      worker.staffKind === 'inspector'
        ? 'inspector'
        : worker.staffKind === 'security'
          ? 'security'
          : 'selector',
    status: worker.status || 'active',
  }
}

function workerAssignedOnShift(shift, workerId) {
  if (!shift || !workerId) return false
  if (String(shift.gateManagerWorkerId || '') === workerId) return true
  for (const row of shift.assignments || []) {
    if ((row.workerIds || []).includes(workerId)) return true
  }
  for (const round of shift.rounds || []) {
    for (const row of round.assignments || []) {
      if ((row.workerIds || []).includes(workerId)) return true
    }
  }
  for (const segment of shift.seatSegments || []) {
    if (segment.workerId === workerId) return true
  }
  return false
}

function workerTouchedShift(shift, workerId) {
  if (!shift || !workerId) return false
  if ((shift.presentWorkerIds || []).includes(workerId)) return true
  if ((shift.shiftDrops || []).some((d) => d.workerId === workerId)) return true
  return workerAssignedOnShift(shift, workerId)
}

function newestFirst(a, b) {
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
}

function findMyShift(history, workerId, date, shiftType) {
  const list = history || []
  const slotMatches = list
    .filter(
      (s) =>
        s.date === date &&
        String(s.shiftType) === String(shiftType) &&
        workerTouchedShift(s, workerId),
    )
    .sort(newestFirst)
  if (slotMatches[0]) return slotMatches[0]
  const dayMatches = list
    .filter((s) => s.date === date && workerTouchedShift(s, workerId))
    .sort(newestFirst)
  return dayMatches[0] || null
}

function daysAgoISO(days, now = new Date()) {
  const d = new Date(now.getTime() - days * 86400000)
  return toDateISO(d)
}

function daysAheadISO(days, now = new Date()) {
  const d = new Date(now.getTime() + days * 86400000)
  return toDateISO(d)
}

const DEFAULT_SHIFT_BOUNDS = {
  morning: { start: 6 * 60, end: 15 * 60 },
  afternoonA: { start: 14 * 60 + 30, end: 18 * 60 + 30 },
  afternoonB: { start: 18 * 60, end: 21 * 60 + 30 },
  afternoon: { start: 14 * 60 + 30, end: 21 * 60 + 30 },
  night: { start: 21 * 60, end: 24 * 60 + 6 * 60 + 30 },
}

function shiftBounds(shiftType, models) {
  const model = (models || []).find((m) => String(m.id) === String(shiftType))
  if (
    model &&
    Number.isFinite(Number(model.startMinutes)) &&
    Number.isFinite(Number(model.endMinutes))
  ) {
    return {
      start: Number(model.startMinutes),
      end: Number(model.endMinutes),
    }
  }
  return (
    DEFAULT_SHIFT_BOUNDS[shiftType] || {
      start: 0,
      end: 24 * 60,
    }
  )
}

/** Absolute minutes from a fixed epoch day for sorting/comparisons. */
function absoluteMinutes(dateISO, minutesFromMidnight) {
  const [y, mo, d] = String(dateISO)
    .split('-')
    .map((part) => Number(part))
  const utcDay = Date.UTC(y, mo - 1, d) / 60000
  return utcDay + Number(minutesFromMidnight)
}

function shiftStartAbs(shift, models) {
  const { start } = shiftBounds(shift.shiftType, models)
  return absoluteMinutes(shift.date, start)
}

function shiftEndAbs(shift, models) {
  const { start, end } = shiftBounds(shift.shiftType, models)
  const endAdj = end <= start ? end + 24 * 60 : end
  return absoluteMinutes(shift.date, endAdj)
}

function nowAbs(now = new Date()) {
  const { date, minutes } = israelParts(now)
  return absoluteMinutes(date, minutes)
}

/** Present + past only — future shifts that have not started yet are hidden. */
function shiftHasStarted(shift, models, now = new Date()) {
  if (!shift?.date) return false
  return nowAbs(now) >= shiftStartAbs(shift, models)
}

function shiftHasEnded(shift, models, now = new Date()) {
  if (!shift?.date) return true
  return nowAbs(now) >= shiftEndAbs(shift, models)
}

function minutesUntilAbs(targetAbs, now = new Date()) {
  return Math.max(0, Math.round(targetAbs - nowAbs(now)))
}

function isoAfterMinutes(now, minutes) {
  return new Date(now.getTime() + Math.max(0, minutes) * 60_000).toISOString()
}

/**
 * Active shift if currently running; otherwise the next upcoming assignment.
 */
function findRelevantShift(history, workerId, models, now = new Date()) {
  const list = (history || [])
    .filter((s) => workerTouchedShift(s, workerId))
    .filter((s) => !shiftHasEnded(s, models, now))
    .sort((a, b) => shiftStartAbs(a, models) - shiftStartAbs(b, models))

  const active = list.find((s) => shiftHasStarted(s, models, now))
  if (active) return { shift: active, phase: 'active' }

  const upcoming = list[0] || null
  if (upcoming) return { shift: upcoming, phase: 'upcoming' }

  return { shift: null, phase: 'none' }
}

function buildNowContext(shift, placement, models, slot, phase, now = new Date()) {
  const clock = localMinutes(now)
  const date = shift?.date || slot?.date || toDateISO(now)
  const shiftType = shift?.shiftType || slot?.shiftType
  const bounds = shiftBounds(shiftType, models)
  const resolvedPhase =
    phase ||
    (shift
      ? shiftHasStarted(shift, models, now)
        ? 'active'
        : 'upcoming'
      : 'none')

  let minutesToShiftStart = null
  let minutesToShiftEnd = null
  if (shift) {
    minutesToShiftStart =
      resolvedPhase === 'upcoming'
        ? minutesUntilAbs(shiftStartAbs(shift, models), now)
        : 0
    minutesToShiftEnd = minutesUntilAbs(shiftEndAbs(shift, models), now)
  }

  let currentRound = null
  if (resolvedPhase === 'active' && placement?.rounds?.length) {
    const nowA = nowAbs(now)
    for (const round of placement.rounds) {
      const startA = absoluteMinutes(date, Number(round.startMinutes))
      let endMinutes = Number(round.endMinutes)
      if (endMinutes <= Number(round.startMinutes)) endMinutes += 24 * 60
      const endA = absoluteMinutes(date, endMinutes)
      if (nowA >= startA && nowA < endA) {
        const minutesRemaining = Math.max(0, Math.round(endA - nowA))
        currentRound = {
          label: round.label,
          startMinutes: round.startMinutes,
          endMinutes: round.endMinutes,
          cohort: round.cohort || null,
          lanes: (round.assignments || []).map((a) => ({
            laneId: a.laneId,
            laneName: a.laneName,
            intensity: a.intensity,
            notes: a.notes || '',
          })),
          minutesRemaining,
          endsAt: isoAfterMinutes(now, minutesRemaining),
        }
        break
      }
    }
  }

  // Lane assignment is hidden until the shift actually starts.
  const activeLanes =
    resolvedPhase === 'active'
      ? currentRound
        ? currentRound.lanes
        : (placement?.lanes || []).map((a) => ({
            laneId: a.laneId,
            laneName: a.laneName,
            intensity: a.intensity,
            notes: a.notes || '',
          }))
      : []

  return {
    phase: resolvedPhase,
    serverNow: now.toISOString(),
    clockMinutes: clock,
    currentRound: resolvedPhase === 'active' ? currentRound : null,
    activeLanes,
    minutesToRoundEnd: currentRound ? currentRound.minutesRemaining : null,
    roundEndsAt: currentRound?.endsAt || null,
    minutesToShiftStart,
    shiftStartsAt:
      minutesToShiftStart != null && resolvedPhase === 'upcoming'
        ? isoAfterMinutes(now, minutesToShiftStart)
        : null,
    minutesToShiftEnd,
    shiftEndsAt:
      minutesToShiftEnd != null ? isoAfterMinutes(now, minutesToShiftEnd) : null,
    shiftStartMinutes: bounds.start,
    shiftEndMinutes: bounds.end,
  }
}

function buildLaneAnalytics(shifts) {
  const byLane = new Map()
  const byIntensity = { easy: 0, medium: 0, hard: 0 }
  const laneHistory = []

  for (const shift of shifts) {
    const rows = []
    if (shift.placement?.rounds) {
      for (const round of shift.placement.rounds) {
        for (const a of round.assignments || []) rows.push(a)
      }
    } else {
      for (const a of shift.placement?.lanes || []) rows.push(a)
    }
    const seen = new Set()
    for (const a of rows) {
      const key = a.laneId || a.laneName
      if (!key || seen.has(key)) continue
      seen.add(key)
      const intensity =
        a.intensity === 'easy' || a.intensity === 'hard' ? a.intensity : 'medium'
      byIntensity[intensity] += 1
      const prev = byLane.get(key) || {
        laneId: a.laneId,
        laneName: a.laneName,
        count: 0,
        byIntensity: { easy: 0, medium: 0, hard: 0 },
      }
      prev.count += 1
      prev.byIntensity[intensity] += 1
      byLane.set(key, prev)
      laneHistory.push({
        date: shift.date,
        shiftType: shift.shiftType,
        laneId: a.laneId,
        laneName: a.laneName,
        intensity,
      })
    }
  }

  return {
    laneStats: [...byLane.values()].sort(
      (a, b) => b.count - a.count || a.laneName.localeCompare(b.laneName, 'he'),
    ),
    intensityStats: byIntensity,
    laneHistory: laneHistory.sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.laneName.localeCompare(b.laneName, 'he'),
    ),
  }
}

function summarizePlacement(shift, workerId, lanes) {
  const placement = myPlacement(shift, workerId, lanes)
  const laneNames = []
  if (placement.rounds) {
    for (const round of placement.rounds) {
      for (const row of round.assignments) {
        if (!laneNames.includes(row.laneName)) laneNames.push(row.laneName)
      }
    }
  } else {
    for (const row of placement.lanes) {
      if (!laneNames.includes(row.laneName)) laneNames.push(row.laneName)
    }
  }
  return { placement, laneNames }
}

function myPlacement(shift, workerId, lanes) {
  if (!shift) return { lanes: [], rounds: null }
  const laneById = new Map((lanes || []).map((l) => [l.id, l]))
  const describe = (assignment) => {
    const lane = laneById.get(assignment.laneId)
    return {
      laneId: assignment.laneId,
      laneName: lane?.name || assignment.laneId,
      intensity: lane?.intensity || 'medium',
      notes: assignment.notes || '',
      workerIds: assignment.workerIds || [],
      mine: (assignment.workerIds || []).includes(workerId),
    }
  }
  if (Array.isArray(shift.rounds) && shift.rounds.length > 0) {
    return {
      lanes: [],
      rounds: shift.rounds.map((round) => ({
        label: round.label,
        startMinutes: round.startMinutes,
        endMinutes: round.endMinutes,
        cohort: round.cohort,
        assignments: (round.assignments || []).map(describe).filter((row) => row.mine),
      })),
    }
  }
  return {
    lanes: (shift.assignments || []).map(describe).filter((row) => row.mine),
    rounds: null,
  }
}

export async function requireWorkerActor(req) {
  const tokenUser = requireUser(req)
  if (tokenUser.role !== 'worker' || !tokenUser.orgId) {
    throw httpError('אין הרשאה לפורטל עובדים', 403)
  }
  const actor = await refreshOrgSession(tokenUser)
  if (actor.role !== 'worker') throw httpError('אין הרשאה לפורטל עובדים', 403)
  const org = await getOrganization(actor.orgId)
  if (!org || org.status !== 'approved') throw httpError('הארגון אינו מאושר', 403)
  const module =
    actor.module ||
    (actor.modules?.inspectors
      ? 'inspectors'
      : actor.modules?.security
        ? 'security'
        : actor.modules?.selectors
          ? 'selectors'
          : null)
  if (!module || !actor.modules?.[module]) {
    throw httpError('המודול אינו פתוח', 403)
  }
  return { actor, org, scope: { orgId: String(org._id), module } }
}

export async function getWorkerHome(req) {
  const { actor, scope } = await requireWorkerActor(req)
  const now = new Date()
  const state = await loadWorkerPortalBundle(scope, {
    fromDate: daysAgoISO(1, now),
    toDate: daysAheadISO(14, now),
    workerIds: [actor.id],
  })
  const meDoc = (state.workers || []).find((w) => w.id === actor.id) || null
  const me = publicWorker(meDoc) || {
    id: actor.id,
    fullName: actor.fullName,
    phone: actor.phone,
    email: '',
    certifications: [],
    staffKind: actor.staffKind || 'selector',
    status: 'active',
  }
  const clockSlot =
    currentSlotFromModels(state.shiftModels, now) ||
    fallbackSlot(scope.module, now)
  const relevant = findRelevantShift(
    state.history,
    actor.id,
    state.shiftModels,
    now,
  )
  const shift = relevant.shift
  const phase = relevant.phase
  const bounds = shift
    ? shiftBounds(shift.shiftType, state.shiftModels)
    : null
  const slot = shift
    ? {
        date: shift.date,
        shiftType: String(shift.shiftType),
        windowLabel:
          (state.shiftModels || []).find(
            (m) => String(m.id) === String(shift.shiftType),
          )?.name ||
          clockSlot.windowLabel ||
          String(shift.shiftType),
      }
    : clockSlot
  const fullPlacement = myPlacement(shift, actor.id, state.lanes)
  // Before shift start: only countdown — do not reveal lane assignment.
  const placement =
    phase === 'upcoming' ? { lanes: [], rounds: null } : fullPlacement
  const gateId = String(shift?.gateManagerWorkerId || '').trim()
  let gateDoc =
    gateId && (phase === 'active' || phase === 'upcoming')
      ? (state.workers || []).find((w) => w.id === gateId) || null
      : null
  if (gateId && (phase === 'active' || phase === 'upcoming') && !gateDoc) {
    const extras = await findScopedWorkers(scope, [gateId])
    gateDoc = extras[0] || null
  }
  const gate = publicWorker(gateDoc)
  const drop =
    phase === 'active'
      ? (shift?.shiftDrops || []).find((d) => d.workerId === actor.id) || null
      : null
  const windowAdj =
    phase === 'active' ? shift?.windowAdjustments?.[actor.id] || null : null
  const earlyLeaveAt =
    phase === 'active' ? shift?.earlyLeaveAt?.[actor.id] : null
  const nowContext = buildNowContext(
    shift,
    fullPlacement,
    state.shiftModels,
    slot,
    phase,
    now,
  )

  return {
    me,
    module: scope.module,
    slot: {
      ...slot,
      startMinutes: bounds?.start ?? null,
      endMinutes: bounds?.end ?? null,
    },
    shift: shift
      ? {
          id: shift.id,
          date: shift.date,
          shiftType: shift.shiftType,
          audience: shift.audience,
          assignmentMode: shift.assignmentMode,
          signOff: shift.signOff || null,
          updatedAt: shift.updatedAt,
        }
      : null,
    placement,
    now: nowContext,
    gateManager: gate || null,
    status: {
      present: Boolean(shift?.presentWorkerIds?.includes(actor.id)),
      lateMinutes: windowAdj?.lateMinutes ?? null,
      earlyMinutes: windowAdj?.earlyMinutes ?? null,
      earlyLeaveAt: earlyLeaveAt ?? null,
      drop,
    },
    briefings: [...(state.briefingSections || [])]
      .map((b) => ({
        id: b.id,
        title: b.title,
        body: b.body,
        order: b.order,
        starred: Boolean(b.starred),
        updatedAt: b.updatedAt,
      }))
      .sort(
        (a, b) => Number(b.starred) - Number(a.starred) || a.order - b.order,
      ),
    questions:
      scope.module === 'inspectors'
        ? (state.questionBank || []).map((q) => ({
            id: q.id,
            prompt: q.prompt,
            answer: q.answer,
            order: q.order,
          }))
        : [],
  }
}

export async function updateWorkerStatus(req, body) {
  const { actor, scope } = await requireWorkerActor(req)
  const kind = String(body?.kind || '')
  if (kind !== 'arrive') {
    throw httpError('ניתן רק לסמן הגעה', 400)
  }
  const now = new Date()
  const state = await loadWorkerPortalBundle(scope, {
    fromDate: daysAgoISO(1, now),
    toDate: daysAheadISO(2, now),
    workerIds: [actor.id],
  })
  const relevant = findRelevantShift(
    state.history,
    actor.id,
    state.shiftModels,
    now,
  )
  const shift = relevant.shift
  if (!shift) throw httpError('לא נמצאה משמרת פתוחה עבורכם', 404)
  if (relevant.phase === 'upcoming') {
    throw httpError('המשמרת עדיין לא התחילה — אפשר לסמן הגעה מתחילת המשמרת', 409)
  }
  if (shift.signOff) {
    throw httpError('המשמרת נסגרה ואין אפשרות לעדכן סטטוס', 409)
  }
  if ((shift.presentWorkerIds || []).includes(actor.id)) {
    return getWorkerHome(req)
  }

  const next = {
    ...shift,
    presentWorkerIds: [...(shift.presentWorkerIds || []), actor.id],
    updatedAt: new Date().toISOString(),
  }

  await upsertShift(next.id, next, actor, {
    scope,
    expectedRevision: state.revision,
  })

  await appendAuditLog({
    action: 'worker_status',
    actor,
    orgId: scope.orgId,
    module: scope.module,
    details: `סימון הגעה במשמרת ${shift.date} · ${shift.shiftType}`,
  })

  return getWorkerHome(req)
}

const HISTORY_DAYS = 30

export async function getWorkerHistory(req) {
  const { actor, scope } = await requireWorkerActor(req)
  const now = new Date()
  const fromDate = daysAgoISO(HISTORY_DAYS - 1, now)
  const toDate = toDateISO(now)
  const state = await loadWorkerPortalBundle(scope, {
    fromDate,
    toDate,
    workerIds: [actor.id],
  })
  const mine = (state.history || [])
    .filter(
      (s) =>
        s.date >= fromDate &&
        s.date <= toDate &&
        workerTouchedShift(s, actor.id) &&
        shiftHasStarted(s, state.shiftModels, now),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
    )

  const shifts = mine.map((shift) => {
    const { placement, laneNames } = summarizePlacement(
      shift,
      actor.id,
      state.lanes,
    )
    const windowAdj = shift.windowAdjustments?.[actor.id] || null
    const drop =
      (shift.shiftDrops || []).find((d) => d.workerId === actor.id) || null
    return {
      id: shift.id,
      date: shift.date,
      shiftType: shift.shiftType,
      laneNames,
      placement,
      present: Boolean(shift.presentWorkerIds?.includes(actor.id)),
      lateMinutes: windowAdj?.lateMinutes ?? null,
      earlyMinutes: windowAdj?.earlyMinutes ?? null,
      earlyLeaveAt: shift.earlyLeaveAt?.[actor.id] ?? null,
      drop,
      signedOff: Boolean(shift.signOff),
      updatedAt: shift.updatedAt,
    }
  })

  const cancellations = mine
    .flatMap((shift) =>
      (shift.shiftDrops || [])
        .filter(
          (d) =>
            d.workerId === actor.id &&
            (d.kind === 'cancel' || d.kind === 'noshow' || d.kind === 'leave'),
        )
        .map((drop) => ({
          shiftId: shift.id,
          date: shift.date,
          shiftType: shift.shiftType,
          kind: drop.kind,
          minutes: drop.minutes,
          reason: drop.reason || '',
          laneIds: drop.laneIds || [],
        })),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.minutes - a.minutes)

  const analytics = buildLaneAnalytics(shifts)

  return {
    fromDate,
    toDate,
    days: HISTORY_DAYS,
    shifts,
    cancellations,
    laneStats: analytics.laneStats,
    intensityStats: analytics.intensityStats,
    laneHistory: analytics.laneHistory,
  }
}

function formatPortalPhone(phone) {
  const digits = normalizePhone(phone)
  if (digits.length === 10 && digits.startsWith('05')) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 9 && digits.startsWith('0')) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`
  }
  return digits || String(phone || '')
}

function departmentWorkerRole(module) {
  if (module === 'inspectors') return 'בודק/ת'
  if (module === 'security') return 'מאבטח/ת'
  return 'סלקטור/ית'
}

/**
 * Contacts workers may call: shift gate manager, all active department
 * coworkers (managers first), and org-configured portal contacts.
 * Deduped by phone; excludes the viewing worker.
 */
export async function getWorkerContacts(req) {
  const { actor, org, scope } = await requireWorkerActor(req)
  const now = new Date()
  const state = await loadWorkerPortalBundle(scope, {
    fromDate: daysAgoISO(1, now),
    toDate: daysAheadISO(1, now),
    includeLanes: false,
    includeQuestions: false,
  })

  const items = []
  const seen = new Set()
  const push = (entry) => {
    const phone = normalizePhone(entry.phone)
    if (phone.length < 9) return
    if (seen.has(phone)) return
    if (phone === normalizePhone(actor.phone)) return
    seen.add(phone)
    items.push({
      id: String(entry.id),
      name: String(entry.name || '').trim() || 'איש קשר',
      role: String(entry.role || '').trim(),
      phone: formatPortalPhone(phone),
      phoneDigits: phone,
      kind: entry.kind,
    })
  }

  const relevant = findRelevantShift(
    state.history,
    actor.id,
    state.shiftModels,
    now,
  )
  const phase = relevant.phase
  const shift = relevant.shift
  const gateId = String(shift?.gateManagerWorkerId || '').trim()
  if (gateId && (phase === 'active' || phase === 'upcoming')) {
    let gateDoc = (state.workers || []).find((w) => w.id === gateId) || null
    if (!gateDoc) {
      const extras = await findScopedWorkers(scope, [gateId])
      gateDoc = extras[0] || null
    }
    if (gateDoc) {
      push({
        id: `gate:${gateDoc.id}`,
        name: gateDoc.fullName,
        role: 'מנהל המשמרת',
        phone: gateDoc.phone,
        kind: 'gate_manager',
      })
    }
  }

  const coworkerRole = departmentWorkerRole(scope.module)
  const departmentWorkers = (state.workers || [])
    .filter(
      (w) =>
        w &&
        w.status !== 'inactive' &&
        w.status !== 'archived' &&
        w.id !== actor.id &&
        normalizePhone(w.phone).length >= 9,
    )
    .sort((a, b) => {
      const rank = (w) => (w.isOrgManager ? 0 : w.isManager ? 1 : 2)
      return (
        rank(a) - rank(b) ||
        String(a.fullName || '').localeCompare(String(b.fullName || ''), 'he')
      )
    })
  for (const w of departmentWorkers) {
    const isOrg = Boolean(w.isOrgManager)
    const isShiftMgr = Boolean(w.isManager)
    push({
      id: `worker:${w.id}`,
      name: w.fullName,
      role: isOrg ? 'מנהל ארגון' : isShiftMgr ? 'מנהל משמרת' : coworkerRole,
      phone: w.phone,
      kind: isOrg
        ? 'org_manager'
        : isShiftMgr
          ? 'shift_manager'
          : 'coworker',
    })
  }

  for (const c of listOrgPortalContacts(org)) {
    push({
      id: `org:${c.id}`,
      name: c.name,
      role: c.role || 'איש קשר ארגוני',
      phone: c.phone,
      kind: 'org_contact',
    })
  }

  return {
    module: scope.module,
    orgName: org.name || '',
    contacts: items,
  }
}
