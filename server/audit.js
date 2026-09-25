import { randomUUID } from 'node:crypto'
import { getAuditCollection } from './db.js'
import { getBearerToken, verifySessionToken } from './session.js'

/**
 * @typedef {{ id?: string, fullName?: string, phone?: string } | null} AuditActor
 */

const ALLOWED_CLIENT_ACTIONS = new Set([
  'auto_assign',
  'manual_assign',
  'manual_swap',
  'lane_note',
  'export_board',
])

/**
 * @param {{ action: string, actor?: AuditActor, details?: string }} entry
 */
export async function appendAuditLog({ action, actor, details }) {
  const col = await getAuditCollection()
  const doc = {
    id: randomUUID(),
    at: new Date().toISOString(),
    action: String(action || 'unknown'),
    actor: actor
      ? {
          id: actor.id || '',
          fullName: actor.fullName || '',
          phone: actor.phone || '',
        }
      : null,
    details: String(details || ''),
  }
  await col.insertOne(doc)
  return {
    id: doc.id,
    at: doc.at,
    action: doc.action,
    actor: doc.actor,
    details: doc.details,
  }
}

/**
 * @param {{ limit?: number }} [opts]
 */
export async function listAuditLogs(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 150, 1), 500)
  const col = await getAuditCollection()
  const docs = await col.find({}).sort({ at: -1 }).limit(limit).toArray()
  return docs.map((d) => ({
    id: d.id,
    at: d.at,
    action: d.action,
    actor: d.actor ?? null,
    details: d.details || '',
  }))
}

/**
 * Actor from verified Bearer token only (ignores spoofable headers).
 * @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined> }} req
 */
export function actorFromRequest(req) {
  return verifySessionToken(getBearerToken(req))
}

/**
 * Validate and append a client-originated audit event.
 * @param {{ action: string, details?: string, actor?: AuditActor }} body
 */
export async function appendClientAuditEvent(body, actor) {
  const action = String(body?.action || '')
  if (!ALLOWED_CLIENT_ACTIONS.has(action)) {
    const err = new Error('סוג פעולת יומן לא מורשה')
    err.status = 400
    throw err
  }
  const details = String(body?.details || '').slice(0, 2000)
  if (!details.trim()) {
    const err = new Error('נא לפרט את פרטי הפעולה')
    err.status = 400
    throw err
  }
  return appendAuditLog({ action, actor, details })
}

function nameById(list, id) {
  if (!id) return '(ריק)'
  const hit = (list || []).find((x) => x.id === id)
  return hit?.fullName || hit?.name || id
}

/**
 * Build worker→lane map from a shift schedule (first lane wins if duplicate).
 * @param {{ assignments?: { laneId: string, workerIds?: string[] }[] } | null | undefined} schedule
 */
function workerLaneMap(schedule) {
  /** @type {Map<string, string>} */
  const map = new Map()
  for (const a of schedule?.assignments || []) {
    for (const wid of a.workerIds || []) {
      if (!wid || map.has(wid)) continue
      map.set(wid, a.laneId)
    }
  }
  return map
}

/**
 * Human-readable assignment movements: who moved where / who swapped.
 * @param {object | null | undefined} prev
 * @param {object | null | undefined} next
 * @param {{ workers?: { id: string, fullName?: string }[], lanes?: { id: string, name?: string }[] }} catalog
 */
