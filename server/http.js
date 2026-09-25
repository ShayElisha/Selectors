import { requireUser } from './session.js'

/**
 * Shared helper for Vercel serverless + Express-style handlers.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {(user: { id: string, fullName: string, phone: string }) => Promise<void>} fn
 */
export async function withAuth(req, res, fn) {
  try {
    const user = requireUser(req)
    await fn(user)
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: err.message || 'שגיאת שרת' })
  }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string[]} allowed
 * @returns {boolean} true if method allowed
 */
export function allowMethods(req, res, allowed) {
  if (allowed.includes(req.method)) return true
  res.setHeader('Allow', allowed.join(', '))
  res.status(405).json({ error: 'Method not allowed' })
  return false
}
