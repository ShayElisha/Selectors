import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto'

const PREFIX = 'enc:v1:'

function keyMaterial() {
  const raw = String(process.env.PII_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '').trim()
  if (!raw || raw.length < 16) return null
  return scryptSync(raw, 'getin-pii-v1', 32)
}

export function piiEncryptionEnabled() {
  return Boolean(keyMaterial())
}

/** Deterministic lookup token (not reversible). */
export function piiLookupHash(value) {
  const key = keyMaterial()
  if (!key) return ''
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  return createHmac('sha256', key).update(normalized).digest('hex')
}

/** Encrypt a sensitive string for storage at rest. Plaintext passthrough if no key. */
export function encryptPii(value) {
  const text = String(value || '')
  if (!text) return ''
  const key = keyMaterial()
  if (!key) return text
  if (text.startsWith(PREFIX)) return text
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`
}

/** Decrypt a value previously stored with encryptPii. */
export function decryptPii(value) {
  const text = String(value || '')
  if (!text.startsWith(PREFIX)) return text
  const key = keyMaterial()
  if (!key) {
    const err = new Error('PII encrypted but PII_ENCRYPTION_KEY is missing')
    err.status = 500
    throw err
  }
  const body = text.slice(PREFIX.length)
  const [ivB64, tagB64, dataB64] = body.split('.')
  if (!ivB64 || !tagB64 || !dataB64) return ''
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ])
  return plain.toString('utf8')
}

/** Encrypt email (+ optional notes) on a worker document for DB persistence. */
export function sealWorkerPii(worker) {
  if (!worker || !piiEncryptionEnabled()) return worker
  const next = { ...worker }
  if (next.email) {
    next.emailLookup = piiLookupHash(next.email)
    next.email = encryptPii(next.email)
  }
  if (next.managerNotes) {
    next.managerNotes = encryptPii(next.managerNotes)
  }
  if (next.phone) {
    next.phoneLookup = piiLookupHash(next.phone)
    // Keep searchable phone for login compatibility; add sealed copy.
    next.phoneSealed = encryptPii(next.phone)
  }
  return next
}

/** Decrypt worker fields for API responses. */
export function openWorkerPii(worker) {
  if (!worker) return worker
  const next = { ...worker }
  if (typeof next.email === 'string' && next.email.startsWith(PREFIX)) {
    next.email = decryptPii(next.email)
  }
  if (typeof next.managerNotes === 'string' && next.managerNotes.startsWith(PREFIX)) {
    next.managerNotes = decryptPii(next.managerNotes)
  }
  delete next.emailLookup
  delete next.phoneLookup
  delete next.phoneSealed
  return next
}
