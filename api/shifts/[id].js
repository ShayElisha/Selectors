import { deleteShift, upsertShift } from '../../server/data.js'
import { requireUser } from '../../server/session.js'

export default async function handler(req, res) {
  const id = req.query.id
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'Missing shift id' })
    return
  }

  try {
    const actor = requireUser(req)
    if (req.method === 'PUT') {
      const body = req.body || {}
      const expectedRevision = body.expectedRevision
      delete body.expectedRevision
      res.status(200).json(
        await upsertShift(id, body, actor, {
          expectedRevision:
            expectedRevision === undefined ? undefined : Number(expectedRevision),
        }),
      )
      return
    }
    if (req.method === 'DELETE') {
      const expectedRevision = req.query.expectedRevision
      res.status(200).json(
        await deleteShift(id, actor, {
          expectedRevision:
            expectedRevision === undefined ? undefined : Number(expectedRevision),
        }),
      )
      return
    }
    res.setHeader('Allow', 'PUT, DELETE')
    res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    const body = { error: err.message || 'Failed' }
    if (err.current) body.current = err.current
    res.status(status).json(body)
  }
}
