import { sendTestEmail } from '../server/mail.js'
import { requireUser } from '../server/session.js'

/** Authenticated smoke-test: POST /api/mail-test  body: { to?: string } */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    requireUser(req)
    const to =
      typeof req.body?.to === 'string' && req.body.to.trim()
        ? req.body.to.trim()
        : undefined
    const result = await sendTestEmail({ to })
    res.status(200).json({
      ok: true,
      queued: result.queued,
      devLogged: result.devLogged,
    })
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) {
      console.error('[mail-test]', err instanceof Error ? err.message : err)
    }
    res.status(status).json({
      error: err.message || 'בדיקת המייל נכשלה',
      code: err.code,
    })
  }
}
