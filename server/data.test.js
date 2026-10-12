import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  buckets,
  operations,
  getDb,
  getMetaCollection,
  getStateCollection,
} = vi.hoisted(() => {
  const buckets = new Map()
  const operations = new Map()

  function key(target, name) {
    return `${target}:${name}`
  }

  function rows(target, name) {
    const id = key(target, name)
    if (!buckets.has(id)) buckets.set(id, [])
    if (!operations.has(id)) operations.set(id, [])
    return buckets.get(id)
  }

  function matches(doc, filter = {}) {
    return Object.entries(filter).every(([field, expected]) => {
      const actual = doc[field]
      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if ('$exists' in expected) return (field in doc) === expected.$exists
        if ('$nin' in expected) return !expected.$nin.includes(actual)
        if ('$gte' in expected && !(actual >= expected.$gte)) return false
        if ('$lte' in expected && !(actual <= expected.$lte)) return false
        return true
      }
      return actual === expected
    })
  }

  function collection(target, name) {
    const list = rows(target, name)
    const log = operations.get(key(target, name))
    return {
      findOne: async (filter) => list.find((item) => matches(item, filter)) || null,
      find(filter = {}) {
        log.push(['find', filter])
        let selected = list.filter((item) => matches(item, filter))
        const cursor = {
          sort(order) {
            const [[field, direction]] = Object.entries(order)
            selected = [...selected].sort((a, b) =>
              a[field] === b[field] ? 0 : (a[field] > b[field] ? 1 : -1) * direction,
            )
            return cursor
          },
          skip(count) {
            selected = selected.slice(count)
            return cursor
          },
          limit(count) {
            selected = selected.slice(0, count)
            return cursor
          },
          project() {
            return cursor
          },
          toArray: async () => [...selected],
        }
        return cursor
      },
      countDocuments: async (filter = {}) => {
        log.push(['countDocuments', filter])
        return list.filter((item) => matches(item, filter)).length
      },
      deleteMany: async (filter = {}) => {
        log.push(['deleteMany', filter])
        const remaining = list.filter((item) => !matches(item, filter))
        list.splice(0, list.length, ...remaining)
        return { deletedCount: list.length - remaining.length }
      },
      deleteOne: async (filter) => {
        log.push(['deleteOne', filter])
        const index = list.findIndex((item) => matches(item, filter))
        if (index >= 0) list.splice(index, 1)
        return { deletedCount: index >= 0 ? 1 : 0 }
      },
      bulkWrite: async (writes) => {
        log.push(['bulkWrite', writes])
        for (const { replaceOne } of writes) {
          const index = list.findIndex((item) => matches(item, replaceOne.filter))
          if (index >= 0) list[index] = replaceOne.replacement
          else if (replaceOne.upsert) list.push(replaceOne.replacement)
        }
        return { acknowledged: true }
      },
      updateOne: async (filter, update, options = {}) => {
        log.push(['updateOne', filter, update])
        let doc = list.find((item) => matches(item, filter))
        const inserted = !doc
        if (!doc && options.upsert) {
          doc = { ...filter }
          list.push(doc)
        }
        if (!doc) return { matchedCount: 0, modifiedCount: 0 }
        Object.assign(doc, update.$set || {})
        if (inserted) Object.assign(doc, update.$setOnInsert || {})
        if (update.$inc) {
          for (const [field, amount] of Object.entries(update.$inc)) {
            doc[field] = Number(doc[field] || 0) + amount
          }
        }
        return { matchedCount: inserted ? 0 : 1, modifiedCount: 1, upsertedCount: inserted ? 1 : 0 }
      },
      insertMany: async (docs) => {
        list.push(...docs)
        return { insertedCount: docs.length }
      },
    }
  }

  function database(target) {
    return { collection: (name) => collection(target, name) }
  }

  return {
    buckets,
    getDb: vi.fn(async (target = 'selectors') => database(target)),
    getMetaCollection: vi.fn(async (target = 'selectors') => collection(target, 'app_meta')),
    getStateCollection: vi.fn(async (target = 'selectors') => collection(target, 'app_state')),
    operations,
    rows,
  }
})

vi.mock('./db.js', () => ({
  getDb,
  getMetaCollection,
  getStateCollection,
  getAuditCollection: vi.fn(),
  withDbTransaction: (callback) => callback(undefined),
}))
vi.mock('./audit.js', () => ({
  appendAuditLog: vi.fn(async () => {}),
  diffAppDataAuditEvents: vi.fn(() => []),
  shiftAuditHeader: vi.fn(() => 'shift'),
  summarizeAssignmentChanges: vi.fn(() => ''),
}))
vi.mock('./orgs.js', () => ({
  authenticateManager: vi.fn(),
  createLegacyOrganization: vi.fn(),
  disableWorkerAccount: vi.fn(),
  requestAccountPasswordReset: vi.fn(),
  upsertManagerAccount: vi.fn(),
}))
vi.mock('./mail.js', () => ({ sendTempPasswordEmail: vi.fn() }))
vi.mock('./password.js', () => ({
  generateTempPassword: vi.fn(() => 'temporary'),
  hashPassword: vi.fn(async () => 'hash'),
}))
vi.mock('./selfHeal.js', () => ({ validateSelfHeal: vi.fn(() => null) }))

