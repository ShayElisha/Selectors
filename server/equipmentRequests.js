import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'
import { appendAuditLog } from './audit.js'
import { scopeForRequest } from './scope.js'
import { requireWorkerActor } from './workerPortal.js'
import { upsertTargetedWorkerNotice } from './workerNotices.js'

const COLLECTION = 'equipment_requests'

export const EQUIPMENT_TYPES = {
  vest: 'אפוד',
  device: 'מכשיר',
  key: 'מפתח',
  other: 'אחר',
}

export const EQUIPMENT_STATUSES = {
  pending: 'ממתין',
  approved: 'אושר',
  fulfilled: 'סופק',
  rejected: 'נדחה',
}

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

async function col() {
  const db = await getDb()
  return db.collection(COLLECTION)
}

function normalizeType(raw) {
  const value = String(raw || '').trim()
  return Object.prototype.hasOwnProperty.call(EQUIPMENT_TYPES, value)
    ? value
    : null
}

function normalizeStatus(raw) {
  const value = String(raw || '').trim()
  return Object.prototype.hasOwnProperty.call(EQUIPMENT_STATUSES, value)
    ? value
    : null
}

function publicRequest(doc) {
  return {
    id: String(doc._id),
    orgId: String(doc.orgId || ''),
    module: String(doc.module || ''),
    workerId: String(doc.workerId || ''),
    workerName: String(doc.workerName || ''),
    equipmentType: String(doc.equipmentType || 'other'),
    equipmentLabel:
      EQUIPMENT_TYPES[doc.equipmentType] ||
      String(doc.equipmentLabel || 'אחר'),
    quantity: Number(doc.quantity) || 1,
    notes: String(doc.notes || ''),
    status: String(doc.status || 'pending'),
    managerNotes: String(doc.managerNotes || ''),
    createdAt: String(doc.createdAt || ''),
    updatedAt: String(doc.updatedAt || ''),
    updatedBy: String(doc.updatedBy || ''),
  }
}

export async function listWorkerEquipmentRequests(req) {
  const { actor, scope } = await requireWorkerActor(req)
  const collection = await col()
  const rows = await collection
    .find({
      orgId: String(scope.orgId),
      module: String(scope.module),
      workerId: String(actor.id),
    })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray()
  return {
    module: scope.module,
    types: EQUIPMENT_TYPES,
    requests: rows.map(publicRequest),
  }
}

export async function submitWorkerEquipmentRequest(req, body = {}) {
  const { actor, scope } = await requireWorkerActor(req)
  const equipmentType = normalizeType(body.equipmentType)
  if (!equipmentType) throw httpError('נא לבחור סוג ציוד', 400)
  const quantity = Math.min(
    20,
    Math.max(1, Math.trunc(Number(body.quantity) || 1)),
  )
  const notes = String(body.notes || '').trim().slice(0, 500)
  if (equipmentType === 'other' && notes.length < 2) {
    throw httpError('בבחירת «אחר» יש לפרט מה נדרש', 400)
  }
  const now = new Date().toISOString()
  const doc = {
    _id: randomUUID(),
    orgId: String(scope.orgId),
    module: String(scope.module),
    workerId: String(actor.id),
    workerName: String(actor.fullName || ''),
    equipmentType,
    equipmentLabel: EQUIPMENT_TYPES[equipmentType],
    quantity,
    notes,
    status: 'pending',
    managerNotes: '',
    createdAt: now,
    updatedAt: now,
    updatedBy: String(actor.fullName || ''),
  }
  const collection = await col()
  await collection.insertOne(doc)
  await appendAuditLog({
    action: 'equipment_request_create',
    actor,
    orgId: scope.orgId,
    module: scope.module,
    details: `${EQUIPMENT_TYPES[equipmentType]} ×${quantity} · ${actor.fullName || ''}`,
  })
  return publicRequest(doc)
}

export async function listManagerEquipmentRequests(req) {
  const { actor, scope } = await scopeForRequest(req)
  if (actor.role !== 'org_manager') {
    throw httpError('רק מנהל יכול לצפות בבקשות ציוד', 403)
  }
  const status = normalizeStatus(req.query?.status)
  const base = {
    orgId: String(scope.orgId),
    module: String(scope.module),
  }
  const collection = await col()
  const pending = await collection.countDocuments({ ...base, status: 'pending' })
  const filter = status ? { ...base, status } : base
  const rows = await collection
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray()
  return {
    module: scope.module,
    types: EQUIPMENT_TYPES,
    statuses: EQUIPMENT_STATUSES,
    pending,
    requests: rows.map(publicRequest),
  }
}

export async function updateManagerEquipmentRequest(req, id, body = {}) {
  const { actor, scope } = await scopeForRequest(req)
  if (actor.role !== 'org_manager') {
    throw httpError('רק מנהל יכול לעדכן בקשות ציוד', 403)
  }
  const status = normalizeStatus(body.status)
  if (!status) throw httpError('סטטוס לא תקין', 400)
  const managerNotes = String(body.managerNotes || '').trim().slice(0, 500)
  const collection = await col()
  const existing = await collection.findOne({
    _id: String(id),
    orgId: String(scope.orgId),
    module: String(scope.module),
  })
  if (!existing) throw httpError('הבקשה לא נמצאה', 404)
  const now = new Date().toISOString()
  await collection.updateOne(
    { _id: existing._id },
    {
      $set: {
        status,
        managerNotes,
        updatedAt: now,
        updatedBy: String(actor.fullName || ''),
      },
    },
  )
  const next = {
    ...existing,
    status,
    managerNotes,
    updatedAt: now,
    updatedBy: String(actor.fullName || ''),
  }
  await appendAuditLog({
    action: 'equipment_request_update',
    actor,
    orgId: scope.orgId,
    module: scope.module,
    details: `${existing.workerName || ''} · ${EQUIPMENT_TYPES[existing.equipmentType] || existing.equipmentType} → ${EQUIPMENT_STATUSES[status]}`,
  })
  try {
    await upsertTargetedWorkerNotice(
      {
        targetWorkerIds: [String(existing.workerId)],
        title: `בקשת ציוד: ${EQUIPMENT_STATUSES[status]}`,
        body: `${EQUIPMENT_TYPES[existing.equipmentType] || 'ציוד'}${
          managerNotes ? ` · ${managerNotes}` : ''
        }`,
        kind: 'equipment',
        authorId: actor.id,
        authorName: actor.fullName || 'מנהל',
      },
      scope,
    )
  } catch {
    // Notice is best-effort; status update already saved.
  }
  return publicRequest(next)
}
