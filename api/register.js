import { registerOrganization } from '../server/orgs.js'
import { assertRateLimit, clientKey } from '../server/rateLimit.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    await assertRateLimit({
      key: `register:${clientKey(req)}`,
      limit: 5,
      windowMs: 15 * 60_000,
    })
    res.status(201).json(await registerOrganization(req.body || {}))
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({
      error: err.message || 'הרשמת הארגון נכשלה',
      retryAfterSec: err.retryAfterSec,
    })
  }
}
