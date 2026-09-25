import { createSeedData, writeState } from '../server/data.js'
import { requireUser } from '../server/session.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const actor = requireUser(req)
    if (req.body?.confirm !== 'RESET') {
      res.status(400).json({ error: 'לאיפוס יש לשלוח confirm: "RESET"' })
      return
    }
    res.status(200).json(
      await writeState(createSeedData(), {
        action: 'data_reset',
        actor,
        skipManagerInvites: true,
        expectedRevision:
          req.body?.expectedRevision != null
            ? Number(req.body.expectedRevision)
            : undefined,
      }),
    )
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    const body = { error: err.message || 'Failed to seed data' }
    if (err.current) body.current = err.current
    res.status(status).json(body)
  }
}
