import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDb, findOne } = vi.hoisted(() => ({
  getDb: vi.fn(),
  findOne: vi.fn(),
}))

vi.mock('./db.js', () => ({
  getAuditCollection: vi.fn(),
  getDb,
  getMetaCollection: vi.fn(),
  withDbTransaction: vi.fn(),
}))

import { authenticateManager } from './orgs.js'

describe('authenticateManager phone preflight', () => {
  beforeEach(() => {
    vi.stubEnv('SUPER_ADMIN_PHONE', '')
    vi.stubEnv('SUPER_ADMIN_PASSWORD', '')
    getDb.mockResolvedValue({
      collection: () => ({ findOne }),
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('does not reveal whether a phone number has an account', async () => {
    findOne.mockResolvedValue(null)
    const unknown = await authenticateManager('0501234567')

    findOne.mockResolvedValue({ status: 'active', passwordHash: 'stored-hash' })
    const known = await authenticateManager('0501234567')

    expect(unknown).toEqual({ next: 'login', phone: '0501234567' })
    expect(known).toEqual(unknown)
  })
})
