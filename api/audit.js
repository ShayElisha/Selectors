import {
  appendClientAuditEvent,
  listAuditLogs,
} from '../server/audit.js'
import { requireUser } from '../server/session.js'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const actor = requireUser(req)
    if (req.method === 'GET') {
      const limit = req.query?.limit
      res.status(200).json(await listAuditLogs({ limit }))
      return
    }
    res.status(201).json(await appendClientAuditEvent(req.body || {}, actor))
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: err.message || 'Failed to write audit log' })
  }
}
