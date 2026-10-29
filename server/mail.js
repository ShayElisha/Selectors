import { lookup as dnsLookup, setDefaultResultOrder } from 'node:dns'
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

function smtpHost() {
  return String(process.env.SMTP_HOST || '').trim()
}

function configuredSmtpPort() {
  return Number(process.env.SMTP_PORT || 587)
}

function isTlsInternalAlert(detail) {
  return /tlsv1 alert internal error|SSL alert number 80|EPROTO|ssl3_read_bytes|wrong version number/i.test(
    String(detail || ''),
  )
}

/** Resolve SMTP host to IPv4 only — nodemailer's family option is not always enough. */
function ipv4Lookup(hostname, _options, callback) {
  dnsLookup(hostname, { family: 4, all: false }, callback)
}

/**
 * @param {{ port?: number, secure?: boolean }} [opts]
 */
export function createTransport(opts = {}) {
  const host = smtpHost()
  const port = Number(opts.port ?? configuredSmtpPort())
  const secure = opts.secure ?? port === 465
  const user = smtpUser()
  const pass = smtpPass()
  return nodemailer.createTransport({
    host,
    port,
    secure,
    // Gmail often answers TLS alert 80 over IPv6; force IPv4 + TLS 1.2.
    family: 4,
    lookup: ipv4Lookup,
    requireTLS: !secure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: user && pass ? { user, pass } : undefined,
    tls: {
      minVersion: 'TLSv1.2',
      servername: host,
    },
  })
}

function transportAttempts() {
  const primaryPort = configuredSmtpPort()
  const primarySecure = primaryPort === 465
  const attempts = [{ port: primaryPort, secure: primarySecure }]
  // If STARTTLS (587) fails with TLS alert 80, Gmail SMTPS (465) often still works.
  if (primaryPort !== 465) {
    attempts.push({ port: 465, secure: true })
  } else if (primaryPort !== 587) {
    attempts.push({ port: 587, secure: false })
  }
  return attempts
}

function mapSendError(err) {
  const detail = err instanceof Error ? err.message : String(err)
  if (/Invalid login|Username and Password not accepted|EAUTH/i.test(detail)) {
    return 'אימות SMTP נכשל — בדקו SMTP_USER ו־SMTP_PASS (App Password של Gmail)'
  }
  if (isTlsInternalAlert(detail)) {
    return 'חיבור TLS לשרת המייל נכשל — המערכת ניסתה IPv4 ופורט חלופי; בדקו App Password וחסימות רשת ל־smtp.gmail.com'
  }
  return 'שליחת המייל נכשלה'
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
  const payload = {
    from,
    to,
    subject,
    text,
    html: html || undefined,
    attachments: attachments?.length ? attachments : undefined,
  }

  let lastError = null
  for (const attempt of transportAttempts()) {
    const transporter = createTransport(attempt)
    try {
      await transporter.sendMail(payload)
      return { queued: true, devLogged: false }
    } catch (err) {
      lastError = err
      const detail = err instanceof Error ? err.message : String(err)
      console.error(
        `[mail] send failed via ${smtpHost()}:${attempt.port}`,
        detail,
      )
      if (!isTlsInternalAlert(detail)) break
    } finally {
      transporter.close?.()
    }
  }

  const e = new Error(mapSendError(lastError))
  e.status = 502
  e.cause = lastError
  throw e
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
