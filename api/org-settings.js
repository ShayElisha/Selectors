import {
  readOrgAssignmentSettings,
  updateOrgAssignmentSettings,
} from '../server/orgs.js'
import { requireUser } from '../server/session.js'

function orgUser(req) {
  const user = requireUser(req)
  if (user.role !== 'org_manager' || !user.orgId) {
    const err = new Error('אין הרשאה להגדרות הארגון')
    err.status = 403
    throw err
  }
  return user
}

export default async function handler(req, res) {
  try {
    const user = orgUser(req)
    if (req.method === 'GET') {
      res.status(200).json(await readOrgAssignmentSettings(user.orgId))
      return
    }
    if (req.method === 'PATCH') {
      if (!user.isOrgManager) {
        res.status(403).json({ error: 'רק מנהל הארגון יכול לשנות את אופן השיבוץ' })
        return
      }
      res.status(200).json(
        await updateOrgAssignmentSettings(
          user.orgId,
          req.body || {},
          user,
        ),
      )
      return
    }
    res.setHeader('Allow', 'GET, PATCH')
    res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: err.message || 'Failed' })
  }
}
