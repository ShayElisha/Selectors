import { refreshManagerSession } from '../server/orgs.js'
import { createSessionToken, requireUser } from '../server/session.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const user = requireUser(req)
    if (user.role === 'super_admin') {
      res.status(200).json({ ...user, token: createSessionToken(user) })
      return
    }
    const fresh = await refreshManagerSession(user)
    const token = createSessionToken(fresh)
    res.status(200).json({ ...fresh, token })
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: err.message || 'שגיאת שרת' })
  }
}
