import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'
import { scopeForRequest } from './scope.js'
import { requireWorkerActor } from './workerPortal.js'

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ENTRY_KINDS = new Set(['work', 'vacation', 'sick'])
const LEAVE_KINDS = new Set(['vacation', 'sick'])
const MAX_RATES = 8
const LEAVE_START = '08:00'
const LEAVE_END = '16:00'

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
    rates: [],
    entries: [],
  }
}

function normalizeStoredRate(item) {
  if (!item || typeof item !== 'object') return null
  const basis =
    item.basis === 'monthly' ? 'monthly' : item.basis === 'hourly' ? 'hourly' : null
  if (!basis) return null
  const amount = Math.round(Number(item.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000) return null
  const name = String(item.name || '').trim().slice(0, 40)
  if (name.length < 1) return null
  const id = String(item.id || '').trim() || randomUUID()
  return { id, name, basis, amount }
}

function effectiveRates(doc) {
  const stored = Array.isArray(doc.rates)
    ? doc.rates.map(normalizeStoredRate).filter(Boolean)
    : []
  if (stored.length > 0) return stored
  if (
    (doc.basis === 'hourly' || doc.basis === 'monthly') &&
    Number(doc.amount) > 0
  ) {
    return [
      {
        id: 'default',
        name: 'רגיל',
        basis: doc.basis,
        amount: Number(doc.amount),
      },
    ]
  }
  return []
}

function normalizeRatesInput(list) {
  if (!Array.isArray(list)) {
    throw httpError('רשימת תעריפים לא תקינה', 400)
  }
  if (list.length < 1) {
    throw httpError('נדרש לפחות תעריף אחד', 400)
  }
  if (list.length > MAX_RATES) {
    throw httpError(`אפשר עד ${MAX_RATES} תעריפים`, 400)
  }
  const rates = list.map((item) => normalizeStoredRate(item)).filter(Boolean)
  if (rates.length !== list.length) {
    throw httpError('פרטי תעריף לא תקינים', 400)
  }
  const names = new Set()
  for (const rate of rates) {
    if (names.has(rate.name)) {
      throw httpError('שם תעריף חייב להיות ייחודי', 400)
    }
    names.add(rate.name)
  }
  return rates
}

function primaryRate(rates) {
  if (!rates.length) return { basis: null, amount: 0 }
  const regular = rates.find((item) => item.name === 'רגיל') ?? rates[0]
  return { basis: regular.basis, amount: regular.amount }
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
    rates: Array.isArray(found.rates)
      ? found.rates.map(normalizeStoredRate).filter(Boolean)
      : [],
    entries: Array.isArray(found.entries) ? found.entries : [],
  }
}

function publicEntry(entry) {
  const kind = ENTRY_KINDS.has(entry.kind) ? entry.kind : 'work'
  return {
    id: String(entry.id),
    date: String(entry.date),
    start: String(entry.start),
    end: String(entry.end),
    ...(kind !== 'work' ? { kind } : {}),
    ...(entry.rateId ? { rateId: String(entry.rateId) } : {}),
  }
}

