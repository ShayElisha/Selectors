import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
} from 'node:crypto'

const LEGACY_PREFIX = 'enc:v1:'
const PREFIX = 'enc:v2:'
const MIN_KEY_LENGTH = 32

export function isPiiEncryptionEnabled() {
  return process.env.PII_ENCRYPTION_ENABLED !== 'false'
}

function isProductionRuntime() {
  return (
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.VERCEL || process.env.VERCEL_URL)
  )
}

function configuredKeys() {
  const rawRing = String(process.env.PII_ENCRYPTION_KEYS || '').trim()
  let keys = {}
  if (rawRing) {
    try {
      const parsed = JSON.parse(rawRing)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error()
      }
      keys = Object.fromEntries(
        Object.entries(parsed).map(([id, value]) => [
          String(id).trim(),
          String(value || '').trim(),
        ]),
      )
    } catch {
      throw new Error('PII_ENCRYPTION_KEYS must be a JSON object of key IDs to secrets')
    }
  } else {
    const legacy = String(
      process.env.PII_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '',
    ).trim()
    if (legacy) {
      if (legacy.length < 16) {
        throw new Error('Legacy PII key must be at least 16 characters')
      }
      keys = { legacy }
    }
  }

  for (const [id, value] of Object.entries(keys)) {
    if (!id || value.length < MIN_KEY_LENGTH) {
      throw new Error(
        `PII encryption key "${id || '(empty id)'}" must be at least ${MIN_KEY_LENGTH} characters`,
      )
    }
  }
  return keys
}

function activeKeyId(keys) {
  const requested = String(process.env.PII_ENCRYPTION_ACTIVE_KEY_ID || '').trim()
  if (requested) {
    if (!keys[requested]) {
      throw new Error('PII_ENCRYPTION_ACTIVE_KEY_ID must match a key in PII_ENCRYPTION_KEYS')
    }
    return requested
  }
  return Object.keys(keys)[0] || ''
}

function keyMaterial(secret, purpose) {
  return scryptSync(secret, `getin-pii-${purpose}-v2`, 32)
}

function keyRing() {
  const keys = configuredKeys()
  const activeId = activeKeyId(keys)
  return {
    activeId,
    keys: Object.fromEntries(
      Object.entries(keys).map(([id, secret]) => [
        id,
        keyMaterial(secret, 'encryption'),
      ]),
    ),
  }
}

export function assertPiiEncryptionConfigured() {
  if (!isPiiEncryptionEnabled()) return false
  const ring = keyRing()
  const activeSecret = configuredKeys()[ring.activeId] || ''
  if (
    (!ring.activeId || activeSecret.length < MIN_KEY_LENGTH) &&
    isProductionRuntime()
  ) {
    throw new Error(
      'A random PII_ENCRYPTION_KEYS key of at least 32 characters is required in production',
    )
  }
  return Boolean(ring.activeId && activeSecret.length >= MIN_KEY_LENGTH)
}

/** Deterministic lookup token (not reversible), derived from the active key. */
export function piiLookupHash(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || !isPiiEncryptionEnabled()) return ''
  const ring = keyRing()
  if (!ring.activeId || configuredKeys()[ring.activeId].length < MIN_KEY_LENGTH) {
    throw new Error('PII encryption key is required to create lookup hashes')
  }
  return createHmac('sha256', ring.keys[ring.activeId])
    .update(`lookup:${normalized}`)
    .digest('hex')
}

export function piiLookupCandidates(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || !isPiiEncryptionEnabled()) return []
  const keys = configuredKeys()
  const hashes = new Set([piiLookupHash(value)])
  for (const secret of Object.values(keys)) {
    const legacyKey = scryptSync(secret, 'getin-pii-v1', 32)
    hashes.add(createHmac('sha256', legacyKey).update(normalized).digest('hex'))
  }
  return [...hashes]
}

function decryptVersionOne(text) {
  const body = text.slice(LEGACY_PREFIX.length)
  const [ivB64, tagB64, dataB64] = body.split('.')
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid legacy PII ciphertext')
  }
  const legacySecret = String(
    process.env.PII_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '',
  ).trim()
  if (!legacySecret || legacySecret.length < 16) {
    throw new Error('Legacy PII key is required to decrypt enc:v1 data')
  }
  const key = scryptSync(legacySecret, 'getin-pii-v1', 32)
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** Encrypt with the active key; old ciphertext is rewrapped during key rotation. */
export function encryptPii(value) {
  const text = String(value || '')
  if (!text) return ''
  if (!isPiiEncryptionEnabled()) return text
  const ring = keyRing()
  if (!ring.activeId || configuredKeys()[ring.activeId].length < MIN_KEY_LENGTH) {
    throw new Error('PII encryption key is required before storing personal information')
  }
  const plain =
    text.startsWith(LEGACY_PREFIX)
      ? decryptVersionOne(text)
      : text.startsWith(PREFIX)
        ? decryptPii(text)
        : text
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', ring.keys[ring.activeId], iv)
  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ])
  return `${PREFIX}${ring.activeId}.${iv.toString('base64url')}.${cipher
    .getAuthTag()
    .toString('base64url')}.${encrypted.toString('base64url')}`
}

/** Decrypt a stored value using its key ID, or the legacy v1 key. */
export function decryptPii(value) {
  const text = String(value || '')
  if (!isPiiEncryptionEnabled()) return text
  if (text.startsWith(LEGACY_PREFIX)) {
    return decryptVersionOne(text)
  }
  if (!text.startsWith(PREFIX)) return text
  const ring = keyRing()
  const body = text.slice(PREFIX.length)
  const [id, ivB64, tagB64, dataB64] = body.split('.')
  const key = ring.keys[id]
  if (!key || !ivB64 || !tagB64 || !dataB64) {
    throw new Error(`PII decryption key "${id || ''}" is missing or ciphertext is invalid`)
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function isPiiEncrypted(value) {
  return (
    typeof value === 'string' &&
    (value.startsWith(PREFIX) || value.startsWith(LEGACY_PREFIX))
  )
}

/** Encrypt email, phone and manager notes on a worker document for DB storage. */
export function sealWorkerPii(worker) {
  if (!worker) return worker
  const next = { ...worker }
  if (!isPiiEncryptionEnabled()) {
    delete next.emailLookup
    delete next.phoneLookup
    delete next.phoneSealed
    return next
  }
  for (const field of ['email', 'phone', 'managerNotes']) {
    if (next[field]) {
      const clear = isPiiEncrypted(next[field])
        ? decryptPii(next[field])
        : String(next[field])
      if (field === 'email') next.emailLookup = piiLookupHash(clear)
      if (field === 'phone') next.phoneLookup = piiLookupHash(clear)
      next[field] = encryptPii(clear)
    }
  }
  delete next.phoneSealed
  return next
}

/** Decrypt worker fields for API responses. */
export function openWorkerPii(worker) {
  if (!worker) return worker
  const next = { ...worker }
  if (!isPiiEncryptionEnabled()) {
    delete next.emailLookup
    delete next.phoneLookup
    delete next.phoneSealed
    return next
  }
  for (const field of ['email', 'phone', 'managerNotes']) {
    if (isPiiEncrypted(next[field])) next[field] = decryptPii(next[field])
  }
  delete next.emailLookup
  delete next.phoneLookup
  delete next.phoneSealed
  return next
}
