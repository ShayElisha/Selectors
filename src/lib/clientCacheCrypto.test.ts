import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearClientCacheKey,
  decryptClientPayload,
  encryptClientPayload,
  isEncryptedClientPayload,
} from './clientCacheCrypto'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
  }
}

describe('clientCacheCrypto', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    clearClientCacheKey()
  })

  afterEach(() => {
    clearClientCacheKey()
    vi.unstubAllGlobals()
  })

  it('encrypts and decrypts a JSON payload', async () => {
    const encrypted = await encryptClientPayload({ hello: 'שלום', n: 1 })
    expect(encrypted).toBeTruthy()
    expect(isEncryptedClientPayload(encrypted)).toBe(true)
    expect(encrypted).not.toContain('שלום')

    const decrypted = await decryptClientPayload<{ hello: string; n: number }>(
      encrypted!,
    )
    expect(decrypted).toEqual({ hello: 'שלום', n: 1 })
  })

  it('rejects plaintext payloads', async () => {
    expect(await decryptClientPayload('{"a":1}')).toBeNull()
  })
})