function publicDoc(doc, from, to) {
  const rates = effectiveRates(doc)
  const entries = doc.entries
    .filter((entry) => entryOverlaps(entry, from, to))
    .map(publicEntry)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
  const primary = primaryRate(rates)
  return {
    basis: primary.basis ?? doc.basis,
    amount: primary.basis ? primary.amount : doc.amount,
    rates,
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

function normalizeRateId(rateId, doc) {
  const id = String(rateId || '').trim()
  if (!id) return undefined
  const rates = effectiveRates(doc)
  if (!rates.some((rate) => rate.id === id)) {
    throw httpError('תעריף לא תקין', 400)
  }
  return id
}

function normalizeEntry(body, doc) {
  const kind = ENTRY_KINDS.has(body.kind) ? body.kind : 'work'
  const rateId = normalizeRateId(body.rateId, doc)

  if (LEAVE_KINDS.has(kind)) {
    const date = String(body.date || '')
    if (!validDate(date)) {
      throw httpError('תאריך לא תקין', 400)
    }
    const start = LEAVE_START
    const end = LEAVE_END
    const span = intervalOf({ date, start, end })
    return { date, start, end, span, kind, rateId }
  }

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
  return { date, start, end, span, kind: 'work', rateId }
}

async function ownerOf(req, kind) {
  if (kind === 'manager') {
    const { actor, scope } = await scopeForRequest(req)
    assertInspectors(scope)
    return { orgId: String(scope.orgId), workerId: String(actor.id) }
  }
  const { actor, scope } = await requireWorkerActor(req)
  assertInspectors(scope)
  return { orgId: String(scope.orgId), workerId: String(actor.id) }
}

export async function getWorkerPay(req, query = {}, kind = 'worker') {
  const { orgId, workerId } = await ownerOf(req, kind)
  const from = String(query.from || '')
  const to = String(query.to || '')
  if ((from && !validDate(from)) || (to && !validDate(to))) {
    throw httpError('טווח תאריכים לא תקין', 400)
  }
  const doc = await loadDoc(orgId, workerId)
  return publicDoc(doc, from, to)
}

export function getManagerPay(req, query) {
  return getWorkerPay(req, query, 'manager')
}

export async function saveWorkerPayRate(req, body = {}, kind = 'worker') {
  const { orgId, workerId } = await ownerOf(req, kind)
  const collection = await payCollection()
  const existing = await loadDoc(orgId, workerId)

  let rates
  let basis
  let amount

  if (Array.isArray(body.rates)) {
    rates = normalizeRatesInput(body.rates)
    const primary = primaryRate(rates)
    basis = primary.basis
    amount = primary.amount
  } else {
    const nextBasis =
      body.basis === 'monthly' ? 'monthly' : body.basis === 'hourly' ? 'hourly' : null
    if (!nextBasis) throw httpError('בחרו שכר שעתי או שכר חודשי', 400)
    const nextAmount = Math.round(Number(body.amount) * 100) / 100
    if (!Number.isFinite(nextAmount) || nextAmount < 1 || nextAmount > 1_000_000) {
      throw httpError('הסכום צריך להיות בין 1 ל־1,000,000', 400)
    }
    const prior = effectiveRates(existing)
    const regularId =
      prior.find((item) => item.name === 'רגיל')?.id ??
      prior[0]?.id ??
      randomUUID()
    if (prior.length > 1) {
      rates = prior.map((item) =>
        item.name === 'רגיל' || item.id === regularId
          ? { ...item, id: regularId, name: 'רגיל', basis: nextBasis, amount: nextAmount }
          : item,
      )
      if (!rates.some((item) => item.name === 'רגיל')) {
        rates = [
          { id: regularId, name: 'רגיל', basis: nextBasis, amount: nextAmount },
          ...rates,
        ].slice(0, MAX_RATES)
      }
    } else {
      rates = [{ id: regularId, name: 'רגיל', basis: nextBasis, amount: nextAmount }]
    }
    basis = nextBasis
    amount = nextAmount
  }

  await collection.updateOne(
    { orgId, workerId },
    {
      $set: {
        basis,
        amount,
        rates,
        updatedAt: new Date().toISOString(),
      },
      $setOnInsert: { orgId, workerId, entries: [] },
    },
    { upsert: true },
  )
  const doc = await loadDoc(orgId, workerId)
  return publicDoc(doc)
}

export function saveManagerPayRate(req, body) {
  return saveWorkerPayRate(req, body, 'manager')
}

export async function addWorkerPayEntry(req, body = {}, kind = 'worker') {
  const { orgId, workerId } = await ownerOf(req, kind)
  const doc = await loadDoc(orgId, workerId)
  const next = normalizeEntry(body, doc)
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
    kind: next.kind,
    ...(next.rateId ? { rateId: next.rateId } : {}),
    createdAt: new Date().toISOString(),
  }
  const collection = await payCollection()
  const rates = effectiveRates(doc)
  const primary = primaryRate(rates)
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
          basis: doc.basis ?? primary.basis,
          amount: doc.amount || primary.amount,
          rates: doc.rates.length ? doc.rates : rates,
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

export function addManagerPayEntry(req, body) {
  return addWorkerPayEntry(req, body, 'manager')
}

export async function deleteWorkerPayEntry(req, entryId, kind = 'worker') {
  const { orgId, workerId } = await ownerOf(req, kind)
  const id = String(entryId || '')
  if (!id) throw httpError('הרשומה לא נמצאה', 404)
  const collection = await payCollection()
  const result = await collection.updateOne(
    { orgId, workerId },
    { $pull: { entries: { id } }, $set: { updatedAt: new Date().toISOString() } },
  )
  if (!result.matchedCount) throw httpError('הרשומה לא נמצאה', 404)
  return { ok: true }
}

export function deleteManagerPayEntry(req, entryId) {
  return deleteWorkerPayEntry(req, entryId, 'manager')
}
