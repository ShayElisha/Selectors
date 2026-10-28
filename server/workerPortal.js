import { readState, upsertShift } from './data.js'
import { getOrganization, refreshOrgSession } from './orgs.js'
import { requireUser } from './session.js'
import { appendAuditLog } from './audit.js'

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

function toDateISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localMinutes(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes()
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
    staffKind: worker.staffKind === 'inspector' ? 'inspector' : 'selector',
    status: worker.status || 'active',
  }
}

function findMyShift(history, workerId, date, shiftType) {
  const matches = (history || []).filter(
    (s) =>
      s.date === date &&
      String(s.shiftType) === String(shiftType) &&
      Array.isArray(s.presentWorkerIds) &&
      s.presentWorkerIds.includes(workerId),
  )
  if (matches.length > 0) {
    return matches.sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
    )[0]
  }
  const today = (history || []).filter(
    (s) =>
      s.date === date &&
      Array.isArray(s.presentWorkerIds) &&
      s.presentWorkerIds.includes(workerId),
  )
  return (
    today.sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
    )[0] || null
  )
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
  const state = await readState(scope)
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
  const slot =
    currentSlotFromModels(state.shiftModels) || fallbackSlot(scope.module)
  const shift = findMyShift(state.history, actor.id, slot.date, slot.shiftType)
  const placement = myPlacement(shift, actor.id, state.lanes)
  const gateId = shift?.gateManagerWorkerId
  const gate = gateId
    ? publicWorker((state.workers || []).find((w) => w.id === gateId))
    : null
  const drop = (shift?.shiftDrops || []).find((d) => d.workerId === actor.id) || null
  const windowAdj = shift?.windowAdjustments?.[actor.id] || null
  const earlyLeaveAt = shift?.earlyLeaveAt?.[actor.id]

  return {
    me,
    module: scope.module,
    slot,
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
  if (!['arrive', 'late', 'leave', 'cancel'].includes(kind)) {
    throw httpError('סוג עדכון לא תקין', 400)
  }
  const state = await readState(scope)
  const slot =
    currentSlotFromModels(state.shiftModels) || fallbackSlot(scope.module)
  const shift = findMyShift(state.history, actor.id, slot.date, slot.shiftType)
  if (!shift) throw httpError('לא נמצאה משמרת פתוחה עבורכם היום', 404)
  if (shift.signOff) {
    throw httpError('המשמרת נסגרה ואין אפשרות לעדכן סטטוס', 409)
  }

  const clock = Number.isFinite(Number(body?.minutes))
    ? Math.round(Number(body.minutes))
    : localMinutes()
  const reason = String(body?.reason || '').trim().slice(0, 240)
  const lateMinutes = Number.isFinite(Number(body?.lateMinutes))
    ? Math.max(0, Math.round(Number(body.lateMinutes)))
    : undefined

  const next = {
    ...shift,
    presentWorkerIds: [...(shift.presentWorkerIds || [])],
    windowAdjustments: { ...(shift.windowAdjustments || {}) },
    earlyLeaveAt: { ...(shift.earlyLeaveAt || {}) },
    shiftDrops: Array.isArray(shift.shiftDrops) ? [...shift.shiftDrops] : [],
    updatedAt: new Date().toISOString(),
  }

  if (kind === 'arrive' || kind === 'late') {
    if (!next.presentWorkerIds.includes(actor.id)) {
      next.presentWorkerIds.push(actor.id)
    }
    const mins = kind === 'late' ? (lateMinutes ?? 15) : lateMinutes
    if (mins && mins > 0) {
      next.windowAdjustments[actor.id] = {
        ...(next.windowAdjustments[actor.id] || {}),
        lateMinutes: mins,
      }
    }
  } else if (kind === 'leave' || kind === 'cancel') {
    next.earlyLeaveAt[actor.id] = clock
    if (kind === 'cancel') {
      next.presentWorkerIds = next.presentWorkerIds.filter((id) => id !== actor.id)
    }
    next.shiftDrops = next.shiftDrops.filter((d) => d.workerId !== actor.id)
    next.shiftDrops.push({
      workerId: actor.id,
      kind: kind === 'leave' ? 'leave' : 'cancel',
      minutes: clock,
      reason: reason || (kind === 'leave' ? 'יציאה מוקדמת' : 'ביטול הגעה'),
    })
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
    details: `עדכון סטטוס עובד (${kind}) במשמרת ${shift.date} · ${shift.shiftType}`,
  })

  return getWorkerHome(req)
}
