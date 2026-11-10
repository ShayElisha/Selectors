import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  findOne,
  updateOne,
  sendTempPasswordEmail,
  hashPassword,
  verifyPassword,
  generateTempPassword,
} = vi.hoisted(() => ({
  findOne: vi.fn(),
  updateOne: vi.fn(),
  sendTempPasswordEmail: vi.fn(),
  hashPassword: vi.fn(async (value) => `hash:${value}`),
  verifyPassword: vi.fn(async (password, stored) => stored === `hash:${password}`),
  generateTempPassword: vi.fn(() => '123456'),
}))

vi.mock('./db.js', () => ({
  getAuditCollection: vi.fn(),
  getDb: vi.fn(async () => ({
    collection: () => ({ findOne, updateOne, findOneAndUpdate: vi.fn() }),
  })),
  getMetaCollection: vi.fn(),
  operationalDbTargets: () => ['selectors'],
  withDbTransaction: vi.fn(),
}))

vi.mock('./mail.js', () => ({
  sendTempPasswordEmail,
  sendModulesOpenedEmail: vi.fn(),
  sendNewOrganizationAdminEmail: vi.fn(),
  sendOrganizationApprovedEmail: vi.fn(),
  sendOrganizationCreatedEmail: vi.fn(),
  sendOrganizationRejectedEmail: vi.fn(),
}))

vi.mock('./password.js', async () => {
  const actual = await vi.importActual('./password.js')
  return {
    ...actual,
    hashPassword,
    verifyPassword,
    generateTempPassword,
  }
})

vi.mock('./audit.js', () => ({
  appendAuditLog: vi.fn(),
}))

import { authenticateManager, requestAccountPasswordReset } from './orgs.js'

describe('password reset without immediate overwrite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUPER_ADMIN_PHONE', '')
    vi.stubEnv('SUPER_ADMIN_PASSWORD', '')
    findOne.mockResolvedValue({
      _id: 'acc-1',
      orgId: 'org-1',
      fullName: 'Manager',
      phone: '0501234567',
      email: 'manager@example.com',
      status: 'active',
      passwordHash: 'hash:OldPass1!',
      mustChangePassword: false,
      role: 'org_manager',
      isOrgManager: true,
      staffKind: 'selector',
      tokenVersion: 1,
    })
    updateOne.mockResolvedValue({ matchedCount: 1 })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('stores a reset hash and does not replace passwordHash', async () => {
    // org lookup for nothing in reset path beyond account
    findOne
      .mockResolvedValueOnce({
        _id: 'acc-1',
        orgId: 'org-1',
        fullName: 'Manager',
        phone: '0501234567',
        email: 'manager@example.com',
        status: 'active',
        passwordHash: 'hash:OldPass1!',
      })

    await requestAccountPasswordReset('0501234567')

    expect(sendTempPasswordEmail).toHaveBeenCalledOnce()
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'acc-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          passwordResetHash: 'hash:123456',
        }),
        $inc: { tokenVersion: 1 },
      }),
    )
    const setFields = updateOne.mock.calls[0][1].$set
    expect(setFields.passwordHash).toBeUndefined()
    expect(setFields.mustChangePassword).toBeUndefined()
  })

  it('accepts the reset code then requires a new permanent password', async () => {
    findOne
      // account by phone
      .mockResolvedValueOnce({
        _id: 'acc-1',
        orgId: 'org-1',
        fullName: 'Manager',
        phone: '0501234567',
        email: 'manager@example.com',
        status: 'active',
        passwordHash: 'hash:OldPass1!',
        passwordResetHash: 'hash:123456',
        passwordResetExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        mustChangePassword: false,
        role: 'org_manager',
        isOrgManager: true,
        staffKind: 'selector',
        tokenVersion: 2,
      })
      // getOrganization
      .mockResolvedValueOnce({
        _id: 'org-1',
        name: 'Org',
        status: 'approved',
        modules: { selectors: true, inspectors: false, security: false },
      })

    const result = await authenticateManager('0501234567', {
      password: '123456',
    })
    expect(result).toEqual({ next: 'change_password', phone: '0501234567' })
  })
})
