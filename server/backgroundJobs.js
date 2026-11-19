import { randomUUID } from 'node:crypto'
import { getDb, operationalDbTargets } from './db.js'
import { recordSystemError } from './systemErrors.js'

const MAX_ATTEMPTS = 8
const LOCK_TIMEOUT_MS = 5 * 60_000
const BATCH_SIZE = 20
const RETRY_BASE_MS = 5_000
const RETRY_MAX_MS = 60 * 60_000
const PROCESS_INTERVAL_MS = 15_000
const JOB_COLLECTION = 'background_jobs'

let localTimer
let processing = false

export async function enqueueBackgroundJob(db, session, job) {
  const now = new Date()
  await db.collection(JOB_COLLECTION).updateOne(
    { _id: String(job.id) },
    {
      $setOnInsert: {
        _id: String(job.id),
        type: String(job.type),
        scope: job.scope || null,
        payload: job.payload || {},
        status: 'pending',
        attempts: 0,
        createdAt: now,
        nextAttemptAt: now,
      },
    },
    { upsert: true, ...(session ? { session } : {}) },
  )
}

function jobCollection(db) {
  return db.collection(JOB_COLLECTION)
}

async function runJob(job) {
  if (job.type === 'shift.audit') {
    const { appendAuditLog } = await import('./audit.js')
    return appendAuditLog({ ...job.payload, id: job._id })
  }
  if (job.type === 'shift.assignment-notice') {
    const { notifyWorkersOfAssignmentChanges } = await import('./workerAlerts.js')
    const { readState } = await import('./data.js')
    const state = await readState(job.scope)
    const next = state.history.find((shift) => shift.id === job.payload.shiftId)
    if (!next) return
    return notifyWorkersOfAssignmentChanges({
      previous: job.payload.previous,
      next,
      scope: job.scope,
      actor: job.payload.actor,
      lanes: state.lanes,
      models: state.shiftModels,
    })
  }
  if (job.type === 'shift.payroll') {
    const { readState } = await import('./data.js')
    const { createPayEntriesForCompletedShifts } = await import('./workerPay.js')
    const state = await readState(job.scope)
    return createPayEntriesForCompletedShifts(
      state.history,
      state.workerWindowPresets,
      state.shiftModels,
      job.scope,
      state.workers,
    )
  }
  throw new Error(`Unknown background job type: ${job.type}`)
}

async function processTarget(target, limit) {
  const db = await getDb(target)
  const col = jobCollection(db)
  const now = new Date()
  const expiredLock = new Date(now.getTime() - LOCK_TIMEOUT_MS)
  const jobs = await col
    .find({
      $or: [
        { status: { $in: ['pending', 'retry'] }, nextAttemptAt: { $lte: now } },
        { status: 'processing', lockedAt: { $lte: expiredLock } },
      ],
    })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray()
  let processed = 0

  for (const job of jobs) {
    const lockId = randomUUID()
    const condition =
      job.status === 'processing'
        ? { status: 'processing', lockedAt: job.lockedAt }
        : { status: job.status, nextAttemptAt: { $lte: now } }
    const claim = await col.updateOne(
      { _id: job._id, ...condition },
      {
        $set: { status: 'processing', lockedAt: now, lockId },
        $inc: { attempts: 1 },
      },
    )
    if (!claim.modifiedCount) continue

    const attempts = Number(job.attempts || 0) + 1
    try {
      await runJob(job)
      await col.updateOne(
        { _id: job._id, status: 'processing', lockId },
        {
          $set: { status: 'completed', completedAt: new Date() },
          $unset: { lockedAt: '', lockId: '', lastError: '' },
        },
      )
      processed += 1
    } catch (error) {
      const dead = attempts >= MAX_ATTEMPTS
      const delay = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS)
      const message = String(error?.message || error).slice(0, 1000)
      await col.updateOne(
        { _id: job._id, status: 'processing', lockId },
        {
          $set: {
            status: dead ? 'dead' : 'retry',
            lastError: message,
            ...(dead
              ? { failedAt: new Date() }
              : { nextAttemptAt: new Date(Date.now() + delay) }),
          },
          $unset: { lockedAt: '', lockId: '' },
        },
      )
      console.error(`[background-jobs] ${job.type} failed (${attempts}/${MAX_ATTEMPTS})`, message)
      if (dead) {
        await recordSystemError({
          source: 'background_job',
          error: new Error(`משימת רקע נכשלה לאחר ${attempts} ניסיונות: ${message}`),
          status: 500,
          path: `job:${job.type}`,
          method: 'WORKER',
          orgId: job.scope?.orgId,
          module: job.scope?.module,
        })
      }
    }
  }
  return processed
}

export async function processBackgroundJobs({ limit = BATCH_SIZE } = {}) {
  if (processing) return 0
  processing = true
  try {
    let processed = 0
    for (const target of operationalDbTargets()) {
      processed += await processTarget(target, limit)
    }
    return processed
  } finally {
    processing = false
  }
}

export function kickBackgroundJobProcessor() {
  const pending = processBackgroundJobs().catch((error) => {
    console.error('[background-jobs] processing pass failed', error?.message || error)
  })
  if (process.env.VERCEL) {
    import('@vercel/functions')
      .then(({ waitUntil }) => waitUntil(pending))
      .catch((error) => {
        console.error('[background-jobs] could not register worker', error?.message || error)
      })
  }
}

export function scheduleLocalBackgroundJobProcessor() {
  if (process.env.VERCEL || localTimer) return
  localTimer = setInterval(() => {
    void processBackgroundJobs().catch((error) => {
      console.error('[background-jobs] scheduled pass failed', error?.message || error)
    })
  }, PROCESS_INTERVAL_MS)
  localTimer.unref?.()
}
