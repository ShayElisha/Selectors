import { afterEach, describe, expect, it, vi } from 'vitest'

describe('piiCrypto', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('passes through when no key is configured', async () => {
    vi.stubEnv('PII_ENCRYPTION_KEY', '')
    const { encryptPii, decryptPii, piiEncryptionEnabled } = await import('./piiCrypto.js')
    expect(piiEncryptionEnabled()).toBe(false)
    expect(encryptPii('a@b.com')).toBe('a@b.com')
    expect(decryptPii('a@b.com')).toBe('a@b.com')
  })

  it('round-trips encrypted values when a key is set', async () => {
    vi.stubEnv('PII_ENCRYPTION_KEY', 'unit-test-secret-key!!')
    const { encryptPii, decryptPii, piiEncryptionEnabled, sealWorkerPii, openWorkerPii } =
      await import('./piiCrypto.js')
    expect(piiEncryptionEnabled()).toBe(true)
    const sealed = encryptPii('secret@example.com')
    expect(sealed.startsWith('enc:v1:')).toBe(true)
    expect(decryptPii(sealed)).toBe('secret@example.com')

    const worker = sealWorkerPii({
      id: '1',
      email: 'boss@example.com',
      phone: '0501234567',
      managerNotes: 'private',
    })
    expect(worker.email.startsWith('enc:v1:')).toBe(true)
    expect(worker.managerNotes.startsWith('enc:v1:')).toBe(true)
    expect(worker.phone).toBe('0501234567')
    const opened = openWorkerPii(worker)
    expect(opened.email).toBe('boss@example.com')
    expect(opened.managerNotes).toBe('private')
  })
})
