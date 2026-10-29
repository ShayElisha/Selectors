import { randomUUID } from 'node:crypto'
import { appendAuditLog } from './audit.js'
import { appendIncident, patchIncident, readState } from './data.js'
import { scopeForRequest } from './scope.js'
import { upsertTargetedWorkerNotice } from './workerNotices.js'
import { requireWorkerActor } from './workerPortal.js'

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

const SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])

function publicWorkerIncident(item) {
  if (!item) return null
  return {
    id: String(item.id),
    kind: item.kind === 'event' ? 'event' : 'fault',
    title: String(item.title || ''),
    description: String(item.description || ''),
    severity: SEVERITIES.has(item.severity) ? item.severity : 'medium',
    status: String(item.status || 'pending_approval'),
    laneId: item.laneId ? String(item.laneId) : undefined,
    shiftDate: item.shiftDate ? String(item.shiftDate) : undefined,
    shiftType: item.shiftType ? String(item.shiftType) : undefined,
    handlingNotes: item.handlingNotes ? String(item.handlingNotes) : undefined,
    reportedByWorkerId: item.reportedByWorkerId
      ? String(item.reportedByWorkerId)
      : undefined,
    reportedByName: item.reportedByName ? String(item.reportedByName) : undefined,
    approvedBy: item.approvedBy ? String(item.approvedBy) : undefined,
    approvedAt: item.approvedAt ? String(item.approvedAt) : undefined,
    rejectedBy: item.rejectedBy ? String(item.rejectedBy) : undefined,
    rejectedAt: item.rejectedAt ? String(item.rejectedAt) : undefined,
    rejectionReason: item.rejectionReason
      ? String(item.rejectionReason)
      : undefined,
    createdAt: String(item.createdAt || ''),
    createdBy: String(item.createdBy || ''),
    updatedAt: String(item.updatedAt || ''),
    updatedBy: String(item.updatedBy || ''),
  }
}

/**
 * List fault reports submitted by the signed-in worker.
 * Includes lanes for the report form.
 */
