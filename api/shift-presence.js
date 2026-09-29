import { getDb } from '../server/db.js'
import { requireUser } from '../server/session.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const user = requireUser(req)
    const shiftId = String(req.body?.shiftId || '')
    if (!shiftId || !user.orgId) {
      res.status(200).json({ others: [] })
      return
    }
    const db = await getDb()
    const col = db.collection('shift_presence')
    const now = new Date()
    await col.updateOne(
      { _id: `${user.orgId}:${shiftId}:${user.id}` },
      {
        $set: {
          orgId: user.orgId,
          shiftId,
          userId: user.id,
          name: user.fullName || 'מנהל',
          at: now,
        },
      },
      { upsert: true },
    )
    const since = new Date(Date.now() - 45_000)
    const rows = await col
      .find({
        orgId: user.orgId,
        shiftId,
        userId: { $ne: user.id },
        at: { $gte: since },
      })
      .toArray()
    res.status(200).json({ others: rows.map((row) => row.name).filter(Boolean) })
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: err.message || 'שגיאת שרת' })
  }
}
