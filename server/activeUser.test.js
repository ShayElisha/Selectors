import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  refreshOrgSession,
  getBearerToken,
  verifySessionToken,
  isSessionIdRevoked,
} = vi.hoisted(
  () => ({
    refreshOrgSession: vi.fn(),
    getBearerToken: vi.fn(),
    verifySessionToken: vi.fn(),
    isSessionIdRevoked: vi.fn(),
  }),
)

vi.mock('./orgs.js', () => ({ refreshOrgSession }))
vi.mock('./session.js', () => ({ getBearerToken, verifySessionToken }))
vi.mock('./sessionRevocation.js', () => ({ isSessionIdRevoked }))

import { createActiveUserMiddleware } from './activeUser.js'

describe('active user middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isSessionIdRevoked.mockResolvedValue(false)
  })

  it('continues without refreshing non-manager requests', async () => {
    verifySessionToken.mockReturnValue({ role: 'super_admin' })
    const next = vi.fn()
    const sendError = vi.fn()

    await createActiveUserMiddleware(sendError)({}, {}, next)

    expect(next).toHaveBeenCalledOnce()
    expect(refreshOrgSession).not.toHaveBeenCalled()
  })

  it('refreshes and attaches active organization managers', async () => {
    const tokenUser = { id: 'manager-1', role: 'org_manager' }
    const activeUser = {
      ...tokenUser,
      orgId: 'org-1',
      modules: { selectors: true, inspectors: false, security: false },
    }
    verifySessionToken.mockReturnValue(tokenUser)
    refreshOrgSession.mockResolvedValue(activeUser)
    const req = {}
    const next = vi.fn()

    await createActiveUserMiddleware(vi.fn())(req, {}, next)

    expect(req.activeUser).toBe(activeUser)
    expect(next).toHaveBeenCalledOnce()
  })

  it('passes refresh failures to the shared error handler', async () => {
    const error = Object.assign(new Error('inactive'), { status: 401 })
    verifySessionToken.mockReturnValue({ id: 'manager-1', role: 'org_manager' })
    refreshOrgSession.mockRejectedValue(error)
    const sendError = vi.fn()
    const next = vi.fn()
    const res = {}

    await createActiveUserMiddleware(sendError)({}, res, next)

    expect(sendError).toHaveBeenCalledWith(res, error)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects revoked sessions for every role', async () => {
    verifySessionToken.mockReturnValue({
      id: 'admin-1',
      jti: 'session-1',
      role: 'super_admin',
    })
    isSessionIdRevoked.mockResolvedValue(true)
    const sendError = vi.fn()
    const next = vi.fn()
    const res = {}

    await createActiveUserMiddleware(sendError)({}, res, next)

    expect(sendError).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ status: 401 }),
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('fails closed when session revocation cannot be checked', async () => {
    const error = new Error('database unavailable')
    verifySessionToken.mockReturnValue({
      id: 'admin-1',
      jti: 'session-1',
      role: 'super_admin',
    })
    isSessionIdRevoked.mockRejectedValue(error)
    const sendError = vi.fn()
    const next = vi.fn()
    const res = {}

    await createActiveUserMiddleware(sendError)({}, res, next)

    expect(sendError).toHaveBeenCalledWith(res, error)
    expect(next).not.toHaveBeenCalled()
  })
})
