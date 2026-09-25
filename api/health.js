import { getDb } from '../server/db.js'
import { isSmtpConfigured } from '../server/mail.js'

export default async function handler(_req, res) {
  try {
    await getDb()
    res.status(200).json({
      ok: true,
      db: true,
      smtpConfigured: isSmtpConfigured(),
      at: new Date().toISOString(),
      service: 'shibutzon-api',
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      ok: false,
      db: false,
      smtpConfigured: isSmtpConfigured(),
      error: err.message,
    })
  }
}
