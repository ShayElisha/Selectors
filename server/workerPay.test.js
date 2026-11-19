import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDb, scopeForRequest, requireWorkerActor } = vi.hoisted(() => ({
  getDb: vi.fn(),
  scopeForRequest: vi.fn(),
  requireWorkerActor: vi.fn(),
}))

vi.mock('./db.js', () => ({ getDb }))
vi.mock('./scope.js', () => ({ scopeForRequest }))
vi.mock('./workerPortal.js', () => ({ requireWorkerActor }))

import {
  createPayEntriesForCompletedShifts,
  createPayEntriesForShift,
  addWorkerPayEntry,
  getWorkerPay,
  saveWorkerPayRate,
} from './workerPay.js'

describe('worker pay entries', () => {
  let collection
  let shiftsCollection
  let presetsCollection

  beforeEach(() => {
    vi.clearAllMocks()
    collection = {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      createIndex: vi.fn().mockResolvedValue(undefined),
    }
    shiftsCollection = {
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }
    presetsCollection = {
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }
    getDb.mockResolvedValue({
      collection: (name) =>
        name === 'worker_pay'
          ? collection
          : name === 'shifts'
            ? shiftsCollection
            : presetsCollection,
    })
    requireWorkerActor.mockResolvedValue({
      actor: { id: 'w1', fullName: 'בודק' },
      scope: { orgId: 'org-1', module: 'inspectors' },
    })
    collection.findOne.mockResolvedValue({
      orgId: 'org-1',
      workerId: 'w1',
      basis: 'hourly',
      amount: 60,
      rates: [{ id: 'r1', name: 'רגיל', basis: 'hourly', amount: 60 }],
      entries: [],
    })
  })

  it('stores vacation days as a paid 08:00–16:00 block', async () => {
    const created = await addWorkerPayEntry(
      {},
      { date: '2026-11-03', kind: 'vacation' },
    )
    expect(created).toMatchObject({
      date: '2026-11-03',
      start: '08:00',
      end: '16:00',
      kind: 'vacation',
    })
    expect(collection.updateOne).toHaveBeenCalled()
  })

  it('replaces rate list when rates array is sent', async () => {
    await saveWorkerPayRate(
      {},
      {
        rates: [
          { id: 'a', name: 'רגיל', basis: 'hourly', amount: 55 },
          { id: 'b', name: 'ב׳', basis: 'hourly', amount: 70 },
        ],
      },
    )
    expect(collection.updateOne).toHaveBeenCalledWith(
      { orgId: 'org-1', workerId: 'w1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          basis: 'hourly',
          amount: 55,
          rates: [
            expect.objectContaining({ id: 'a', name: 'רגיל', amount: 55 }),
            expect.objectContaining({ id: 'b', name: 'ב׳', amount: 70 }),
          ],
        }),
      }),
      { upsert: true },
    )
  })

  it('waits for the final continuing shift to close before writing pay entries', async () => {
    const morning = {
      id: 'morning',
      date: '2026-11-18',
      shiftType: 'morning',
      audience: 'inspector',
      presentWorkerIds: ['w1'],
      workerWindows: { w1: 'long' },
      signOff: { signedAt: '2026-11-18T14:30:00.000Z' },
    }
    const afternoon = {
      id: 'afternoon',
      date: '2026-11-18',
      shiftType: 'afternoon',
      audience: 'inspector',
      presentWorkerIds: ['w1'],
      workerWindows: { w1: 'long' },
    }
    const presets = [{ id: 'long', start: 360, end: 1110 }]
    const models = [
      { id: 'morning', startMinutes: 360, endMinutes: 870 },
      { id: 'afternoon', startMinutes: 870, endMinutes: 1290 },
    ]
    const scope = { orgId: 'org-1', module: 'inspectors' }

    await createPayEntriesForCompletedShifts(
      [morning, afternoon],
      presets,
      models,
      scope,
      [{ id: 'w1', isInspector: true, staffKind: 'inspector' }],
    )
    expect(collection.updateOne).not.toHaveBeenCalled()

    afternoon.signOff = { signedAt: '2026-11-18T21:30:00.000Z' }
    await createPayEntriesForCompletedShifts(
      [morning, afternoon],
      presets,
      models,
      scope,
      [{ id: 'w1', isInspector: true, staffKind: 'inspector' }],
    )
    expect(collection.updateOne).toHaveBeenCalled()
  })

  it('removes its auto-generated pay row when a continuation is created later', async () => {
    const morning = {
      id: 'morning',
      date: '2026-11-18',
      shiftType: 'morning',
      audience: 'inspector',
      presentWorkerIds: ['w1'],
      workerWindows: { w1: 'long' },
      signOff: { signedAt: '2026-11-18T14:30:00.000Z' },
    }
    const afternoon = {
      id: 'afternoon',
      date: '2026-11-18',
      shiftType: 'afternoon',
      audience: 'inspector',
      presentWorkerIds: ['w1'],
      workerWindows: { w1: 'long' },
    }

    collection.findOne.mockResolvedValueOnce({
      orgId: 'org-1',
      workerId: 'w1',
      basis: 'hourly',
      amount: 60,
      rates: [],
      entries: [
        {
          id: 'auto-entry',
          sourceShiftId: 'morning',
          date: '2026-11-18',
          start: '06:00',
          end: '18:30',
          kind: 'work',
        },
      ],
    })

    await createPayEntriesForCompletedShifts(
      [morning, afternoon],
      [{ id: 'long', start: 360, end: 1110 }],
      [
        { id: 'morning', startMinutes: 360, endMinutes: 870 },
        { id: 'afternoon', startMinutes: 870, endMinutes: 1290 },
      ],
      { orgId: 'org-1', module: 'inspectors' },
      [{ id: 'w1', isInspector: true, staffKind: 'inspector' }],
    )

    expect(collection.updateOne).toHaveBeenCalledWith(
      { orgId: 'org-1', workerId: 'w1' },
      expect.objectContaining({
        $set: expect.objectContaining({ entries: [] }),
      }),
    )
  })

  it('does not create a pay entry when no personal hours are selected', async () => {
    await createPayEntriesForShift(
      {
        id: 'morning',
        date: '2026-11-18',
        shiftType: 'morning',
        presentWorkerIds: ['w1'],
      },
      [],
      { orgId: 'org-1', module: 'inspectors' },
      [{ id: 'morning', startMinutes: 360, endMinutes: 870 }],
    )

    expect(collection.updateOne).not.toHaveBeenCalled()
  })

  it('creates a pay entry when the worker has a stored personal-hours preset', async () => {
    await createPayEntriesForShift(
      {
        id: 'morning',
        date: '2026-11-18',
        shiftType: 'morning',
        presentWorkerIds: ['w1'],
        workerWindows: { w1: 'long' },
      },
      [{ id: 'long', start: 360, end: 1110 }],
      { orgId: 'org-1', module: 'inspectors' },
      [{ id: 'morning', startMinutes: 360, endMinutes: 870 }],
    )

    expect(collection.updateOne).toHaveBeenCalledWith(
      { orgId: 'org-1', workerId: 'w1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          entries: [
            expect.objectContaining({
              sourceShiftId: 'morning',
              date: '2026-11-18',
              start: '06:00',
              end: '18:30',
              kind: 'work',
            }),
          ],
        }),
      }),
      { upsert: true },
    )
  })

  it('shows manual entries but hides generated entries without a stored personal shift', async () => {
    collection.findOne.mockResolvedValue({
      orgId: 'org-1',
      workerId: 'w1',
      basis: 'hourly',
      amount: 60,
      rates: [],
      entries: [
        {
          id: 'manual',
          date: '2026-11-18',
          start: '08:00',
          end: '16:00',
          kind: 'work',
        },
        {
          id: 'generated',
          sourceShiftId: 'morning',
          date: '2026-11-18',
          start: '06:00',
          end: '14:30',
          kind: 'work',
        },
      ],
    })
    shiftsCollection.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 'morning',
          presentWorkerIds: ['w1'],
          workerWindows: {},
        },
      ]),
    })

    const result = await getWorkerPay({}, {})

    expect(result.entries.map((entry) => entry.id)).toEqual(['manual'])
  })

  it('shows generated entries only when the referenced personal shift exists in storage', async () => {
    collection.findOne.mockResolvedValue({
      orgId: 'org-1',
      workerId: 'w1',
      basis: 'hourly',
      amount: 60,
      rates: [],
      entries: [
        {
          id: 'generated',
          sourceShiftId: 'morning',
          date: '2026-11-18',
          start: '06:00',
          end: '18:30',
          kind: 'work',
        },
      ],
    })
    shiftsCollection.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 'morning',
          presentWorkerIds: ['w1'],
          workerWindows: { w1: 'long' },
        },
      ]),
    })
    presetsCollection.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ id: 'long' }]),
    })

    const result = await getWorkerPay({}, {})

    expect(result.entries.map((entry) => entry.id)).toEqual(['generated'])
  })
})
