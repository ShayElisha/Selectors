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

function publicNotice(doc, workerId) {
  const readBy = Array.isArray(doc.readBy) ? doc.readBy.map(String) : []
  return {
    id: String(doc._id),
    source: 'manager',
    title: String(doc.title || ''),
    body: String(doc.body || ''),
    at: String(doc.at || ''),
    authorName: String(doc.authorName || 'מנהל'),
    read: workerId ? readBy.includes(String(workerId)) : false,
  }
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

export async function listWorkerInbox(actor, { scope, briefings = [] } = {}) {
  if (!scope?.orgId || !scope?.module) {
    throw httpError('חסר היקף ארגון', 400)
  }
  const col = await noticesCol()
  const managerRows = await col
    .find({ orgId: String(scope.orgId), module: String(scope.module) })
    .sort({ at: -1 })
    .limit(80)
    .toArray()

  const managerNotices = managerRows.map((doc) => publicNotice(doc, actor.id))

  let systemNotices = []
  try {
    const system = await listSystemMessages()
    systemNotices = system.slice(0, 20).map((m) => ({
      id: `system:${m.id}`,
      source: 'system',
      title: m.title,
      body: m.body,
      at: m.at,
      authorName: 'מערכת',
      read: false,
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
      title: `תדריך חשוב: ${b.title || ''}`.trim(),
      body: String(b.body || '').slice(0, 400),
      at: String(b.updatedAt || new Date().toISOString()),
      authorName: 'תדריכים',
      read: false,
    }))

  const items = [...managerNotices, ...systemNotices, ...briefingNotices].sort(
    (a, b) => String(b.at).localeCompare(String(a.at)),
  )

  const unread = items.filter(
    (item) => item.source === 'manager' && !item.read,
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
  await col.updateMany(
    {
      orgId: String(scope.orgId),
      module: String(scope.module),
      readBy: { $ne: String(actor.id) },
    },
    { $addToSet: { readBy: String(actor.id) } },
  )
  return { ok: true }
}
