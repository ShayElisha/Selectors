import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDb, findToArray } = vi.hoisted(() => {
  const findToArray = vi.fn(async () => [])
  const getDb = vi.fn(async () => ({
    collection: () => ({
      find: () => ({
        toArray: findToArray,
      }),
    }),
  }))
  return { getDb, findToArray }
})

vi.mock('./db.js', () => ({
  getAuditCollection: vi.fn(),
  getDb,
  getMetaCollection: vi.fn(),
  getStateCollection: vi.fn(),
  operationalDbTargets: () => ['selectors', 'inspectors', 'security'],
  withDbTransaction: vi.fn(async (fn) => fn()),
}))

vi.mock('./audit.js', () => ({
  appendAuditLog: vi.fn(),
  diffAppDataAuditEvents: vi.fn(() => []),
  shiftAuditHeader: vi.fn(),
  summarizeAssignmentChanges: vi.fn(),
}))

vi.mock('./selfHeal.js', () => ({
  validateSelfHeal: vi.fn(),
}))

vi.mock('./mail.js', () => ({
  sendTempPasswordEmail: vi.fn(),
}))

vi.mock('./password.js', () => ({
  generateTempPassword: vi.fn(() => 'Temp123!'),
  hashPassword: vi.fn(async () => 'hash'),
}))

vi.mock('./orgs.js', () => ({
  authenticateManager: vi.fn(),
  createLegacyOrganization: vi.fn(),
  disableWorkerAccount: vi.fn(),
  requestAccountPasswordReset: vi.fn(),
  upsertManagerAccount: vi.fn(),
}))

import { assertUniqueWorkerContacts } from './data.js'

describe('assertUniqueWorkerContacts', () => {
  beforeEach(() => {
    findToArray.mockResolvedValue([])
    getDb.mockClear()
    findToArray.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects duplicate phones inside the same module payload', async () => {
    await expect(
      assertUniqueWorkerContacts(
        [
          { id: '1', fullName: 'א', phone: '050-111-1111', email: '' },
          { id: '2', fullName: 'ב', phone: '0501111111', email: '' },
        ],
        { orgId: 'org-1', module: 'selectors' },
      ),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('rejects duplicate emails inside the same module payload', async () => {
    await expect(
      assertUniqueWorkerContacts(
        [
          { id: '1', fullName: 'א', phone: '0501111111', email: 'a@b.com' },
          { id: '2', fullName: 'ב', phone: '0502222222', email: 'A@B.com' },
        ],
        { orgId: 'org-1', module: 'security' },
      ),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('rejects a phone that already exists in another module', async () => {
    findToArray.mockImplementation(async () => [
      { id: 'x', fullName: 'מאבטח קיים', phone: '0501111111', email: '' },
    ])
    // First other target queried may be inspectors or security depending on loop;
    // return conflict only when asked — always return the conflicting row.
    await expect(
      assertUniqueWorkerContacts(
        [{ id: '1', fullName: 'סלקטור', phone: '050-111-1111', email: '' }],
        { orgId: 'org-1', module: 'selectors' },
      ),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('allows the same empty email across workers', async () => {
    await expect(
      assertUniqueWorkerContacts(
        [
          { id: '1', fullName: 'א', phone: '0501111111', email: '' },
          { id: '2', fullName: 'ב', phone: '0502222222', email: '' },
        ],
        { orgId: 'org-1', module: 'inspectors' },
      ),
    ).resolves.toBeUndefined()
  })
})
