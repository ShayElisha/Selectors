import nodemailer from 'nodemailer'
import {
  appDisplayName,
  buildTempPasswordEmail,
  buildTestEmail,
  logoAttachment,
} from './emailLayout.js'

export function isSmtpConfigured() {
  return Boolean(
    String(process.env.SMTP_HOST || '').trim() &&
      smtpUser() &&
      smtpPass(),
  )
}

function smtpConfigured() {
  return isSmtpConfigured()
}

function smtpPass() {
  // Gmail App Passwords are often pasted with spaces; strip them.
  return String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '')
    .trim()
    .replace(/\s+/g, '')
}

function smtpUser() {
  return String(process.env.SMTP_USER || '').trim()
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 587)
  const user = smtpUser()
  const pass = smtpPass()
  return nodemailer.createTransport({
    host: String(process.env.SMTP_HOST || '').trim(),
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  })
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string, attachments?: object[] }} opts
 */
export async function sendMail({ to, subject, text, html, attachments }) {
  if (!to) {
    const err = new Error('כתובת מייל חסרה')
    err.status = 400
    throw err
  }
  if (!smtpConfigured()) {
    const onVercel = Boolean(process.env.VERCEL || process.env.VERCEL_URL)
    if (!onVercel) {
      console.warn(
        `[mail] SMTP לא מוגדר — המייל לא נשלח אל ${to}\nנושא: ${subject}\n${text}`,
      )
      return { queued: false, devLogged: true }
    }
    const err = new Error(
      'שליחת מייל אינה מוגדרת בשרת — יש להגדיר SMTP_HOST, SMTP_USER ו־SMTP_PASS ב-Vercel',
    )
    err.status = 503
    throw err
  }

  const from =
    process.env.SMTP_FROM ||
    `${appDisplayName()} <${process.env.SMTP_USER}>`

  const transporter = createTransport()
  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html: html || undefined,
      attachments: attachments?.length ? attachments : undefined,
    })
    return { queued: true, devLogged: false }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[mail] send failed', detail)
    const e = new Error(
      /Invalid login|Username and Password not accepted|EAUTH/i.test(detail)
        ? 'אימות SMTP נכשל — בדקו SMTP_USER ו־SMTP_PASS (App Password של Gmail)'
        : 'שליחת המייל נכשלה',
    )
    e.status = 502
    e.cause = err
    throw e
  } finally {
    transporter.close?.()
  }
}

function withLogoAttachments() {
  // On Vercel use hosted /gate-out-logo.png (via APP_URL / VERCEL_URL) — no CID file needed.
  if (process.env.VERCEL || process.env.VERCEL_URL || process.env.APP_URL) {
    return []
  }
  const logo = logoAttachment()
  return logo ? [logo] : []
}

/**
 * @param {{ to: string, fullName: string, tempPassword: string, reason: 'invite' | 'reset' }} opts
 */
export async function sendTempPasswordEmail({
  to,
  fullName,
  tempPassword,
  reason,
}) {
  const built = buildTempPasswordEmail({ fullName, tempPassword, reason })
  return sendMail({
    to,
    subject: built.subject,
    text: built.text,
    html: built.html,
    attachments: withLogoAttachments(),
  })
}

/**
 * @param {{ to?: string }} [opts]
 */
export async function sendTestEmail(opts = {}) {
  const to = String(
    opts.to || process.env.SMTP_USER || process.env.SMTP_FROM || '',
  )
    .replace(/.*<([^>]+)>.*/, '$1')
    .trim()
  if (!to) {
    const err = new Error('SMTP_USER לא מוגדר — אין יעד לבדיקה')
    err.status = 400
    throw err
  }
  const built = buildTestEmail()
  return sendMail({
    to,
    subject: built.subject,
    text: built.text,
    html: built.html,
    attachments: withLogoAttachments(),
  })
}
