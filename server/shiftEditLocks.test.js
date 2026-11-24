import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateOne = vi.fn()
const findOne = vi.fn()
const deleteOne = vi.fn()

vi.mock('./db.js', () => ({
  getDb: async () => ({
    collection: () => ({ updateOne, findOne, deleteOne }),
  }),
}))

describe('shiftEditLocks', () => {
  beforeEach(() => {
    vi.resetModules()
    updateOne.mockReset()
    findOne.mockReset()
    deleteOne.mockReset()
  })

  it('blocks a second manager while the first lock is fresh', async () => {
    findOne.mockResolvedValueOnce({
      _id: 'org:inspectors:2026-11-24:afternoon:inspector',
      userId: 'u1',
      name: 'שחר',
      at: new Date(),
    })
    const { acquireShiftEditLock } = await import('./shiftEditLocks.js')
    const result = await acquireShiftEditLock({
      orgId: 'org',
      module: 'inspectors',
      date: '2026-11-24',
      shiftType: 'afternoon',
      audience: 'inspector',
      userId: 'u2',
      name: 'אדי',
    })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(409)
    expect(result.holder?.name).toBe('שחר')
    expect(updateOne).not.toHaveBeenCalled()
  })

  it('lets the same manager refresh the lock', async () => {
    findOne
      .mockResolvedValueOnce({
        _id: 'org:inspectors:2026-11-24:afternoon:inspector',
        userId: 'u1',
        name: 'שחר',
        at: new Date(),
      })
      .mockResolvedValueOnce({
        _id: 'org:inspectors:2026-11-24:afternoon:inspector',
        userId: 'u1',
        name: 'שחר',
        at: new Date(),
      })
    updateOne.mockResolvedValue({ acknowledged: true })
    const { acquireShiftEditLock } = await import('./shiftEditLocks.js')
    const result = await acquireShiftEditLock({
      orgId: 'org',
      module: 'inspectors',
      date: '2026-11-24',
      shiftType: 'afternoon',
      audience: 'inspector',
      userId: 'u1',
      name: 'שחר',
      shiftId: 'shift-1',
    })
    expect(result.ok).toBe(true)
    expect(updateOne).toHaveBeenCalled()
  })

  it('frees an expired lock for another manager', async () => {
    findOne
      .mockResolvedValueOnce({
        userId: 'u1',
        name: 'שחר',
        at: new Date(Date.now() - 120_000),
      })
      .mockResolvedValueOnce({
        userId: 'u2',
        name: 'אדי',
        at: new Date(),
      })
    updateOne.mockResolvedValue({ acknowledged: true })
    const { acquireShiftEditLock } = await import('./shiftEditLocks.js')
    const result = await acquireShiftEditLock({
      orgId: 'org',
      module: 'inspectors',
      date: '2026-11-24',
      shiftType: 'afternoon',
      audience: 'inspector',
      userId: 'u2',
      name: 'אדי',
    })
    expect(result.ok).toBe(true)
  })
})