export function summarizeAssignmentChanges(prev, next, catalog = {}) {
  const workers = catalog.workers || []
  const lanes = catalog.lanes || []
  const laneName = (id) => nameById(lanes, id)
  const workerName = (id) => nameById(workers, id)

  const before = workerLaneMap(prev)
  const after = workerLaneMap(next)
  const allIds = new Set([...before.keys(), ...after.keys()])

  /** @type {string[]} */
  const swaps = []
  /** @type {string[]} */
  const moves = []
  /** @type {string[]} */
  const added = []
  /** @type {string[]} */
  const removed = []
  const consumed = new Set()

  for (const id of allIds) {
    if (consumed.has(id)) continue
    const from = before.get(id)
    const to = after.get(id)
    if (from === to) continue

    // Detect 2-way swap: A: L1→L2 and B: L2→L1
    if (from && to) {
      let partnerId = null
      for (const other of allIds) {
        if (other === id || consumed.has(other)) continue
        const oFrom = before.get(other)
        const oTo = after.get(other)
        if (oFrom === to && oTo === from) {
          partnerId = other
          break
        }
      }
      if (partnerId) {
        swaps.push(
          `${workerName(id)} ↔ ${workerName(partnerId)} (${laneName(from)} ↔ ${laneName(to)})`,
        )
        consumed.add(id)
        consumed.add(partnerId)
        continue
      }
      moves.push(`${workerName(id)}: ${laneName(from)} → ${laneName(to)}`)
      consumed.add(id)
      continue
    }

    if (!from && to) {
      added.push(`${workerName(id)} → ${laneName(to)}`)
      consumed.add(id)
      continue
    }
    if (from && !to) {
      removed.push(`${workerName(id)} מ${laneName(from)}`)
      consumed.add(id)
    }
  }

  /** @type {string[]} */
  const noteChanges = []
  const prevNotes = new Map(
    (prev?.assignments || []).map((a) => [a.laneId, (a.notes || '').trim()]),
  )
  const nextNotes = new Map(
    (next?.assignments || []).map((a) => [a.laneId, (a.notes || '').trim()]),
  )
  const noteLaneIds = new Set([...prevNotes.keys(), ...nextNotes.keys()])
  for (const laneId of noteLaneIds) {
    const a = prevNotes.get(laneId) || ''
    const b = nextNotes.get(laneId) || ''
    if (a === b) continue
    const label = laneName(laneId)
    if (!a && b) noteChanges.push(`${label}: נוספה הערה «${b}»`)
    else if (a && !b) noteChanges.push(`${label}: הוסרה הערה «${a}»`)
    else noteChanges.push(`${label}: «${a}» → «${b}»`)
  }

  const parts = []
  if (swaps.length) parts.push(`החלפות: ${swaps.join(' · ')}`)
  if (moves.length) parts.push(`מעברים: ${moves.join(' · ')}`)
  if (added.length) parts.push(`שובצו: ${added.join(' · ')}`)
  if (removed.length) parts.push(`הוסרו: ${removed.join(' · ')}`)
  if (noteChanges.length) parts.push(`הערות: ${noteChanges.join(' · ')}`)
  return parts.join(' · ')
}

/**
 * Compact shift header for audit lines.
 * @param {object} schedule
 */
export function shiftAuditHeader(schedule) {
  const filled = (schedule.assignments || []).reduce(
    (n, a) => n + (a.workerIds?.filter(Boolean).length || 0),
    0,
  )
  const lanes = (schedule.activeLaneIds || []).length
  return `${schedule.date || '?'} · ${schedule.shiftType || '?'} · ${lanes} נתיבים · ${filled} שיבוצים`
}

/**
 * Detailed worker cert / lane requirement change events (+ residual data_update).
 * @returns {{ action: string, details: string }[]}
 */
