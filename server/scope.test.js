import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getOrganization, refreshManagerSession, requireUser } = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  refreshManagerSession: vi.fn(),
  requireUser: vi.fn(),
}))

vi.mock('./orgs.js', () => ({ getOrganization, refreshManagerSession }))
vi.mock('./session.js', () => ({ requireUser }))

import { scopeForRequest } from './scope.js'

describe('scopeForRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockReturnValue({
      id: 'manager-1',
      role: 'org_manager',
      orgId: 'org-1',
      fullName: 'Manager',
    })
    refreshManagerSession.mockResolvedValue({
      id: 'manager-1',
      role: 'org_manager',
      orgId: 'org-1',
      fullName: 'Manager',
    })
    getOrganization.mockResolvedValue({
      _id: 'org-1',
      status: 'approved',
      modules: { selectors: true, inspectors: false, security: false },
    })
  })

  it('returns the approved organization module requested by the manager', async () => {
    const result = await scopeForRequest({
      headers: { 'x-app-module': 'selectors' },
      query: {},
    })

    expect(result.scope).toEqual({ orgId: 'org-1', module: 'selectors' })
    expect(result.actor.id).toBe('manager-1')
  })

  it('rejects disabled modules even when requested explicitly', async () => {
    await expect(
      scopeForRequest({
        headers: { 'x-app-module': 'inspectors' },
        query: {},
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('rejects accounts whose organization is not approved', async () => {
    getOrganization.mockResolvedValue({
      _id: 'org-1',
      status: 'suspended',
      modules: { selectors: true },
    })

    await expect(scopeForRequest({ headers: {}, query: {} })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('does not grant organization scope to super admins', async () => {
    requireUser.mockReturnValue({
      id: 'admin-1',
      role: 'super_admin',
      orgId: null,
    })

    await expect(scopeForRequest({ headers: {}, query: {} })).rejects.toMatchObject({
      status: 403,
    })
    expect(getOrganization).not.toHaveBeenCalled()
  })
})