export async function listWorkerIncidents(req) {
  const { actor, scope } = await requireWorkerActor(req)
  const state = await readState(scope)
  const mine = (state.incidents || [])
    .filter(
      (item) =>
        item &&
        item.kind === 'fault' &&
        String(item.reportedByWorkerId || '') === String(actor.id),
    )
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(publicWorkerIncident)

  const lanes = (state.lanes || [])
    .filter((lane) => lane && String(lane.id) !== 'gate-manager')
    .map((lane) => ({
      id: String(lane.id),
      name: String(lane.name || ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))

  return {
    module: scope.module,
    incidents: mine,
    lanes,
  }
}

/**
 * Worker submits a fault report. It stays pending_approval until a shift
 * manager opens it from the incidents journal.
 */
export async function submitWorkerFault(req, body = {}) {
  const { actor, scope } = await requireWorkerActor(req)
  const title = String(body.title || '').trim().slice(0, 120)
  const description = String(body.description || '').trim().slice(0, 4000)
  if (title.length < 2) throw httpError('נא לכתוב כותרת לתקלה', 400)
  if (description.length < 2) throw httpError('נא לתאר את התקלה', 400)

  const severity = SEVERITIES.has(body.severity) ? body.severity : 'medium'
  const laneId = String(body.laneId || '').trim()
  if (laneId) {
    const state = await readState(scope)
    if (!(state.lanes || []).some((lane) => lane.id === laneId)) {
      throw httpError('העמדה שנבחרה אינה קיימת', 400)
    }
  }

  const now = new Date().toISOString()
  const incident = {
    id: randomUUID(),
    kind: 'fault',
    title,
    description,
    severity,
    status: 'pending_approval',
    ...(laneId ? { laneId } : {}),
    reportedByWorkerId: String(actor.id),
    reportedByName: String(actor.fullName || 'עובד'),
    createdAt: now,
    createdBy: String(actor.fullName || 'עובד'),
    updatedAt: now,
    updatedBy: String(actor.fullName || 'עובד'),
  }

  let saved
  try {
    const result = await appendIncident(incident, { scope, actor })
    saved = result.incident
  } catch (err) {
    if (err?.status === 409) {
      throw httpError('הנתונים השתנו במקביל. נסו לשלוח שוב.', 409)
    }
    throw err
  }

  await appendAuditLog({
    action: 'incident_report',
    actor,
    orgId: scope.orgId,
    module: scope.module,
    details: `דיווח תקלה מממתין לאישור: ${title}`,
  })

  try {
    const state = await readState(scope)
    const managerIds = (state.workers || [])
      .filter(
        (w) =>
          w &&
          w.status !== 'inactive' &&
          w.status !== 'archived' &&
          (w.isManager || w.isOrgManager),
      )
      .map((w) => String(w.id))
      .filter(Boolean)
    if (managerIds.length > 0) {
      await upsertTargetedWorkerNotice(
        {
          id: `fault-pending:${saved.id}`,
          title: 'דיווח תקלה ממתין לאישור',
          body: `${actor.fullName || 'עובד'} דיווח על «${title}». פתחו את יומן התקלות כדי לאשר או לדחות.`,
          kind: 'broadcast',
          targetWorkerIds: managerIds,
          authorId: actor.id,
          authorName: actor.fullName || 'עובד',
        },
        scope,
      )
    }
  } catch (err) {
    console.error('[worker-incidents] manager notice failed', err?.message || err)
  }

  return publicWorkerIncident(saved)
}

/**
 * Manager approves/rejects a worker fault report and notifies the reporter.
 */
export async function reviewWorkerFaultReport(req, id, body = {}) {
  const { actor, scope } = await scopeForRequest(req)
  const decision =
    body.decision === 'reject'
      ? 'reject'
      : body.decision === 'approve'
        ? 'approve'
        : null
  if (!decision) throw httpError('החלטה לא תקינה', 400)
  const reason = String(body.rejectionReason || '')
    .trim()
    .slice(0, 500)
  const incidentId = String(id || '').trim()
  if (!incidentId) throw httpError('חסר מזהה דיווח', 400)

  const now = new Date().toISOString()
  const actorName = String(actor.fullName || 'מנהל')

  let savedIncident
  let savedData
  try {
    const result = await patchIncident(
      incidentId,
      (existing) => {
        if (existing.kind !== 'fault') {
          throw httpError('ניתן לאשר רק דיווחי תקלה', 400)
        }
        if (existing.status !== 'pending_approval') {
          throw httpError('הדיווח כבר טופל', 400)
        }
        return {
          ...existing,
          status: decision === 'approve' ? 'open' : 'rejected',
          updatedAt: now,
          updatedBy: actorName,
          ...(decision === 'approve'
            ? { approvedBy: actorName, approvedAt: now }
            : {
                rejectedBy: actorName,
                rejectedAt: now,
                ...(reason ? { rejectionReason: reason } : {}),
              }),
        }
      },
      { scope, actor },
    )
    savedIncident = result.incident
    savedData = result.data
  } catch (err) {
    if (err?.status === 409) {
      throw httpError('הנתונים השתנו במקביל. נסו שוב.', 409)
    }
    throw err
  }

  await appendAuditLog({
    action: decision === 'approve' ? 'incident_approve' : 'incident_reject',
    actor,
    orgId: scope.orgId,
    module: scope.module,
    details:
      decision === 'approve'
        ? `אושרה תקלה מדיווח עובד: ${savedIncident.title}`
        : `נדחתה תקלה מדיווח עובד: ${savedIncident.title}`,
  })

  const reporterId = String(savedIncident.reportedByWorkerId || '').trim()
  if (reporterId) {
    try {
      await upsertTargetedWorkerNotice(
        {
          id: `fault-review:${savedIncident.id}:${decision}`,
          title:
            decision === 'approve'
              ? 'התקלה שדיווחתם אושרה'
              : 'התקלה שדיווחתם נדחתה',
          body:
            decision === 'approve'
              ? `מנהל המשמרת אישר את הדיווח «${savedIncident.title}». התקלה נפתחה ביומן המחלקה.`
              : `מנהל המשמרת דחה את הדיווח «${savedIncident.title}».${
                  reason ? ` סיבה: ${reason}` : ''
                }`,
          kind: 'broadcast',
          targetWorkerIds: [reporterId],
          authorId: String(actor.id || ''),
          authorName: actorName,
        },
        scope,
      )
    } catch (err) {
      console.error(
        '[worker-incidents] reporter notice failed',
        err?.message || err,
      )
    }
  }

  return {
    data: savedData,
    incident: publicWorkerIncident(savedIncident),
  }
}
