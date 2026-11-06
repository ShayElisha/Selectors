import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'
import { requireWorkerActor } from './workerPortal.js'

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validDate(iso) {
  if (!DATE_RE.test(iso)) return false
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/

function normalizeClock(value) {
  const match = CLOCK_RE.exec(String(value || ''))
  if (!match) return null
  return `${match[1]}:${match[2]}`
}

let indexReady = null

async function payCollection() {
  const db = await getDb('inspectors')
  const collection = db.collection('worker_pay')
  if (!indexReady) {
    indexReady = collection.createIndex(
      { orgId: 1, workerId: 1 },
      { unique: true },
    )
  }
  await indexReady
  return collection
}

function assertInspectors(scope) {
  if (scope.module !== 'inspectors') {
    throw httpError('דף השכר פתוח לבודקים בלבד', 403)
  }
}

function emptyDoc(orgId, workerId) {
  return {
    orgId,
    workerId,
    basis: null,
    amount: 0,
    entries: [],
  }
}

async function loadDoc(orgId, workerId) {
  const collection = await payCollection()
  const found = await collection.findOne({ orgId, workerId })
  if (!found) return emptyDoc(orgId, workerId)
  return {
    orgId,
    workerId,
    basis: found.basis === 'hourly' || found.basis === 'monthly' ? found.basis : null,
    amount: Number(found.amount) || 0,
    entries: Array.isArray(found.entries) ? found.entries : [],
  }
}

function publicEntry(entry) {
  return {
    id: String(entry.id),
    date: String(entry.date),
    start: String(entry.start),
    end: String(entry.end),
  }
}

function publicDoc(doc, from, to) {
  const entries = doc.entries
    .filter((entry) => entryOverlaps(entry, from, to))
    .map(publicEntry)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
  return {
    basis: doc.basis,
    amount: doc.amount,
    entries,
  }
}

function dayNumber(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function clockMinutes(value) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function intervalOf(entry) {
  const start = dayNumber(entry.date) * 1440 + clockMinutes(entry.start)
  const endClock = clockMinutes(entry.end)
  const startClock = clockMinutes(entry.start)
  const end =
    endClock <= startClock
      ? start - startClock + 1440 + endClock
      : start - startClock + endClock
  return { start, end }
}

function entryOverlaps(entry, from, to) {
  if (!from || !to) return true
  if (!validDate(entry.date) || !normalizeClock(entry.start) || !normalizeClock(entry.end)) {
    return false
  }
  const span = intervalOf(entry)
  const rangeStart = dayNumber(from) * 1440
  const rangeEnd = (dayNumber(to) + 1) * 1440
  return span.start < rangeEnd && span.end > rangeStart
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end
}

function normalizeEntry(body) {
  const date = String(body.date || '')
  const start = normalizeClock(body.start)
  const end = normalizeClock(body.end)
  if (!validDate(date)) {
    throw httpError('תאריך לא תקין', 400)
  }
  if (!start || !end) {
    throw httpError('שעות לא תקינות', 400)
  }
  if (start === end) throw httpError('שעת הסיום צריכה להיות שונה מההתחלה', 400)
  const span = intervalOf({ date, start, end })
  const duration = span.end - span.start
  if (duration < 15 || duration > 16 * 60) {
    throw httpError('אפשר לרשום בין רבע שעה ל־16 שעות', 400)
  }
  return { date, start, end, span }
}

export async function getWorkerPay(req, query = {}) {
  const { actor, scope } = await requireWorkerActor(req)
  assertInspectors(scope)
  const from = String(query.from || '')
  const to = String(query.to || '')
  if ((from && !validDate(from)) || (to && !validDate(to))) {
    throw httpError('טווח תאריכים לא תקין', 400)
  }
  const doc = await loadDoc(String(scope.orgId), String(actor.id))
  return publicDoc(doc, from, to)
}

export async function saveWorkerPayRate(req, body = {}) {
  const { actor, scope } = await requireWorkerActor(req)
  assertInspectors(scope)
  const basis = body.basis === 'monthly' ? 'monthly' : body.basis === 'hourly' ? 'hourly' : null
  if (!basis) throw httpError('בחרו שכר שעתי או שכר חודשי', 400)
  const amount = Math.round(Number(body.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000) {
    throw httpError('הסכום צריך להיות בין 1 ל־1,000,000', 400)
  }
  const collection = await payCollection()
  const orgId = String(scope.orgId)
  const workerId = String(actor.id)
  await collection.updateOne(
    { orgId, workerId },
    {
      $set: { basis, amount, updatedAt: new Date().toISOString() },
      $setOnInsert: { orgId, workerId, entries: [] },
    },
    { upsert: true },
  )
  const doc = await loadDoc(orgId, workerId)
  return publicDoc(doc)
}

export async function addWorkerPayEntry(req, body = {}) {
  const { actor, scope } = await requireWorkerActor(req)
  assertInspectors(scope)
  const next = normalizeEntry(body)
  const orgId = String(scope.orgId)
  const workerId = String(actor.id)
  const doc = await loadDoc(orgId, workerId)
  if (doc.entries.length >= 500) {
    throw httpError('אפשר לשמור עד 500 רשומות', 400)
  }
  if (
    doc.entries.some(
      (entry) =>
        validDate(entry.date) &&
        normalizeClock(entry.start) &&
        normalizeClock(entry.end) &&
        overlaps(intervalOf(entry), next.span),
    )
  ) {
    throw httpError('יש כבר רשומה שחופפת לשעות האלה', 400)
  }
  const entry = {
    id: randomUUID(),
    date: next.date,
    start: next.start,
    end: next.end,
    createdAt: new Date().toISOString(),
  }
  const collection = await payCollection()
  const update = {
    $push: { entries: entry },
    $set: { updatedAt: new Date().toISOString() },
  }
  try {
    await collection.updateOne(
      { orgId, workerId },
      {
        ...update,
        $setOnInsert: {
          orgId,
          workerId,
          basis: doc.basis,
          amount: doc.amount,
        },
      },
      { upsert: true },
    )
  } catch (err) {
    if (err?.code !== 11000) throw err
    await collection.updateOne({ orgId, workerId }, update)
  }
  return publicEntry(entry)
}

export async function deleteWorkerPayEntry(req, entryId) {
  const { actor, scope } = await requireWorkerActor(req)
  assertInspectors(scope)
  const id = String(entryId || '')
  if (!id) throw httpError('הרשומה לא נמצאה', 404)
  const collection = await payCollection()
  const result = await collection.updateOne(
    { orgId: String(scope.orgId), workerId: String(actor.id) },
    { $pull: { entries: { id } }, $set: { updatedAt: new Date().toISOString() } },
  )
  if (!result.matchedCount) throw httpError('הרשומה לא נמצאה', 404)
  return { ok: true }
}
