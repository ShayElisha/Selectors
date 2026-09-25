import { requestPasswordReset } from '../server/data.js'
import { assertRateLimit, clientKey } from '../server/rateLimit.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const phone = String(req.body?.phone || '')
    await assertRateLimit({
      key: `reset:${clientKey(req)}:${phone.replace(/\D/g, '') || 'empty'}`,
      limit: 5,
      windowMs: 15 * 60_000,
    })
    res.status(200).json(await requestPasswordReset(phone))
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({
      error: err.message || 'איפוס הסיסמה נכשל',
      retryAfterSec: err.retryAfterSec,
    })
  }
}
