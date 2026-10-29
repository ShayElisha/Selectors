import { listOrganizations } from './orgs.js'
import { readState } from './data.js'
import { upsertTargetedWorkerNotice } from './workerNotices.js'

const IL_TZ = 'Asia/Jerusalem'

const DEFAULT_SHIFT_BOUNDS = {
  morning: { start: 6 * 60, end: 15 * 60 },
  afternoonA: { start: 14 * 60 + 30, end: 18 * 60 + 30 },
  afternoonB: { start: 18 * 60, end: 21 * 60 + 30 },
  afternoon: { start: 14 * 60 + 30, end: 21 * 60 + 30 },
  night: { start: 21 * 60, end: 24 * 60 + 6 * 60 + 30 },
}

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
      name: String(model.name || model.id),
    }
  }
  const fallback = DEFAULT_SHIFT_BOUNDS[shiftType] || { start: 0, end: 24 * 60 }
  return { ...fallback, name: String(shiftType) }
}

function absoluteMinutes(dateISO, minutesFromMidnight) {
  const [y, mo, d] = String(dateISO)
    .split('-')
    .map((part) => Number(part))
  const utcDay = Date.UTC(y, mo - 1, d) / 60000
  return utcDay + Number(minutesFromMidnight)
}

function nowAbs(now = new Date()) {
  const { date, minutes } = israelParts(now)
  return absoluteMinutes(date, minutes)
}

function shiftStartAbs(shift, models) {
  const { start } = shiftBounds(shift.shiftType, models)
  return absoluteMinutes(shift.date, start)
}

function minutesUntilStart(shift, models, now = new Date()) {
  return Math.round(shiftStartAbs(shift, models) - nowAbs(now))
}

/** Compact placement fingerprint for one worker (lanes + rounds + gate). */
export function workerPlacementKey(shift, workerId) {
  if (!shift || !workerId) return ''
  const parts = []
  if (String(shift.gateManagerWorkerId || '') === String(workerId)) {
    parts.push('gate')
  }
  for (const row of shift.assignments || []) {
    if ((row.workerIds || []).includes(workerId)) {
      parts.push(`lane:${row.laneId}`)
    }
  }
  for (const round of shift.rounds || []) {
    for (const row of round.assignments || []) {
      if ((row.workerIds || []).includes(workerId)) {
        parts.push(`round:${round.label || ''}:${row.laneId}`)
      }
    }
  }
  for (const segment of shift.seatSegments || []) {
    if (segment.workerId === workerId) {
      parts.push(`seat:${segment.laneId || segment.seatId || ''}`)
    }
  }
  return parts.sort().join('|')
}

function assignedWorkerIds(shift) {
  const ids = new Set()
  if (shift?.gateManagerWorkerId) ids.add(String(shift.gateManagerWorkerId))
  for (const row of shift?.assignments || []) {
    for (const id of row.workerIds || []) if (id) ids.add(String(id))
  }
  for (const round of shift?.rounds || []) {
    for (const row of round.assignments || []) {
      for (const id of row.workerIds || []) if (id) ids.add(String(id))
    }
  }
  for (const segment of shift?.seatSegments || []) {
    if (segment.workerId) ids.add(String(segment.workerId))
  }
  return [...ids]
}

function laneLabel(lanes, laneId) {
  const lane = (lanes || []).find((l) => l.id === laneId)
  return lane?.name || laneId
}

function describePlacement(shift, workerId, lanes) {
  const names = []
  for (const row of shift?.assignments || []) {
    if ((row.workerIds || []).includes(workerId)) {
      names.push(laneLabel(lanes, row.laneId))
    }
  }
  for (const round of shift?.rounds || []) {
    for (const row of round.assignments || []) {
      if ((row.workerIds || []).includes(workerId)) {
        names.push(`${round.label || 'סבב'} · ${laneLabel(lanes, row.laneId)}`)
      }
    }
  }
  if (String(shift?.gateManagerWorkerId || '') === String(workerId)) {
    names.push('מנהל שער')
  }
  return [...new Set(names)].join(', ')
}

/**
 * Notify workers whose placement changed when a shift is saved.
 */
