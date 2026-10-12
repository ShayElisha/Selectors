import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createTransport, sendMail, close } = vi.hoisted(() => {
  const sendMail = vi.fn(async () => ({ messageId: 'test-message' }))
  const close = vi.fn()
  const createTransport = vi.fn(() => ({ sendMail, close }))
  return { createTransport, sendMail, close }
})

vi.mock('nodemailer', () => ({ default: { createTransport } }))

import { sendTestEmail } from './mail.js'

describe('test email destination', () => {
  beforeEach(() => {
    vi.stubEnv('SMTP_HOST', 'smtp.example.com')
    vi.stubEnv('SMTP_USER', 'smtp-user@example.com')
    vi.stubEnv('SMTP_PASS', 'smtp-password')
    vi.stubEnv('SMTP_FROM', '')
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super-admin@example.com')
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends the test to the configured super-admin email by default', async () => {
    await sendTestEmail()

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'super-admin@example.com' }),
    )
    expect(close).toHaveBeenCalledOnce()
  })

  it('allows the local mail-test script to specify a destination', async () => {
    await sendTestEmail({ to: 'ops@example.com' })

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ops@example.com' }),
    )
  })

  it('rejects an invalid test destination', async () => {
    await expect(sendTestEmail({ to: 'invalid' })).rejects.toMatchObject({
      status: 400,
    })
    expect(createTransport).not.toHaveBeenCalled()
  })
})
