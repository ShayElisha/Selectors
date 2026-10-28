import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'
import { appendAuditLog } from './audit.js'
import { listSystemMessages } from './messages.js'

const COLLECTION = 'worker_notices'

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

function noticeSource(doc) {
  const kind = String(doc.kind || '')
  if (kind === 'reminder' || kind === 'assignment') return kind
  return 'manager'
}

function publicNotice(doc, workerId) {
  const readBy = Array.isArray(doc.readBy) ? doc.readBy.map(String) : []
  const targets = Array.isArray(doc.targetWorkerIds)
    ? doc.targetWorkerIds.map(String)
    : null
  return {
    id: String(doc._id),
    source: noticeSource(doc),
    kind: String(doc.kind || 'broadcast'),
    title: String(doc.title || ''),
    body: String(doc.body || ''),
    at: String(doc.at || ''),
    authorName: String(doc.authorName || 'מנהל'),
    read: workerId ? readBy.includes(String(workerId)) : false,
    targeted: Boolean(targets && targets.length > 0),
  }
}

function noticeVisibleToWorker(doc, workerId) {
  const targets = Array.isArray(doc.targetWorkerIds)
    ? doc.targetWorkerIds.map(String)
    : null
  if (!targets || targets.length === 0) return true
  return targets.includes(String(workerId))
}

async function noticesCol() {
  const db = await getDb()
  return db.collection(COLLECTION)
}

export async function createWorkerNotice(body, actor, { scope } = {}) {
  if (!scope?.orgId || !scope?.module) {
    throw httpError('חסר היקף ארגון', 400)
  }
  if (actor?.role !== 'org_manager') {
    throw httpError('רק מנהל יכול לשלוח הודעות לעובדים', 403)
  }
  const title = String(body?.title || '').trim().slice(0, 120)
  const text = String(body?.body || '').trim().slice(0, 2000)
  if (title.length < 2) throw httpError('נא לכתוב כותרת', 400)
  if (text.length < 2) throw httpError('נא לכתוב את ההודעה', 400)

  const doc = {
    _id: randomUUID(),
    orgId: String(scope.orgId),
    module: String(scope.module),
    title,
    body: text,
    kind: 'broadcast',
    at: new Date().toISOString(),
    authorId: String(actor.id || ''),
    authorName: String(actor.fullName || 'מנהל'),
    readBy: [],
  }
  const col = await noticesCol()
  await col.insertOne(doc)
  await appendAuditLog({
    action: 'worker_notice',
    actor,
    orgId: scope.orgId,
    module: scope.module,
    details: `הודעה לעובדים: ${title}`,
  })
  return publicNotice(doc, null)
}

/**
 * Insert a system/manager-targeted notice (idempotent when id is provided).
 * @param {{
 *   id?: string,
 *   title: string,
 *   body: string,
 *   kind?: 'assignment' | 'reminder' | 'broadcast',
 *   targetWorkerIds?: string[],
 *   authorName?: string,
 *   authorId?: string,
 * }} notice
 * @param {{ orgId: string, module: string }} scope
 */
export async function upsertTargetedWorkerNotice(notice, scope) {
  if (!scope?.orgId || !scope?.module) return null
  const title = String(notice?.title || '').trim().slice(0, 120)
  const text = String(notice?.body || '').trim().slice(0, 2000)
  if (title.length < 2 || text.length < 2) return null
  const targets = Array.isArray(notice?.targetWorkerIds)
    ? [...new Set(notice.targetWorkerIds.map(String).filter(Boolean))]
    : []
  if (targets.length === 0) return null

  const id = String(notice?.id || randomUUID())
  const doc = {
    _id: id,
    orgId: String(scope.orgId),
    module: String(scope.module),
    title,
    body: text,
    kind: String(notice?.kind || 'assignment'),
    targetWorkerIds: targets,
    at: new Date().toISOString(),
    authorId: String(notice?.authorId || 'system'),
    authorName: String(notice?.authorName || 'מערכת'),
    readBy: [],
  }
  const col = await noticesCol()
  const result = await col.updateOne(
    { _id: id },
    { $setOnInsert: doc },
    { upsert: true },
  )
  if (!result.upsertedCount) return null
  return publicNotice(doc, null)
}

export async function listWorkerInbox(actor, { scope, briefings = [] } = {}) {
  if (!scope?.orgId || !scope?.module) {
    throw httpError('חסר היקף ארגון', 400)
  }
  const col = await noticesCol()
  const managerRows = await col
    .find({ orgId: String(scope.orgId), module: String(scope.module) })
    .sort({ at: -1 })
    .limit(120)
    .toArray()

  const managerNotices = managerRows
    .filter((doc) => noticeVisibleToWorker(doc, actor.id))
    .map((doc) => publicNotice(doc, actor.id))

  let systemNotices = []
  try {
    const system = await listSystemMessages()
    systemNotices = system.slice(0, 20).map((m) => ({
      id: `system:${m.id}`,
      source: 'system',
      kind: 'system',
      title: m.title,
      body: m.body,
      at: m.at,
      authorName: 'מערכת',
      read: false,
      targeted: false,
    }))
  } catch {
    systemNotices = []
  }

  const briefingNotices = (briefings || [])
    .filter((b) => b?.starred)
    .slice(0, 10)
    .map((b) => ({
      id: `briefing:${b.id}`,
      source: 'briefing',
      kind: 'briefing',
      title: `תדריך חשוב: ${b.title || ''}`.trim(),
      body: String(b.body || '').slice(0, 400),
      at: String(b.updatedAt || new Date().toISOString()),
      authorName: 'תדריכים',
      read: false,
      targeted: false,
    }))

  const items = [...managerNotices, ...systemNotices, ...briefingNotices].sort(
    (a, b) => String(b.at).localeCompare(String(a.at)),
  )

  const unread = items.filter(
    (item) =>
      (item.source === 'manager' ||
        item.source === 'assignment' ||
        item.source === 'reminder') &&
      !item.read,
  ).length

  return { items, unread }
}

export async function markWorkerNoticeRead(noticeId, actor, { scope } = {}) {
  if (!scope?.orgId || !actor?.id) throw httpError('חסרים פרטי משתמש', 400)
  const id = String(noticeId || '')
  if (!id || id.startsWith('system:') || id.startsWith('briefing:')) {
    return { ok: true }
  }
  const col = await noticesCol()
  await col.updateOne(
    {
      _id: id,
      orgId: String(scope.orgId),
      module: String(scope.module),
    },
    { $addToSet: { readBy: String(actor.id) } },
  )
  return { ok: true }
}

export async function markAllWorkerNoticesRead(actor, { scope } = {}) {
  if (!scope?.orgId || !actor?.id) throw httpError('חסרים פרטי משתמש', 400)
  const col = await noticesCol()
  const rows = await col
    .find({
      orgId: String(scope.orgId),
      module: String(scope.module),
      readBy: { $ne: String(actor.id) },
    })
    .project({ _id: 1, targetWorkerIds: 1 })
    .toArray()
  const ids = rows
    .filter((doc) => noticeVisibleToWorker(doc, actor.id))
    .map((doc) => doc._id)
  if (ids.length > 0) {
    await col.updateMany(
      { _id: { $in: ids } },
      { $addToSet: { readBy: String(actor.id) } },
    )
  }
  return { ok: true }
}