export function diffAppDataAuditEvents(prev, next) {
  /** @type {{ action: string, details: string }[]} */
  const events = []
  const pw = prev?.workers ?? []
  const nw = next?.workers ?? []
  const pl = prev?.lanes ?? []
  const nl = next?.lanes ?? []

  for (const w of nw) {
    const o = pw.find((x) => x.id === w.id)
    if (!o) {
      events.push({
        action: 'data_update',
        details: `נוסף בודק: ${w.fullName || w.id}`,
      })
      continue
    }
    const beforeCerts = [...(o.certifications || [])].sort()
    const afterCerts = [...(w.certifications || [])].sort()
    if (JSON.stringify(beforeCerts) !== JSON.stringify(afterCerts)) {
      const beforeSet = new Set(beforeCerts)
      const afterSet = new Set(afterCerts)
      const added = afterCerts.filter((c) => !beforeSet.has(c))
      const removed = beforeCerts.filter((c) => !afterSet.has(c))
      const bits = []
      if (added.length) bits.push(`נוספו: ${added.join(', ')}`)
      if (removed.length) bits.push(`הוסרו: ${removed.join(', ')}`)
      events.push({
        action: 'worker_cert_change',
        details: `${w.fullName || w.id}: ${bits.join(' · ') || 'עודכנו הסמכות'}`,
      })
    }
  }
  for (const o of pw) {
    if (!nw.some((w) => w.id === o.id)) {
      events.push({
        action: 'data_update',
        details: `הוסר בודק: ${o.fullName || o.id}`,
      })
    }
  }

  for (const lane of nl) {
    const o = pl.find((x) => x.id === lane.id)
    if (!o) {
      events.push({
        action: 'data_update',
        details: `נוסף נתיב: ${lane.name || lane.id}`,
      })
      continue
    }
    const beforeReq = [...(o.requiredCertifications || [])].sort()
    const afterReq = [...(lane.requiredCertifications || [])].sort()
    if (JSON.stringify(beforeReq) !== JSON.stringify(afterReq)) {
      const beforeSet = new Set(beforeReq)
      const afterSet = new Set(afterReq)
      const added = afterReq.filter((c) => !beforeSet.has(c))
      const removed = beforeReq.filter((c) => !afterSet.has(c))
      const bits = []
      if (added.length) bits.push(`נוספו דרישות: ${added.join(', ')}`)
      if (removed.length) bits.push(`הוסרו דרישות: ${removed.join(', ')}`)
      events.push({
        action: 'lane_req_change',
        details: `${lane.name || lane.id}: ${bits.join(' · ') || 'עודכנו דרישות הסמכה'}`,
      })
    }
  }
  for (const o of pl) {
    if (!nl.some((l) => l.id === o.id)) {
      events.push({
        action: 'data_update',
        details: `הוסר נתיב: ${o.name || o.id}`,
      })
    }
  }

  // Residual non-cert / non-req field changes → single data_update summary
  const residual = summarizeAppDataChangeResidual(prev, next)
  if (residual) {
    events.push({ action: 'data_update', details: residual })
  }

  return events
}

/** Legacy one-line summary (workers/lanes counts + non-cert field tweaks). */
export function summarizeAppDataChange(prev, next) {
  const events = diffAppDataAuditEvents(prev, next)
  return events.map((e) => e.details).join(' · ')
}

function summarizeAppDataChangeResidual(prev, next) {
  const parts = []
  const pw = prev?.workers ?? []
  const nw = next?.workers ?? []

  let metaWorkerChanges = 0
  for (const w of nw) {
    const o = pw.find((x) => x.id === w.id)
    if (!o) continue
    const certSame =
      JSON.stringify([...(o.certifications || [])].sort()) ===
      JSON.stringify([...(w.certifications || [])].sort())
    if (!certSame) continue
    if (
      o.fullName !== w.fullName ||
      o.phone !== w.phone ||
      o.status !== w.status ||
      o.isManager !== w.isManager ||
      (o.email || '') !== (w.email || '')
    ) {
      metaWorkerChanges += 1
    }
  }
  if (metaWorkerChanges) parts.push(`עודכנו פרטי ${metaWorkerChanges} בודקים`)

  const pl = prev?.lanes ?? []
  const nl = next?.lanes ?? []
  let metaLaneChanges = 0
  for (const lane of nl) {
    const o = pl.find((x) => x.id === lane.id)
    if (!o) continue
    const reqSame =
      JSON.stringify([...(o.requiredCertifications || [])].sort()) ===
      JSON.stringify([...(lane.requiredCertifications || [])].sort())
    if (!reqSame) continue
    if (
      o.name !== lane.name ||
      o.staffingStandard !== lane.staffingStandard ||
      o.intensity !== lane.intensity ||
      Boolean(o.afternoonHandoff) !== Boolean(lane.afternoonHandoff)
    ) {
      metaLaneChanges += 1
    }
  }
  if (metaLaneChanges) parts.push(`עודכנו פרטי ${metaLaneChanges} נתיבים`)

  const pc = prev?.certificationsCatalog ?? []
  const nc = next?.certificationsCatalog ?? []
  if (JSON.stringify(pc) !== JSON.stringify(nc)) {
    parts.push(`קטלוג הסמכות ${pc.length}→${nc.length}`)
  }

  return parts.join(' · ')
}
