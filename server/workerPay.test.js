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
  addWorkerPayEntry,
  saveWorkerPayRate,
} from './workerPay.js'

describe('worker pay entries', () => {
  let collection

  beforeEach(() => {
    vi.clearAllMocks()
    collection = {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      createIndex: vi.fn().mockResolvedValue(undefined),
    }
    getDb.mockResolvedValue({
      collection: () => collection,
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
})
