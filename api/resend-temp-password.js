import { resendManagerTempPassword } from '../server/data.js'
import { assertRateLimit, clientKey } from '../server/rateLimit.js'
import { requireUser } from '../server/session.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const actor = requireUser(req)
    const workerId = String(req.body?.workerId || '')
    if (!workerId) {
      res.status(400).json({ error: 'חסר מזהה עובד' })
      return
    }
    await assertRateLimit({
      key: `reinvite:${clientKey(req)}:${workerId}`,
      limit: 5,
      windowMs: 15 * 60_000,
    })
    res.status(200).json(await resendManagerTempPassword(workerId, actor))
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: err.message || 'שליחה נכשלה' })
  }
}
