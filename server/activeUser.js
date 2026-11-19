import { refreshOrgSession } from './orgs.js'
import { getBearerToken, verifySessionToken } from './session.js'
import { isSessionIdRevoked } from './sessionRevocation.js'

export function createActiveUserMiddleware(sendError) {
  return async (req, res, next) => {
    const tokenUser = verifySessionToken(getBearerToken(req))
    try {
      if (tokenUser?.jti && (await isSessionIdRevoked(tokenUser.jti))) {
        const error = new Error('ההתחברות אינה בתוקף. יש להתחבר מחדש.')
        error.status = 401
        sendError(res, error)
        return
      }
    } catch (error) {
      sendError(res, error)
      return
    }
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
