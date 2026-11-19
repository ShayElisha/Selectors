import { afterEach, describe, expect, it, vi } from 'vitest'

describe('piiCrypto', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('fails closed when no encryption key is configured', async () => {
    vi.stubEnv('PII_ENCRYPTION_KEY', '')
    vi.stubEnv('PII_ENCRYPTION_KEYS', '')
    const { encryptPii, assertPiiEncryptionConfigured } =
      await import('./piiCrypto.js')
    expect(assertPiiEncryptionConfigured()).toBe(false)
    expect(() => encryptPii('a@b.com')).toThrow(/key is required/)
  })

  it('encrypts worker phone, email and notes without storing plaintext', async () => {
    vi.stubEnv('PII_ENCRYPTION_KEYS', '')
    vi.stubEnv('PII_ENCRYPTION_KEY', 'unit-test-secret-key-that-is-at-least-32')
    const { sealWorkerPii, openWorkerPii } = await import('./piiCrypto.js')
    const worker = {
      id: '1',
      email: 'boss@example.com',
      phone: '0501234567',
      managerNotes: 'private',
    }
    const sealed = sealWorkerPii(worker)
    expect(sealed.email).toMatch(/^enc:v2:/)
    expect(sealed.phone).toMatch(/^enc:v2:/)
    expect(sealed.managerNotes).toMatch(/^enc:v2:/)
    expect(sealed.phone).not.toContain('0501234567')
    expect(sealed.phoneLookup).toBeTruthy()
    expect(sealed.phoneSealed).toBeUndefined()
    expect(openWorkerPii(sealed)).toMatchObject(worker)
  })

  it('decrypts with a retained old key and rewraps to the active key', async () => {
    vi.stubEnv(
      'PII_ENCRYPTION_KEYS',
      JSON.stringify({ old: 'old-encryption-key-which-is-at-least-32', active: 'new-encryption-key-which-is-at-least-32' }),
    )
    vi.stubEnv('PII_ENCRYPTION_ACTIVE_KEY_ID', 'old')
    const crypto = await import('./piiCrypto.js')
    const oldCiphertext = crypto.encryptPii('0501234567')
    expect(oldCiphertext).toMatch(/^enc:v2:old\./)

    vi.stubEnv('PII_ENCRYPTION_ACTIVE_KEY_ID', 'active')
    expect(crypto.decryptPii(oldCiphertext)).toBe('0501234567')
    expect(crypto.encryptPii(oldCiphertext)).toMatch(/^enc:v2:active\./)
  })
})
