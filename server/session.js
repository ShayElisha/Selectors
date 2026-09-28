import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

let ephemeralSecret = null

function getSecret() {
  const fromEnv = process.env.SESSION_SECRET?.trim()
  if (fromEnv && fromEnv.length >= 16) return fromEnv
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString('hex')
    console.warn(
      '[auth] SESSION_SECRET missing or too short — using ephemeral secret (sessions reset on restart). Set SESSION_SECRET in .env for production.',
    )
  }
  return ephemeralSecret
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64')
}

/**
 * @param {{
 *   id: string,
 *   fullName: string,
 *   phone: string,
 *   role?: 'super_admin' | 'org_manager',
 *   orgId?: string | null,
 *   orgName?: string | null,
 *   modules?: { selectors?: boolean, inspectors?: boolean },
 *   module?: 'selectors' | 'inspectors' | null,
 * }} user
 * @returns {string}
 */
export function createSessionToken(user) {
  const payload = {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role || 'org_manager',
    orgId: user.orgId || null,
    orgName: user.orgName || null,
    modules: {
      selectors: Boolean(user.modules?.selectors),
      inspectors: Boolean(user.modules?.inspectors),
    },
    module: user.module || null,
    isOrgManager: Boolean(user.isOrgManager),
    staffKind: user.staffKind || null,
    exp: Date.now() + SESSION_TTL_MS,
  }
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(createHmac('sha256', getSecret()).update(body).digest())
  return `${body}.${sig}`
}

/**
 * @param {string | null | undefined} token
 * @returns {{
 *   id: string,
 *   fullName: string,
 *   phone: string,
 *   role: 'super_admin' | 'org_manager',
 *   orgId: string | null,
 *   orgName: string | null,
 *   modules: { selectors: boolean, inspectors: boolean },
 *   module: 'selectors' | 'inspectors' | null,
 * } | null}
 */
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = b64url(createHmac('sha256', getSecret()).update(body).digest())
  try {
    const a = fromB64url(sig)
    const b = fromB64url(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8'))
    if (!payload?.id || !payload?.phone || !payload?.exp || !payload?.role) return null
    if (payload.role !== 'super_admin' && payload.role !== 'org_manager') return null
    if (Date.now() > Number(payload.exp)) return null
    const module =
      payload.module === 'inspectors' || payload.module === 'selectors'
        ? payload.module
        : null
    return {
      id: String(payload.id),
      fullName: String(payload.fullName || ''),
      phone: String(payload.phone || ''),
      role: payload.role,
      orgId: payload.orgId ? String(payload.orgId) : null,
      orgName: payload.orgName ? String(payload.orgName) : null,
      modules: {
        selectors: Boolean(payload.modules?.selectors),
        inspectors: Boolean(payload.modules?.inspectors),
      },
      module,
      isOrgManager:
        payload.isOrgManager === true ||
        (payload.isOrgManager == null &&
          Boolean(payload.modules?.selectors) &&
          Boolean(payload.modules?.inspectors)),
      staffKind:
        payload.staffKind === 'inspector' || payload.staffKind === 'selector'
          ? payload.staffKind
          : null,
    }
  } catch {
    return null
  }
}

/** @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined> }} req */
export function getBearerToken(req) {
  const headers = req.headers || {}
  const raw = headers.authorization ?? headers.Authorization
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value || typeof value !== 'string') return null
  const m = value.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

/**
 * @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined> }} req
 * @returns {{
 *   id: string,
 *   fullName: string,
 *   phone: string,
 *   role: 'super_admin' | 'org_manager',
 *   orgId: string | null,
 *   orgName: string | null,
 *   modules: { selectors: boolean, inspectors: boolean },
 *   module: 'selectors' | 'inspectors' | null,
 * }}
 */
export function requireUser(req) {
  const user = verifySessionToken(getBearerToken(req))
  if (!user) {
    const err = new Error('נדרשת התחברות')
    err.status = 401
    throw err
  }
  return user
}

export function requireSuperAdmin(req) {
  const user = requireUser(req)
  if (user.role !== 'super_admin') {
    const err = new Error('נדרשת הרשאת סופר אדמין')
    err.status = 403
    throw err
  }
  return user
}
