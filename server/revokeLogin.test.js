import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updateMany, getDb } = vi.hoisted(() => {
  const updateMany = vi.fn(async () => ({ matchedCount: 1 }))
  const getDb = vi.fn(async () => ({
    collection: () => ({ updateMany }),
  }))
  return { updateMany, getDb }
})

vi.mock('./db.js', () => ({
  getAuditCollection: vi.fn(),
  getDb,
  getMetaCollection: vi.fn(),
  operationalDbTargets: () => ['selectors'],
  withDbTransaction: vi.fn(),
}))

import { workersNeedingLoginRevoke } from './data.js'
import { disableWorkerAccount } from './orgs.js'

describe('workersNeedingLoginRevoke', () => {
  it('revokes deleted managers', () => {
    expect(
      workersNeedingLoginRevoke(
        [{ id: 'm1', phone: '0501111111', isManager: true, status: 'active' }],
        [],
      ),
    ).toEqual([{ id: 'm1', phone: '0501111111' }])
  })

  it('revokes inactive and archived workers who had login', () => {
    expect(
      workersNeedingLoginRevoke(
        [
          { id: 'a', phone: '0501', isManager: true, status: 'active' },
          { id: 'b', phone: '0502', canLogin: true, status: 'active' },
        ],
        [
          { id: 'a', phone: '0501', isManager: true, status: 'inactive' },
          { id: 'b', phone: '0502', canLogin: true, status: 'archived' },
        ],
      ),
    ).toEqual([
      { id: 'a', phone: '0501' },
      { id: 'b', phone: '0502' },
    ])
  })

  it('revokes when login flags are cleared', () => {
    expect(
      workersNeedingLoginRevoke(
        [{ id: 'w1', phone: '0503', isManager: true, status: 'active' }],
        [
          {
            id: 'w1',
            phone: '0503',
            isManager: false,
            canLogin: false,
            status: 'active',
          },
        ],
      ),
    ).toEqual([{ id: 'w1', phone: '0503' }])
  })

  it('keeps active managers with login', () => {
    expect(
      workersNeedingLoginRevoke(
        [{ id: 'w1', phone: '0504', isManager: true, status: 'active' }],
        [{ id: 'w1', phone: '0504', isManager: true, status: 'active' }],
      ),
    ).toEqual([])
  })

  it('ignores workers who never had login', () => {
    expect(
      workersNeedingLoginRevoke(
        [
          {
            id: 'w1',
            phone: '0505',
            isManager: false,
            canLogin: false,
            status: 'active',
          },
        ],
        [],
      ),
    ).toEqual([])
  })
})

describe('disableWorkerAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks the account inactive and bumps tokenVersion by id or phone', async () => {
    await disableWorkerAccount('org-1', 'worker-1', '050-123-4567')
    expect(updateMany).toHaveBeenCalledWith(
      {
        orgId: 'org-1',
        $or: [{ _id: 'worker-1' }, { phone: '0501234567' }],
      },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'inactive' }),
        $inc: { tokenVersion: 1 },
      }),
    )
  })
})
