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
      isOrgManager: true,
      modules: { selectors: true, inspectors: true, security: false },
    })
    getOrganization.mockResolvedValue({
      _id: 'org-1',
      status: 'approved',
      modules: { selectors: true, inspectors: true, security: false },
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
        headers: { 'x-app-module': 'security' },
        query: {},
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('lets org managers hop between open modules via X-App-Module', async () => {
    const result = await scopeForRequest({
      headers: { 'x-app-module': 'inspectors' },
      query: {},
    })
    expect(result.scope.module).toBe('inspectors')
  })

  it('blocks shift managers from hopping to another module', async () => {
    refreshManagerSession.mockResolvedValue({
      id: 'shift-1',
      role: 'org_manager',
      orgId: 'org-1',
      fullName: 'Shift',
      isOrgManager: false,
      staffKind: 'selector',
      modules: { selectors: true, inspectors: false, security: false },
    })

    await expect(
      scopeForRequest({
        headers: { 'x-app-module': 'inspectors' },
        query: {},
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/מנהל ארגון/),
    })
  })

  it('keeps shift managers on their own module', async () => {
    refreshManagerSession.mockResolvedValue({
      id: 'shift-1',
      role: 'org_manager',
      orgId: 'org-1',
      fullName: 'Shift',
      isOrgManager: false,
      staffKind: 'selector',
      modules: { selectors: true, inspectors: false, security: false },
    })

    const result = await scopeForRequest({
      headers: { 'x-app-module': 'selectors' },
      query: {},
    })
    expect(result.scope.module).toBe('selectors')
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
