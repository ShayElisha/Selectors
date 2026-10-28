import { refreshOrgSession } from './orgs.js'
import { getBearerToken, verifySessionToken } from './session.js'

export function createActiveUserMiddleware(sendError) {
  return async (req, res, next) => {
    const tokenUser = verifySessionToken(getBearerToken(req))
    if (tokenUser?.role !== 'org_manager' && tokenUser?.role !== 'worker') {
      next()
      return
    }
    try {
      req.activeUser = await refreshOrgSession(tokenUser)
      next()
    } catch (error) {
      sendError(res, error)
    }
  }
}
