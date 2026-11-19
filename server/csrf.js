const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function assertCookieMutationOrigin(req, allowedOrigins) {
  const method = String(req.method || '').toUpperCase()
  const headers = req.headers || {}
  const cookie = String(req.get?.('cookie') || headers.cookie || headers.Cookie || '')
  if (
    !MUTATING_METHODS.has(method) ||
    !/(?:^|;\s*)getin_session=/.test(cookie)
  ) {
    return
  }

  const origin = String(req.get?.('origin') || headers.origin || '')
    .replace(/\/+$/, '')
  if (!origin || !allowedOrigins.has(origin)) {
    const error = new Error('מקור הבקשה אינו מורשה')
    error.status = 403
    throw error
  }
}
