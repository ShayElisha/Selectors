import { getOrganization } from './orgs.js'
import { requireUser } from './session.js'

function requestedModule(req) {
  const headers = req.headers || {}
  const rawHeader = headers['x-app-module'] ?? headers['X-App-Module']
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
  const query = req.query?.module
  const raw = String(header || query || '')
  if (raw === 'inspectors' || raw === 'selectors') return raw
  return ''
}

/**
 * Operational data is always one organization plus one module.
 * Super admin does not read or write scheduling data.
 */
export async function scopeForRequest(req) {
  const actor = requireUser(req)
  if (actor.role !== 'org_manager' || !actor.orgId) {
    const err = new Error('אין הרשאה לנתוני ארגון')
    err.status = 403
    throw err
  }
  const org = await getOrganization(actor.orgId)
  if (!org) {
    const err = new Error('הארגון נמחק. יש להתחבר מחדש.')
    err.status = 401
    throw err
  }
  if (org.status !== 'approved') {
    const err = new Error('הארגון אינו מאושר')
    err.status = 403
    throw err
  }
  const modules = {
    selectors: Boolean(org.modules?.selectors),
    inspectors: Boolean(org.modules?.inspectors),
  }
  let module = requestedModule(req)
  if (!module) {
    module = modules.selectors ? 'selectors' : modules.inspectors ? 'inspectors' : ''
  }
  if (!module || !modules[module]) {
    const err = new Error('המודול הזה לא פתוח לארגון')
    err.status = 403
    throw err
  }
  return {
    actor,
    org,
    scope: { orgId: String(org._id), module },
  }
}