export async function notifyWorkersOfAssignmentChanges({
  previous,
  next,
  scope,
  actor,
  lanes,
  models,
}) {
  if (!scope?.orgId || !scope?.module || !next?.id) return { sent: 0 }
  const beforeIds = new Set(assignedWorkerIds(previous))
  const afterIds = new Set(assignedWorkerIds(next))
  const touched = new Set([...beforeIds, ...afterIds])
  const windowLabel = shiftBounds(next.shiftType, models).name
  const started = minutesUntilStart(next, models) <= 0
  let sent = 0

  for (const workerId of touched) {
    const before = workerPlacementKey(previous, workerId)
    const after = workerPlacementKey(next, workerId)
    if (before === after) continue

    let title = 'שינוי בשיבוץ'
    let body = `השיבוץ למשמרת ${next.date} · ${windowLabel} עודכן.`
    if (!before && after) {
      title = 'שובצתם למשמרת'
      body = `שובצתם למשמרת ${next.date} · ${windowLabel}.`
    } else if (before && !after) {
      title = 'הוסרתם משיבוץ'
      body = `הוסרתם מהשיבוץ למשמרת ${next.date} · ${windowLabel}.`
    } else if (started && after) {
      const place = describePlacement(next, workerId, lanes)
      body = place
        ? `השיבוץ שלכם עודכן: ${place}.`
        : `השיבוץ למשמרת ${next.date} · ${windowLabel} עודכן.`
    } else {
      body = `השיבוץ למשמרת ${next.date} · ${windowLabel} עודכן. הנתיב יוצג עם תחילת המשמרת.`
    }

    const stamp = String(next.updatedAt || Date.now()).replace(/\W/g, '')
    const created = await upsertTargetedWorkerNotice(
      {
        id: `assignment:${scope.orgId}:${scope.module}:${next.id}:${workerId}:${stamp}`,
        title,
        body,
        kind: 'assignment',
        targetWorkerIds: [workerId],
        authorId: actor?.id || 'system',
        authorName: actor?.fullName || 'מערכת שיבוץ',
      },
      scope,
    )
    if (created) sent += 1
  }

  return { sent }
}

/**
 * Create ~60-minute-before-shift reminder notices (idempotent).
 */
export async function runShiftReminderPass(opts = {}) {
  const now = opts.now || new Date()
  const orgs = await listOrganizations()
  const approved = orgs.filter(
    (org) => org.status === 'approved' && !org.deletedAt,
  )
  let created = 0
  const results = []

  for (const org of approved) {
    const modules = []
    if (org.modules?.inspectors) modules.push('inspectors')
    if (org.modules?.selectors) modules.push('selectors')
    if (org.modules?.security) modules.push('security')
    for (const module of modules) {
      const scope = { orgId: org.id, module }
      try {
        const state = await readState(scope)
        const models = state.shiftModels || []
        let scopeCreated = 0
        for (const shift of state.history || []) {
          if (shift?.signOff) continue
          const minutes = minutesUntilStart(shift, models, now)
          // Window ~55–65 minutes before start (cron every 5–10 min).
          if (minutes < 55 || minutes > 65) continue
          const windowLabel = shiftBounds(shift.shiftType, models).name
          for (const workerId of assignedWorkerIds(shift)) {
            const notice = await upsertTargetedWorkerNotice(
              {
                id: `reminder:${scope.orgId}:${scope.module}:${shift.id}:${workerId}`,
                title: 'תזכורת: המשמרת בעוד כשעה',
                body: `המשמרת שלכם ב־${shift.date} · ${windowLabel} מתחילה בעוד כשעה. היכנסו ל«עכשיו» בפורטל.`,
                kind: 'reminder',
                targetWorkerIds: [workerId],
                authorName: 'תזכורת משמרת',
              },
              scope,
            )
            if (notice) {
              scopeCreated += 1
              created += 1
            }
          }
        }
        results.push({ orgId: org.id, module, created: scopeCreated })
      } catch (err) {
        results.push({
          orgId: org.id,
          module,
          error: err?.message || String(err),
        })
      }
    }
  }

  return {
    ok: true,
    at: now.toISOString(),
    created,
    results,
  }
}

/**
 * Local tick every minute while the API process stays up.
 */
export function scheduleLocalShiftReminderCron() {
  if (process.env.SHIFT_REMINDER_CRON === '0') return () => {}
  let lastKey = ''
  const tick = async () => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: IL_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date())
      const get = (type) => parts.find((p) => p.type === type)?.value || ''
      const key = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
      if (key === lastKey) return
      lastKey = key
      const summary = await runShiftReminderPass()
      if (summary.created > 0) {
        console.log(`[shift-reminder] created ${summary.created} notices`)
      }
    } catch (err) {
      console.error('[shift-reminder] cron failed', err?.message || err)
    }
  }
  const id = setInterval(tick, 60_000)
  tick()
  return () => clearInterval(id)
}
