import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  buckets,
  operations,
  getDb,
  getMetaCollection,
  getStateCollection,
  createPayEntriesForCompletedShifts,
  appendAuditLog,
  waitUntil,
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
    createPayEntriesForCompletedShifts: vi.fn(async () => {}),
    appendAuditLog: vi.fn(async () => {}),
    waitUntil: vi.fn(),
  }
})

vi.mock('@vercel/functions', () => ({ waitUntil }))
vi.mock('./db.js', () => ({
  getDb,
  getMetaCollection,
  getStateCollection,
  getAuditCollection: vi.fn(),
  operationalDbTargets: () => ['selectors', 'inspectors', 'security'],
  withDbTransaction: (callback) => callback(undefined),
}))
vi.mock('./audit.js', () => ({
  appendAuditLog,
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
vi.mock('./workerPay.js', () => ({ createPayEntriesForCompletedShifts }))

import {
  deleteShift,
  readState,
  saveWorkerWindowPresetCollection,
  signOffShiftsBulk,
  upsertShift,
  writeState,
} from './data.js'

let scope
let metaId
let scopeSequence = 0
const worker = {
  id: 'worker-1',
  fullName: 'Worker',
  phone: '1234567890',
  isManager: false,
  isInspector: true,
  staffKind: 'selector',
}

function seedState({
  revision = 1,
  historyRevision = revision,
  shifts = [],
  workers = [worker],
  shiftModels = [],
  workerWindowPresets = [],
} = {}) {
  const target = scope.module
  buckets.clear()
  const meta = buckets.get(`${target}:app_meta`) || []
  buckets.set(`${target}:app_meta`, [
    { _id: 'tenancy-v1', done: true },
    { _id: metaId, schema: 'collections', revision, historyRevision },
  ])
  for (const [name, docs] of [
    ['workers', workers.map((item) => ({ ...item, _id: `${metaId}:${item.id}`, orgId: scope.orgId, module: scope.module }))],
    ['lanes', []],
    ['shifts', shifts.map((item, listOrder) => ({ ...item, _id: `${metaId}:${item.id}`, orgId: scope.orgId, module: scope.module, listOrder }))],
    ['certifications', []],
    ['briefing_sections', []],
    ['questions', []],
    ['customs_brokers', []],
    ['shift_models', shiftModels.map((item, order) => ({ ...item, _id: `${metaId}:${item.id}`, orgId: scope.orgId, module: scope.module, order: item.order ?? order }))],
    ['worker_window_presets', workerWindowPresets.map((item, order) => ({ ...item, _id: `${metaId}:${item.id}`, orgId: scope.orgId, module: scope.module, order: item.order ?? order }))],
    ['incidents', []],
  ]) {
    buckets.set(`${target}:${name}`, docs)
  }
}

describe('state and shift persistence', () => {
  beforeEach(() => {
    buckets.clear()
    operations.clear()
    vi.clearAllMocks()
    scope = { orgId: `test-org-${scopeSequence++}`, module: 'selectors' }
    metaId = `${scope.orgId}:${scope.module}`
    seedState()
  })

  it('persists open events and faults into the incidents collection', async () => {
    const previous = await readState(scope)
    const incidents = [
      {
        id: 'event-1',
        kind: 'event',
        title: 'אירוע תפעולי',
        description: 'תיאור האירוע',
        severity: 'medium',
        status: 'open',
        createdAt: '2026-10-29T10:00:00.000Z',
        createdBy: 'מנהל',
        updatedAt: '2026-10-29T10:00:00.000Z',
        updatedBy: 'מנהל',
      },
      {
        id: 'fault-1',
        kind: 'fault',
        title: 'תקלה בשער',
        description: 'השער לא נפתח',
        severity: 'high',
        status: 'open',
        laneId: 'lane-1',
        handlingNotes: 'הוזמן טכנאי',
        createdAt: '2026-10-29T11:00:00.000Z',
        createdBy: 'מנהל',
        updatedAt: '2026-10-29T11:00:00.000Z',
        updatedBy: 'מנהל',
      },
    ]

    const result = await writeState(
      { ...previous, incidents },
      {
        scope,
        expectedRevision: previous.revision,
        skipAudit: true,
        skipManagerInvites: true,
      },
    )
    const reloaded = await readState(scope)
    const stored = buckets.get('selectors:incidents')

    expect(result.incidents).toHaveLength(2)
    expect(reloaded.incidents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'event-1',
          kind: 'event',
          title: 'אירוע תפעולי',
          status: 'open',
        }),
        expect.objectContaining({
          id: 'fault-1',
          kind: 'fault',
          title: 'תקלה בשער',
          severity: 'high',
          laneId: 'lane-1',
          handlingNotes: 'הוזמן טכנאי',
          status: 'open',
        }),
      ]),
    )
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'event-1',
          kind: 'event',
          orgId: scope.orgId,
          module: scope.module,
        }),
        expect.objectContaining({
          id: 'fault-1',
          kind: 'fault',
          orgId: scope.orgId,
          module: scope.module,
        }),
      ]),
    )
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
    expect(saved.history[0]).toMatchObject({
      id: 'shift-1',
      date: '2026-10-12',
      editCount: 0,
    })

    const updated = await upsertShift(
      'shift-1',
      {
        date: '2026-10-12',
        shiftType: 'morning',
        assignmentMode: 'single',
        activeLaneIds: [],
        presentWorkerIds: ['w1'],
        assignments: [],
      },
      { id: 'manager-1', fullName: 'Manager' },
      { scope },
    )
    expect(updated.history[0]?.editCount).toBe(1)
    expect(buckets.get('selectors:shifts')[0]._id).toBe(`${metaId}:shift-1`)
    expect(buckets.get('selectors:app_meta').find((item) => item._id === metaId)).toMatchObject({
      revision: 3,
      historyRevision: 3,
    })
  })

  it('records assignment history with server actor/time and preserves it on later saves', async () => {
    const effectiveAt = new Date(Date.now() - 60_000).toISOString()
    const saved = await upsertShift(
      'shift-with-operation',
      {
        date: '2026-10-12',
        shiftType: 'morning',
        assignmentMode: 'single',
        assignments: [],
        shiftOperationEvents: [
          {
            id: 'operation-1',
            kind: 'worker_moved',
            workerId: 'worker-1',
            workerName: 'דני',
            fromLaneId: 'lane-1',
            fromLaneName: 'עמדה 1',
            toLaneId: 'lane-2',
            toLaneName: 'עמדה 2',
            effectiveAt,
            recordedAt: 'spoofed-time',
            actorId: 'spoofed-actor',
            actorName: 'Spoofed',
          },
        ],
      },
      { id: 'manager-1', fullName: 'Manager' },
      { scope },
    )

    expect(saved.history[0].shiftOperationEvents).toHaveLength(1)
    expect(saved.history[0].shiftOperationEvents[0]).toMatchObject({
      id: 'operation-1',
      kind: 'worker_moved',
      workerId: 'worker-1',
      workerName: 'דני',
      effectiveAt,
      actorId: 'manager-1',
      actorName: 'Manager',
      fromLaneName: 'עמדה 1',
      toLaneName: 'עמדה 2',
    })
    expect(saved.history[0].shiftOperationEvents[0].recordedAt).not.toBe(
      'spoofed-time',
    )

    const updated = await upsertShift(
      'shift-with-operation',
      {
        date: '2026-10-12',
        shiftType: 'morning',
        assignmentMode: 'single',
        assignments: [],
        shiftOperationEvents: [],
      },
      { id: 'manager-1', fullName: 'Manager' },
      { scope },
    )
    expect(updated.history[0].shiftOperationEvents).toEqual(
      saved.history[0].shiftOperationEvents,
    )
  })

  it('records assignment history when the effective time is unknown', async () => {
    const saved = await upsertShift(
      'shift-with-unknown-operation-time',
      {
        date: '2026-10-12',
        shiftType: 'morning',
        assignmentMode: 'single',
        assignments: [],
        shiftOperationEvents: [
          {
            id: 'operation-unknown-time',
            kind: 'worker_moved',
            workerId: 'worker-1',
            workerName: 'דני',
            effectiveAt: null,
          },
        ],
      },
      { id: 'manager-1', fullName: 'Manager' },
      { scope },
    )

    expect(saved.history[0].shiftOperationEvents).toHaveLength(1)
    expect(saved.history[0].shiftOperationEvents[0]).toMatchObject({
      effectiveAt: null,
      actorId: 'manager-1',
      actorName: 'Manager',
    })
    expect(saved.history[0].shiftOperationEvents[0].recordedAt).toBeTruthy()
  })

  it('rejects future-dated assignment events', async () => {
    await expect(
      upsertShift(
        'future-operation',
        {
          date: '2026-10-12',
          shiftType: 'morning',
          assignmentMode: 'single',
          assignments: [],
          shiftOperationEvents: [
            {
              id: 'future-event',
              kind: 'worker_assigned',
              workerId: 'worker-1',
              workerName: 'דני',
              effectiveAt: new Date(Date.now() + 60_000).toISOString(),
            },
          ],
        },
        { id: 'manager-1', fullName: 'Manager' },
        { scope },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('compact upsert returns only revision + shift', async () => {
    const saved = await upsertShift(
      'shift-compact',
      {
        date: '2026-10-13',
        shiftType: 'morning',
        assignmentMode: 'single',
        assignments: [],
      },
      { id: 'manager-1', fullName: 'Manager' },
      { scope, compact: true },
    )

    expect(saved.history).toBeUndefined()
    expect(saved).toMatchObject({
      revision: expect.any(Number),
      shift: {
        id: 'shift-compact',
        date: '2026-10-13',
        shiftType: 'morning',
      },
    })
  })

  it('updates personal hours on an already-created continuing inspector shift', async () => {
    scope = { orgId: `test-org-${scopeSequence++}`, module: 'inspectors' }
    metaId = `${scope.orgId}:${scope.module}`
    const inspector = {
      id: 'worker-1',
      fullName: 'Inspector',
      phone: '1234567890',
      isManager: false,
      isInspector: true,
      staffKind: 'inspector',
    }
    const morning = {
      id: 'morning-shift',
      date: '2026-11-18',
      shiftType: 'morning',
      audience: 'inspector',
      assignmentMode: 'single',
      activeLaneIds: ['lane-1'],
      presentWorkerIds: ['worker-1'],
      workerWindows: { 'worker-1': '0600-1500' },
      assignments: [{ laneId: 'lane-1', workerIds: ['worker-1'] }],
      createdAt: '2026-11-18T06:00:00.000Z',
      updatedAt: '2026-11-18T06:00:00.000Z',
    }
    const afternoon = {
      id: 'afternoon-shift',
      date: '2026-11-18',
      shiftType: 'afternoon',
      audience: 'inspector',
      assignmentMode: 'single',
      activeLaneIds: ['lane-1'],
      presentWorkerIds: ['worker-1'],
      workerWindows: { 'worker-1': '0600-1500' },
      assignments: [{ laneId: 'lane-1', workerIds: ['worker-1'] }],
      createdAt: '2026-11-18T14:30:00.000Z',
      updatedAt: '2026-11-18T14:30:00.000Z',
    }
    seedState({
      shifts: [morning, afternoon],
      workers: [inspector],
      shiftModels: [
        { id: 'morning', startMinutes: 360, endMinutes: 870, order: 0 },
        { id: 'afternoon', startMinutes: 870, endMinutes: 1290, order: 1 },
      ],
      workerWindowPresets: [
        { id: '0600-1500', label: 'בוקר', start: 360, end: 870 },
        { id: '0600-1830', label: 'משמרת ארוכה', start: 360, end: 1110 },
      ],
    })

    const result = await upsertShift(
      'morning-shift',
      {
        ...morning,
        workerWindows: { 'worker-1': '0600-1830' },
        updatedAt: '2026-11-18T13:00:00.000Z',
      },
      { id: 'manager-1', fullName: 'Manager' },
      { scope, compact: true },
    )

    expect(result.updatedShifts).toMatchObject([
      {
        id: 'afternoon-shift',
        presentWorkerIds: ['worker-1'],
        workerWindows: { 'worker-1': '0600-1830' },
      },
    ])
    expect(
      buckets.get('inspectors:shifts').find((item) => item._id.endsWith('afternoon-shift')),
    ).toMatchObject({
      workerWindows: { 'worker-1': '0600-1830' },
    })
  })

  it('runs payroll completion after a single-shift close', async () => {
    scope = { orgId: `test-org-${scopeSequence++}`, module: 'inspectors' }
    metaId = `${scope.orgId}:${scope.module}`
    const inspector = {
      id: 'worker-1',
      fullName: 'Inspector',
      phone: '1234567890',
      isManager: false,
      isInspector: true,
      staffKind: 'inspector',
    }
    seedState({ workers: [inspector] })

    await upsertShift(
      'closed-shift',
      {
        date: '2026-11-18',
        shiftType: 'morning',
        audience: 'inspector',
        assignmentMode: 'single',
        activeLaneIds: [],
        presentWorkerIds: ['worker-1'],
        assignments: [],
        signOff: { signature: 'Manager' },
      },
      { id: 'manager-1', fullName: 'Manager' },
      { scope, compact: true },
    )

    expect(createPayEntriesForCompletedShifts).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'closed-shift', signOff: expect.any(Object) })],
      [],
      [],
      scope,
      expect.arrayContaining([
        expect.objectContaining({ id: inspector.id, staffKind: 'inspector' }),
      ]),
    )
  })

  it('returns a saved shift without waiting for background payroll work', async () => {
    const previousVercel = process.env.VERCEL
    process.env.VERCEL = '1'
    scope = { orgId: `test-org-${scopeSequence++}`, module: 'inspectors' }
    metaId = `${scope.orgId}:${scope.module}`
    seedState()
    let finishPayroll
    createPayEntriesForCompletedShifts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPayroll = resolve
        }),
    )

    try {
      const result = await upsertShift(
        'shift-with-slow-payroll',
        {
          date: '2026-11-18',
          shiftType: 'morning',
          assignmentMode: 'single',
          activeLaneIds: [],
          presentWorkerIds: [],
          assignments: [],
        },
        { id: 'manager-1', fullName: 'Manager' },
        { scope, compact: true },
      )

      expect(result.shift.id).toBe('shift-with-slow-payroll')
      expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise))
      expect(createPayEntriesForCompletedShifts).toHaveBeenCalledOnce()
    } finally {
      finishPayroll?.()
      if (previousVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = previousVercel
    }
  })

  it('locks many open shifts in one revision bump', async () => {
    seedState({
      revision: 4,
      historyRevision: 4,
      shifts: [
        { id: 'shift-a', date: '2026-10-12', shiftType: 'morning' },
        { id: 'shift-b', date: '2026-10-12', shiftType: 'afternoon' },
        {
          id: 'shift-c',
          date: '2026-10-11',
          shiftType: 'night',
          signOff: {
            signedAt: '2026-10-11T12:00:00.000Z',
            signerName: 'Manager',
            signerId: 'manager-1',
            signature: 'Manager',
          },
        },
      ],
    })

    const result = await signOffShiftsBulk(
      ['shift-a', 'shift-b', 'shift-c', 'missing'],
      'Manager',
      { id: 'manager-1', fullName: 'Manager' },
      { scope, expectedRevision: 4 },
    )

    expect(result.locked).toBe(2)
    expect(result.data.revision).toBe(5)
    expect(result.data.history.find((shift) => shift.id === 'shift-a')?.signOff?.signerName).toBe(
      'Manager',
    )
    expect(result.data.history.find((shift) => shift.id === 'shift-b')?.signOff?.signature).toBe(
      'Manager',
    )
    expect(result.data.history.find((shift) => shift.id === 'shift-c')?.signOff?.signedAt).toBe(
      '2026-10-11T12:00:00.000Z',
    )
    expect(buckets.get('selectors:app_meta').find((item) => item._id === metaId)).toMatchObject({
      revision: 5,
      historyRevision: 5,
    })
  })

  it('returns success when audit logging fails after bulk sign-off is persisted', async () => {
    seedState({
      revision: 4,
      historyRevision: 4,
      shifts: [{ id: 'shift-a', date: '2026-10-12', shiftType: 'morning' }],
    })
    appendAuditLog.mockRejectedValueOnce(new Error('audit store unavailable'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const result = await signOffShiftsBulk(
        ['shift-a'],
        'Manager',
        { id: 'manager-1', fullName: 'Manager' },
        { scope, expectedRevision: 4 },
      )

      expect(result.locked).toBe(1)
      expect(result.data.history.find((shift) => shift.id === 'shift-a')?.signOff?.signerName)
        .toBe('Manager')
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to append bulk shift sign-off audit log:',
        expect.any(Error),
      )
    } finally {
      errorSpy.mockRestore()
    }
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

  it('deletes an unsigned shift and advances the revision', async () => {
    seedState({
      shifts: [{
        id: 'shift-delete',
        date: '2026-10-12',
        shiftType: 'morning',
      }],
    })

    const result = await deleteShift(
      'shift-delete',
      { id: 'manager-1', fullName: 'Manager' },
      { scope },
    )

    expect(result.history).toEqual([])
    expect(buckets.get('selectors:shifts')).toEqual([])
    expect(buckets.get('selectors:app_meta').find((item) => item._id === metaId)).toMatchObject({
      revision: 2,
      historyRevision: 2,
    })
  })

  it('refuses to delete a signed-off shift', async () => {
    seedState({
      shifts: [{
        id: 'shift-locked-delete',
        date: '2026-10-12',
        shiftType: 'morning',
        signOff: { signedAt: '2026-10-12T12:00:00.000Z', signerName: 'Manager' },
      }],
    })

    await expect(
      deleteShift(
        'shift-locked-delete',
        { id: 'manager-1', fullName: 'Manager' },
        { scope },
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect(buckets.get('selectors:shifts')).toHaveLength(1)
    expect(buckets.get('selectors:app_meta').find((item) => item._id === metaId).revision).toBe(1)
  })

  it('saves worker-hour presets through their dedicated collection writer', async () => {
    const saved = await saveWorkerWindowPresetCollection(
      [
        { start: 360, end: 900, name: 'בוקר', label: 'בוקר', order: 0 },
        { start: 870, end: 1290, name: 'צהריים', label: 'צהריים', order: 1 },
      ],
      { scope, expectedRevision: 1 },
    )

    expect(saved.revision).toBe(2)
    expect(saved.workerWindowPresets).toHaveLength(2)
    expect(saved.workerWindowPresets[0]).toMatchObject({
      id: '0600-1500',
      start: 360,
      end: 900,
      name: 'בוקר',
      label: 'בוקר',
    })
    expect(saved.workerWindowPresets[1]).toMatchObject({
      id: '1430-2130',
      start: 870,
      end: 1290,
      name: 'צהריים',
      label: 'צהריים',
    })

    const loaded = await readState(scope)
    expect(loaded.workerWindowPresets).toHaveLength(2)
    expect(loaded.workerWindowPresets[0].id).toBe('0600-1500')
    expect(loaded.workerWindowPresets[1].id).toBe('1430-2130')
  })

  it('does not let a full-state save erase worker-hour presets', async () => {
    const existing = [
      { id: '0600-1500', label: 'בוקר', start: 360, end: 900, order: 0 },
    ]
    seedState({ workerWindowPresets: existing })
    const initial = await readState(scope)

    const saved = await writeState(
      { ...initial, workerWindowPresets: [] },
      { scope, expectedRevision: 1 },
    )

    expect(saved.workerWindowPresets).toEqual(existing)
    expect((await readState(scope)).workerWindowPresets).toEqual(existing)
    expect(buckets.get('selectors:worker_window_presets')).toHaveLength(1)
    expect(
      operations
        .get('selectors:worker_window_presets')
        .some(([name]) => name === 'deleteMany' || name === 'bulkWrite'),
    ).toBe(false)
  })

  it('rejects an empty worker-hour catalog without deleting saved options', async () => {
    const existing = [
      { id: '0600-1500', label: 'בוקר', start: 360, end: 900, order: 0 },
    ]
    seedState({ workerWindowPresets: existing })

    await expect(
      saveWorkerWindowPresetCollection([], { scope, expectedRevision: 1 }),
    ).rejects.toMatchObject({ status: 400 })
    expect(buckets.get('selectors:worker_window_presets')).toHaveLength(1)
  })

  it('rejects stale worker-hour edits without replacing the current catalog', async () => {
    const existing = [
      { id: '0600-1500', label: 'בוקר', start: 360, end: 900, order: 0 },
    ]
    seedState({ workerWindowPresets: existing })

    await expect(
      saveWorkerWindowPresetCollection(
        [{ id: '0700-1500', label: 'חדש', start: 420, end: 900 }],
        { scope, expectedRevision: 0 },
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect((await readState(scope)).workerWindowPresets).toEqual(existing)
  })
})
