import { setDefaultResultOrder } from 'node:dns'
import nodemailer from 'nodemailer'
import {
  appDisplayName,
  buildModulesOpenedEmail,
  buildLoginCodeEmail,
  buildNewOrganizationAdminEmail,
  buildOrganizationApprovedEmail,
  buildOrganizationCreatedEmail,
  buildOrganizationRejectedEmail,
  buildTempPasswordEmail,
  buildTestEmail,
  logoAttachment,
} from './emailLayout.js'

// Gmail frequently fails TLS handshake over IPv6 (alert 80); prefer IPv4.
setDefaultResultOrder('ipv4first')

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

/** Mailbox we are allowed to send as. Display name always follows the app, never a mistyped SMTP_FROM. */
function mailboxAddress() {
  const configured = String(process.env.MAIL_FROM || process.env.SMTP_FROM || '').trim()
  const wrapped = configured.match(/<([^>]+)>/)
  const embedded = wrapped?.[1]?.trim()
  if (embedded?.includes('@')) return embedded
  if (configured.includes('@') && !configured.includes('<')) return configured
  return smtpUser()
}

function brandedFromAddress() {
  return `${appDisplayName()} <${mailboxAddress()}>`
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 587)
  const host = String(process.env.SMTP_HOST || '').trim()
  const user = smtpUser()
  const pass = smtpPass()
  const secure = port === 465
  return nodemailer.createTransport({
    host,
    port,
    secure,
    // Gmail often answers TLS alert 80 over IPv6; force IPv4 + TLS 1.2.
    family: 4,
    requireTLS: !secure,
    auth: user && pass ? { user, pass } : undefined,
    tls: {
      minVersion: 'TLSv1.2',
      servername: host,
    },
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

  const from = brandedFromAddress()

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
        : /tlsv1 alert internal error|SSL alert number 80|EPROTO|ssl3_read_bytes/i.test(
              detail,
            )
          ? 'חיבור TLS לשרת המייל נכשל (לרוב Gmail/IPv6) — בדקו SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, App Password, ושהרשת לא חוסמת SMTP'
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
 * @param {{ to: string, fullName: string, code: string }} opts
 */
export async function sendLoginCodeEmail({ to, fullName, code }) {
  const built = buildLoginCodeEmail({ fullName, code })
  return sendMail({
    to,
    subject: built.subject,
    text: built.text,
    html: built.html,
    attachments: withLogoAttachments(),
  })
}

/**
 * @param {{ to: string, fullName: string, organizationName: string }} opts
 */
export async function sendOrganizationCreatedEmail({
  to,
  fullName,
  organizationName,
}) {
  const built = buildOrganizationCreatedEmail({ fullName, organizationName })
  return sendMail({
    to,
    subject: built.subject,
    text: built.text,
    html: built.html,
    attachments: withLogoAttachments(),
  })
}

/**
 * @param {{ to: string, fullName: string, organizationName: string }} opts
 */
export async function sendOrganizationRejectedEmail(opts) {
  const built = buildOrganizationRejectedEmail(opts)
  return sendMail({
    to: opts.to,
    subject: built.subject,
    text: built.text,
    html: built.html,
    attachments: withLogoAttachments(),
  })
}

export async function sendModulesOpenedEmail(opts) {
  const built = buildModulesOpenedEmail(opts)
  return sendMail({
    to: opts.to,
    subject: built.subject,
    text: built.text,
    html: built.html,
    attachments: withLogoAttachments(),
  })
}

export async function sendNewOrganizationAdminEmail(opts) {
  const to = String(process.env.SUPER_ADMIN_EMAIL || process.env.SMTP_USER || '').trim()
  if (!to) return { queued: false, devLogged: true }
  const built = buildNewOrganizationAdminEmail(opts)
  return sendMail({
    to,
    subject: built.subject,
    text: built.text,
    html: built.html,
    attachments: withLogoAttachments(),
  })
}

export async function sendOrganizationApprovedEmail({
  to,
  fullName,
  organizationName,
}) {
  const built = buildOrganizationApprovedEmail({ fullName, organizationName })
  return sendMail({
    to,
    subject: built.subject,
    text: built.text,
    html: built.html,
    attachments: withLogoAttachments(),
  })
}

export async function sendTestEmail({ to: requestedTo } = {}) {
  const to = String(
    requestedTo ||
      process.env.SUPER_ADMIN_EMAIL ||
      process.env.SMTP_USER ||
      process.env.SMTP_FROM ||
      '',
  )
    .replace(/.*<([^>]+)>.*/, '$1')
    .trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    const err = new Error(
      'יש להגדיר כתובת יעד תקינה באמצעות SUPER_ADMIN_EMAIL או SMTP_USER',
    )
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
