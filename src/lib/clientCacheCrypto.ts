/** Browser-side AES-GCM helpers for encrypted client caches. */

const KEY_SESSION = 'shibutzon.client-cache.aes-v1'
const ENC_PREFIX = 'enc:v1:'

let memoryKeyB64: string | null = null

function bytesToB64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]!)
  return btoa(binary)
}

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function readStoredKeyMaterial(): string | null {
  if (memoryKeyB64) return memoryKeyB64
  try {
    const fromSession = sessionStorage.getItem(KEY_SESSION)
    if (fromSession) {
      memoryKeyB64 = fromSession
      return fromSession
    }
  } catch {
    /* private mode */
  }
  return null
}

function writeStoredKeyMaterial(b64: string): void {
  memoryKeyB64 = b64
  try {
    sessionStorage.setItem(KEY_SESSION, b64)
  } catch {
    /* private mode — memory key still works for this tab life */
  }
}

async function importAesKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    b64ToBytes(b64),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Create or restore the per-tab AES key (never written to localStorage). */
export async function getClientCacheKey(): Promise<CryptoKey | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  const existing = readStoredKeyMaterial()
  if (existing) {
    try {
      return await importAesKey(existing)
    } catch {
      memoryKeyB64 = null
      try {
        sessionStorage.removeItem(KEY_SESSION)
      } catch {
        /* ignore */
      }
    }
  }
  try {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
    const raw = await crypto.subtle.exportKey('raw', key)
    writeStoredKeyMaterial(bytesToB64(raw))
    return key
  } catch {
    return null
  }
}

export function clearClientCacheKey(): void {
  memoryKeyB64 = null
  try {
    sessionStorage.removeItem(KEY_SESSION)
  } catch {
    /* private mode */
  }
}

export function isEncryptedClientPayload(raw: string | null | undefined): boolean {
  return Boolean(raw && raw.startsWith(ENC_PREFIX))
}

export async function encryptClientPayload(value: unknown): Promise<string | null> {
  const key = await getClientCacheKey()
  if (!key) return null
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plain = new TextEncoder().encode(JSON.stringify(value))
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
    return `${ENC_PREFIX}${bytesToB64(iv)}.${bytesToB64(cipher)}`
  } catch {
    return null
  }
}

export async function decryptClientPayload<T>(raw: string): Promise<T | null> {
  if (!isEncryptedClientPayload(raw)) return null
  const key = await getClientCacheKey()
  if (!key) return null
  try {
    const body = raw.slice(ENC_PREFIX.length)
    const [ivB64, cipherB64] = body.split('.')
    if (!ivB64 || !cipherB64) return null
    const iv = b64ToBytes(ivB64)
    const cipher = b64ToBytes(cipherB64)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    return null
  }
}
