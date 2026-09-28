import { listOrganizations, reviewOrganization } from '../server/orgs.js'
import { requireSuperAdmin } from '../server/session.js'

export default async function handler(req, res) {
  try {
    requireSuperAdmin(req)
    if (req.method === 'GET') {
      res.status(200).json(await listOrganizations())
      return
    }
    if (req.method === 'PATCH') {
      const id = String(req.body?.id || '')
      if (!id) {
        res.status(400).json({ error: 'חסר מזהה ארגון' })
        return
      }
      res.status(200).json(await reviewOrganization(id, req.body || {}))
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
