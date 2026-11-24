import { getDb } from './db.js'

/** Soft TTL — holder must heartbeat; after this the slot is free. */
export const SHIFT_EDIT_LOCK_TTL_MS = 45_000

export function shiftEditLockId(orgId, module, date, shiftType, audience) {
  const aud = audience === 'selector' ? 'selector' : 'inspector'
  return `${orgId}:${module}:${date}:${shiftType}:${aud}`
}

function lockCollection() {
  return getDb().then((db) => db.collection('shift_edit_locks'))
}

function publicHolder(row) {
  if (!row) return null
  return {
    userId: String(row.userId || ''),
    name: String(row.name || 'מנהל'),
    shiftId: row.shiftId ? String(row.shiftId) : undefined,
    at: row.at instanceof Date ? row.at.toISOString() : String(row.at || ''),
  }
}

function isActive(row, now = Date.now()) {
  if (!row?.at) return false
  const at = row.at instanceof Date ? row.at.getTime() : Date.parse(String(row.at))
  if (!Number.isFinite(at)) return false
  return now - at < SHIFT_EDIT_LOCK_TTL_MS
}

/**
 * Acquire or refresh an edit lock for a shift slot.
 * Same user may re-acquire; another active holder → 409-style result.
 */
export async function acquireShiftEditLock({
  orgId,
  module,
  date,
  shiftType,
  audience,
  userId,
  name,
  shiftId,
}) {
  const id = shiftEditLockId(orgId, module, date, shiftType, audience)
  const col = await lockCollection()
  const now = new Date()
  const existing = await col.findOne({ _id: id })
  if (
    existing &&
    String(existing.userId) !== String(userId) &&
    isActive(existing, now.getTime())
  ) {
    return {
      ok: false,
      status: 409,
      error: `${publicHolder(existing)?.name || 'מנהל אחר'} עורך כרגע את המשמרת הזו`,
      holder: publicHolder(existing),
    }
  }
  await col.updateOne(
    { _id: id },
    {
      $set: {
        orgId,
        module,
        date,
        shiftType,
        audience: audience === 'selector' ? 'selector' : 'inspector',
        userId: String(userId),
        name: String(name || 'מנהל'),
        shiftId: shiftId ? String(shiftId) : null,
        at: now,
      },
    },
    { upsert: true },
  )
  const row = await col.findOne({ _id: id })
  return { ok: true, holder: publicHolder(row) }
}

export async function heartbeatShiftEditLock({
  orgId,
  module,
  date,
  shiftType,
  audience,
  userId,
  shiftId,
}) {
  const id = shiftEditLockId(orgId, module, date, shiftType, audience)
  const col = await lockCollection()
  const existing = await col.findOne({ _id: id })
  if (!existing || String(existing.userId) !== String(userId)) {
    return {
      ok: false,
      status: 409,
      error: 'הנעילה אינה שייכת למשתמש הזה',
      holder: publicHolder(existing && isActive(existing) ? existing : null),
    }
  }
  const now = new Date()
  await col.updateOne(
    { _id: id, userId: String(userId) },
    {
      $set: {
        at: now,
        ...(shiftId ? { shiftId: String(shiftId) } : {}),
      },
    },
  )
  return { ok: true, holder: publicHolder({ ...existing, at: now, userId }) }
}

export async function releaseShiftEditLock({
  orgId,
  module,
  date,
  shiftType,
  audience,
  userId,
}) {
  const id = shiftEditLockId(orgId, module, date, shiftType, audience)
  const col = await lockCollection()
  await col.deleteOne({ _id: id, userId: String(userId) })
  return { ok: true }
}

export async function readShiftEditLock({
  orgId,
  module,
  date,
  shiftType,
  audience,
}) {
  const id = shiftEditLockId(orgId, module, date, shiftType, audience)
  const col = await lockCollection()
  const existing = await col.findOne({ _id: id })
  if (!existing || !isActive(existing)) {
    return { locked: false, holder: null }
  }
  return { locked: true, holder: publicHolder(existing) }
}

/**
 * Block saves/mutations when a *different* manager currently holds the edit lock.
 * Any manager may edit when the slot is free; only parallel edits are refused.
 */
export async function assertNoForeignEditLock({
  orgId,
  module,
  date,
  shiftType,
  audience,
  userId,
}) {
  if (!orgId || !module || !date || !shiftType || !userId) return
  const status = await readShiftEditLock({
    orgId,
    module,
    date,
    shiftType,
    audience,
  })
  if (!status.locked || !status.holder) return
  if (String(status.holder.userId) === String(userId)) return
  const err = new Error(
    `${status.holder.name || 'מנהל אחר'} עורך כרגע את המשמרת הזו — לא ניתן לשנות במקביל`,
  )
  err.status = 409
  err.holder = status.holder
  throw err
}
