import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDb, operationalDbTargets, recordSystemError, jobs } = vi.hoisted(() => ({
  getDb: vi.fn(),
  operationalDbTargets: vi.fn(),
  recordSystemError: vi.fn(),
  jobs: [],
}))

vi.mock('./db.js', () => ({ getDb, operationalDbTargets }))
vi.mock('./systemErrors.js', () => ({ recordSystemError }))

function matches(job, filter) {
  if (filter._id && job._id !== filter._id) return false
  if (typeof filter.status === 'string' && job.status !== filter.status) return false
  if (filter.status?.$in && !filter.status.$in.includes(job.status)) return false
  if (filter.nextAttemptAt?.$lte && job.nextAttemptAt > filter.nextAttemptAt.$lte) {
    return false
  }
  if (filter.lockedAt?.$lte && job.lockedAt > filter.lockedAt.$lte) return false
  if (filter.lockId && job.lockId !== filter.lockId) return false
  return true
}

const collection = {
  find: vi.fn(() => ({
    sort() {
      return this
    },
    limit() {
      return this
    },
    toArray: async () =>
      jobs.filter(
        (job) =>
          (['pending', 'retry'].includes(job.status) && job.nextAttemptAt <= new Date()) ||
          (job.status === 'processing' &&
            job.lockedAt <= new Date(Date.now() - 5 * 60_000)),
      ).map((job) => ({ ...job })),
  })),
  updateOne: vi.fn(async (filter, update) => {
    let job = jobs.find((entry) => entry._id === filter._id)
    if (!job && update.$setOnInsert) {
      job = { ...update.$setOnInsert }
      jobs.push(job)
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
    }
    if (!job || !matches(job, filter)) {
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    }
    Object.assign(job, update.$set)
    Object.assign(job, update.$setOnInsert)
    for (const [field, amount] of Object.entries(update.$inc || {})) {
      job[field] = Number(job[field] || 0) + amount
    }
    for (const field of Object.keys(update.$unset || {})) delete job[field]
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
  }),
}

describe('durable background jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobs.splice(0)
    operationalDbTargets.mockReturnValue(['selectors'])
    getDb.mockResolvedValue({ collection: () => collection })
  })

  it('enqueues a job idempotently', async () => {
    const { enqueueBackgroundJob } = await import('./backgroundJobs.js')
    const db = { collection: () => collection }
    const job = { id: 'shift-1:payroll', type: 'shift.payroll', scope: { orgId: 'org-1' } }

    await enqueueBackgroundJob(db, null, job)
    await enqueueBackgroundJob(db, null, job)

    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      _id: 'shift-1:payroll',
      type: 'shift.payroll',
      status: 'pending',
    })
  })

  it('claims a due job once and schedules a failed job for retry', async () => {
    jobs.push({
      _id: 'unknown-job',
      type: 'unknown',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1_000),
      createdAt: new Date(Date.now() - 1_000),
    })
    const { processBackgroundJobs } = await import('./backgroundJobs.js')

    expect(await processBackgroundJobs()).toBe(0)
    expect(jobs[0].status).toBe('retry')
    expect(jobs[0].attempts).toBe(1)
    expect(jobs[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
    expect(jobs[0].lastError).toContain('Unknown background job type')
  })

  it('moves repeatedly failing jobs to dead-letter and records an error', async () => {
    jobs.push({
      _id: 'unknown-job',
      type: 'unknown',
      status: 'pending',
      attempts: 7,
      nextAttemptAt: new Date(Date.now() - 1_000),
      createdAt: new Date(Date.now() - 1_000),
    })
    const { processBackgroundJobs } = await import('./backgroundJobs.js')

    await processBackgroundJobs()

    expect(jobs[0].status).toBe('dead')
    expect(jobs[0].attempts).toBe(8)
    expect(recordSystemError).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'background_job' }),
    )
  })

  it('does not start a parallel processor in the same runtime', async () => {
    let release
    getDb.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ collection: () => collection })
      }),
    )
    const { processBackgroundJobs } = await import('./backgroundJobs.js')
    const first = processBackgroundJobs()

    await expect(processBackgroundJobs()).resolves.toBe(0)
    release()
    await expect(first).resolves.toBe(0)
  })
})