import { readState, upsertShift, writeState } from './data.js'

const scope = { orgId: 'test-org', module: 'selectors' }
const metaId = `${scope.orgId}:${scope.module}`
const worker = {
  id: 'worker-1',
  fullName: 'Worker',
  phone: '1234567890',
  isManager: false,
  isInspector: true,
  staffKind: 'selector',
}

function seedState({ revision = 1, historyRevision = revision, shifts = [] } = {}) {
  buckets.clear()
  const meta = buckets.get('selectors:app_meta') || []
  buckets.set('selectors:app_meta', [
    { _id: 'tenancy-v1', done: true },
    { _id: metaId, schema: 'collections', revision, historyRevision },
  ])
  for (const [name, docs] of [
    ['workers', [worker].map((item) => ({ ...item, _id: `${metaId}:${item.id}`, orgId: scope.orgId, module: scope.module }))],
    ['lanes', []],
    ['shifts', shifts.map((item, listOrder) => ({ ...item, _id: `${metaId}:${item.id}`, orgId: scope.orgId, module: scope.module, listOrder }))],
    ['certifications', []],
    ['briefing_sections', []],
    ['questions', []],
    ['customs_brokers', []],
    ['shift_models', []],
  ]) {
    buckets.set(`selectors:${name}`, docs)
  }
}

describe('state and shift persistence', () => {
  beforeEach(() => {
    buckets.clear()
    operations.clear()
    seedState()
  })

  it('does not rewrite or reload history when a non-history snapshot is saved', async () => {
    const previous = await readState(scope)
    const historyReads = operations.get('selectors:shifts').filter(([op]) =>
      op === 'find' || op === 'countDocuments',
    ).length
    const shifts = buckets.get('selectors:shifts')
    const shiftCount = shifts.length
    const result = await writeState(
      { ...previous, workers: [{ ...worker, fullName: 'Updated' }] },
      {
        scope,
        expectedRevision: previous.revision,
        skipAudit: true,
        skipManagerInvites: true,
      },
    )
    const updated = await readState(scope)

    expect(result.workers[0].fullName).toBe('Updated')
    expect(updated.history).toEqual(previous.history)
    expect(
      operations.get('selectors:shifts').filter(([op]) =>
        op === 'find' || op === 'countDocuments',
      ),
    ).toHaveLength(historyReads)
    expect(shifts).toHaveLength(shiftCount)
    expect(buckets.get('selectors:app_meta').find((item) => item._id === metaId)).toMatchObject({
      revision: 2,
      historyRevision: 1,
    })
  })

  it('rejects a stale full-state write before changing stored models', async () => {
    const previous = await readState(scope)

    await expect(
      writeState(
        { ...previous, workers: [{ ...worker, fullName: 'Stale edit' }] },
        { scope, expectedRevision: 0, skipAudit: true, skipManagerInvites: true },
      ),
    ).rejects.toMatchObject({ status: 409, current: expect.any(Object) })
    expect(buckets.get('selectors:workers')[0].fullName).toBe('Worker')
  })

  it('loads algorithm history in bounded pages without truncating the result', async () => {
    seedState({
      revision: 10,
      historyRevision: 10,
      shifts: Array.from({ length: 130 }, (_, index) => ({
        id: `shift-${index}`,
        date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
        shiftType: 'morning',
      })),
    })

    const state = await readState(scope)
    const pageReads = operations.get('selectors:shifts').filter(([op]) => op === 'find')

    expect(state.history).toHaveLength(130)
    expect(pageReads).toHaveLength(3)
  })

  it('upserts a shift and advances both revisions', async () => {
    const saved = await upsertShift(
      'shift-1',
      {
        date: '2026-10-12',
        shiftType: 'morning',
        assignmentMode: 'single',
        assignments: [],
      },
      { id: 'manager-1', fullName: 'Manager' },
      { scope },
    )

    expect(saved.history).toHaveLength(1)
    expect(saved.history[0]).toMatchObject({ id: 'shift-1', date: '2026-10-12' })
    expect(buckets.get('selectors:shifts')[0]._id).toBe(`${metaId}:shift-1`)
    expect(buckets.get('selectors:app_meta').find((item) => item._id === metaId)).toMatchObject({
      revision: 2,
      historyRevision: 2,
    })
  })

  it('refuses to modify an already signed-off shift', async () => {
    seedState({
      revision: 3,
      historyRevision: 3,
      shifts: [{
        id: 'shift-locked',
        date: '2026-10-12',
        shiftType: 'morning',
        signOff: { signedAt: '2026-10-12T12:00:00.000Z', signerName: 'Manager' },
      }],
    })

    await expect(
      upsertShift(
        'shift-locked',
        { date: '2026-10-12', shiftType: 'morning', assignmentMode: 'single' },
        { id: 'manager-1', fullName: 'Manager' },
        { scope },
      ),
    ).rejects.toMatchObject({ status: 409 })
  })
})
