import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'
import { isSmtpConfigured, sendMail } from './mail.js'

function clip(value, max) {
  return String(value || '').trim().slice(0, max)
}

function reportRecipient() {
  const explicit = String(process.env.BUG_REPORT_EMAIL || '').trim()
  if (explicit.includes('@')) return explicit
  const configured = String(process.env.MAIL_FROM || process.env.SMTP_FROM || '').trim()
  const wrapped = configured.match(/<([^>]+)>/)
  const embedded = wrapped?.[1]?.trim()
  if (embedded?.includes('@')) return embedded
  if (configured.includes('@') && !configured.includes('<')) return configured
  const user = String(process.env.SMTP_USER || '').trim()
  return user.includes('@') ? user : ''
}

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

/**
 * @param {{
 *   title?: string,
 *   details?: string,
 *   where?: string,
 *   contactName?: string,
 *   contactPhone?: string,
 *   user?: { id?: string, fullName?: string, phone?: string, orgId?: string | null, orgName?: string | null, module?: string | null, role?: string } | null,
 * }} input
 */
export async function submitBugReport(input) {
  const title = clip(input.title, 120)
  const details = clip(input.details, 4000)
  const where = clip(input.where, 200)
  const user = input.user
  const contactName = clip(user?.fullName || input.contactName, 80)
  const contactPhone = clip(user?.phone || input.contactPhone, 20)
  if (title.length < 3) throw httpError('נא לכתוב כותרת קצרה', 400)
  if (details.length < 10) throw httpError('נא לתאר את התקלה בכמה משפטים', 400)
  if (!contactName || !contactPhone) throw httpError('נא להשאיר שם וטלפון', 400)

  const doc = {
    _id: randomUUID(),
    at: new Date().toISOString(),
    title,
    details,
    where,
    contactName,
    contactPhone,
    orgId: user?.orgId || null,
    orgName: user?.orgName || null,
    module: user?.module || null,
    userId: user?.id || null,
    role: user?.role || null,
    emailed: false,
    handled: false,
  }
  const db = await getDb()
  await db.collection('bug_reports').insertOne(doc)

  const to = reportRecipient()
  let emailed = false
  if (to && isSmtpConfigured()) {
    const text = [
      `כותרת: ${title}`,
      where ? `מיקום: ${where}` : '',
      `שם: ${contactName}`,
      `טלפון: ${contactPhone}`,
      user?.orgName ? `ארגון: ${user.orgName}` : '',
      user?.module ? `חלקה: ${user.module}` : '',
      '',
      details,
    ]
      .filter((line) => line !== '')
      .join('\n')
    try {
      const result = await sendMail({
        to,
        subject: `דיווח תקלה · ${title}`,
        text,
      })
      emailed = Boolean(result?.queued)
    } catch (err) {
      console.error('[bug-report] mail failed', err?.message || err)
    }
    if (emailed) {
      await db.collection('bug_reports').updateOne({ _id: doc._id }, { $set: { emailed: true } })
    }
  }

  return { ok: true, emailed }
}

function publicBugReport(doc) {
  return {
    id: String(doc._id),
    at: String(doc.at || ''),
    title: String(doc.title || ''),
    details: String(doc.details || ''),
    where: String(doc.where || ''),
    contactName: String(doc.contactName || ''),
    contactPhone: String(doc.contactPhone || ''),
    orgName: doc.orgName ? String(doc.orgName) : '',
    handled: doc.handled === true,
    handledAt: doc.handledAt ? String(doc.handledAt) : '',
  }
}

export async function listBugReports() {
  const db = await getDb()
  const rows = await db.collection('bug_reports').find({}).sort({ at: -1 }).limit(200).toArray()
  return rows.map(publicBugReport)
}

export async function setBugReportHandled(id, handled) {
  const db = await getDb()
  const next = handled === true
  const result = await db.collection('bug_reports').updateOne(
    { _id: String(id) },
    next
      ? { $set: { handled: true, handledAt: new Date().toISOString() } }
      : { $set: { handled: false }, $unset: { handledAt: '' } },
  )
  if (!result.matchedCount) throw httpError('הדיווח לא נמצא', 404)
  const doc = await db.collection('bug_reports').findOne({ _id: String(id) })
  return publicBugReport(doc)
}
