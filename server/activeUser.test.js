import { beforeEach, describe, expect, it, vi } from 'vitest'

const { refreshManagerSession, getBearerToken, verifySessionToken } = vi.hoisted(
  () => ({
    refreshManagerSession: vi.fn(),
    getBearerToken: vi.fn(),
    verifySessionToken: vi.fn(),
  }),
)

vi.mock('./orgs.js', () => ({ refreshManagerSession }))
vi.mock('./session.js', () => ({ getBearerToken, verifySessionToken }))

import { createActiveUserMiddleware } from './activeUser.js'

describe('active user middleware', () => {
  beforeEach(() => vi.clearAllMocks())

  it('continues without refreshing non-manager requests', async () => {
    verifySessionToken.mockReturnValue({ role: 'super_admin' })
    const next = vi.fn()
    const sendError = vi.fn()

    await createActiveUserMiddleware(sendError)({}, {}, next)

    expect(next).toHaveBeenCalledOnce()
    expect(refreshManagerSession).not.toHaveBeenCalled()
  })

  it('refreshes and attaches active organization managers', async () => {
    const tokenUser = { id: 'manager-1', role: 'org_manager' }
    const activeUser = { ...tokenUser, orgId: 'org-1', modules: { selectors: true } }
    verifySessionToken.mockReturnValue(tokenUser)
    refreshManagerSession.mockResolvedValue(activeUser)
    const req = {}
    const next = vi.fn()

    await createActiveUserMiddleware(vi.fn())(req, {}, next)

    expect(req.activeUser).toBe(activeUser)
    expect(next).toHaveBeenCalledOnce()
  })

  it('passes refresh failures to the shared error handler', async () => {
    const error = Object.assign(new Error('inactive'), { status: 401 })
    verifySessionToken.mockReturnValue({ id: 'manager-1', role: 'org_manager' })
    refreshManagerSession.mockRejectedValue(error)
    const sendError = vi.fn()
    const next = vi.fn()
    const res = {}

    await createActiveUserMiddleware(sendError)({}, res, next)

    expect(sendError).toHaveBeenCalledWith(res, error)
    expect(next).not.toHaveBeenCalled()
  })
})
