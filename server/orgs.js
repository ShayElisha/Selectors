import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { getAuditCollection, getDb, getMetaCollection, withDbTransaction } from './db.js'
import { appendAuditLog } from './audit.js'
import {
  sendModulesOpenedEmail,
  sendNewOrganizationAdminEmail,
  sendOrganizationApprovedEmail,
  sendOrganizationCreatedEmail,
  sendOrganizationRejectedEmail,
  sendTempPasswordEmail,
} from './mail.js'
import {
  generateTempPassword,
  hashPassword,
  tempPasswordExpired,
  tempPasswordExpiresAt,
  validatePasswordRules,
  verifyPassword,
} from './password.js'

const ORG_COLLECTION = 'organizations'
const ACCOUNT_COLLECTION = 'accounts'
const OPERATIONAL_COLLECTIONS = [
  'workers',
  'lanes',
  'shifts',
  'certifications',
  'briefing_sections',
  'questions',
  'customs_brokers',
  'shift_models',
]

export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))
}

function passwordsMatch(left, right) {
  const a = createHash('sha256').update(String(left)).digest()
  const b = createHash('sha256').update(String(right)).digest()
  return timingSafeEqual(a, b)
}

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

function emptyModules() {
  return { selectors: false, inspectors: false }
}

function publicModules(modules) {
  return {
    selectors: Boolean(modules?.selectors),
    inspectors: Boolean(modules?.inspectors),
  }
}

function defaultModule(modules) {
  if (modules?.selectors) return 'selectors'
  if (modules?.inspectors) return 'inspectors'
  return null
}

async function organizations() {
  const db = await getDb()
  return db.collection(ORG_COLLECTION)
}

async function accounts() {
  const db = await getDb()
  return db.collection(ACCOUNT_COLLECTION)
}

export async function ensureOrgIndexes() {
  const accountCol = await accounts()
  await accountCol.createIndex({ phone: 1 }, { unique: true })
  const orgCol = await organizations()
  await orgCol.createIndex(
    { legacy: 1 },
    { unique: true, partialFilterExpression: { legacy: true } },
  )
}

export async function getOrganization(id) {
  if (!id) return null
  const col = await organizations()
  return col.findOne({ _id: String(id) })
}

async function findAccountByPhone(phone) {
  const col = await accounts()
  return col.findOne({ phone: normalizePhone(phone) })
}

function modulesForAccount(account, org) {
  const enabled = publicModules(org.modules)
  if (account?.isOrgManager) return enabled
  if (account?.staffKind === 'inspector') {
    return { selectors: false, inspectors: enabled.inspectors }
  }
  return { selectors: enabled.selectors, inspectors: false }
}

function isLegacySiteManager(account) {
  const phone = normalizePhone(account?.phone)
  return account?.fullName === 'שי אלישע' || phone === '0537171884'
}

/** The original inspectors manager is an organization manager and sees every open module. */
async function recognizeModuleOrgManager(account, org) {
  if (!account || account.isOrgManager || !isLegacySiteManager(account)) return account
  if (account.staffKind !== 'inspector') return account
  if (!process.env.MONGODB_URI_INSPECTORS?.trim()) return account
  const db = await getDb('inspectors')
  const phone = normalizePhone(account.phone)
  const workers = await db
    .collection('workers')
    .find({ orgId: String(org._id), module: 'inspectors' })
    .toArray()
  const worker = workers.find((item) => normalizePhone(item.phone) === phone)
  if (!worker) return account
  if (worker && !worker.isOrgManager) {
    await db.collection('workers').updateOne(
      { _id: worker._id },
      { $set: { isOrgManager: true, isManager: true } },
    )
  }
  const accountCol = await accounts()
  await accountCol.updateOne({ _id: account._id }, { $set: { isOrgManager: true } })
  return { ...account, isOrgManager: true }
}

export async function refreshManagerSession(user) {
  if (!user?.orgId || user.role !== 'org_manager') {
    throw httpError('נדרשת התחברות', 401)
  }
  const org = await getOrganization(user.orgId)
  if (!org) throw httpError('הארגון נמחק. יש להתחבר מחדש.', 401)
  const accountCol = await accounts()
  let account =
    (await accountCol.findOne({ _id: String(user.id), orgId: String(user.orgId) })) ||
    (await accountCol.findOne({
      phone: normalizePhone(user.phone),
      orgId: String(user.orgId),
    }))
  if (!account || account.status === 'inactive') {
    throw httpError('אין הרשאת מנהל למספר זה', 401)
  }
  account = await recognizeModuleOrgManager(account, org)
  const session = sessionFromAccount(account, org)
  if (user.module && session.modules[user.module]) session.module = user.module
  return session
}

function sessionFromAccount(account, org) {
  const modules = modulesForAccount(account, org)
  return {
    id: String(account._id),
    fullName: account.fullName || '',
    phone: account.phone,
    role: 'org_manager',
    orgId: String(org._id),
    orgName: org.name || '',
    modules,
    module: defaultModule(modules),
    isOrgManager: Boolean(account.isOrgManager),
    staffKind: account.staffKind === 'inspector' ? 'inspector' : 'selector',
  }
}

function orgGate(org, modules = publicModules(org?.modules)) {
  if (org?.deletedAt) {
    return {
      next: 'rejected',
      message: 'הארגון נמחק. אפשר לפנות לסופר אדמין.',
    }
  }
  if (!org || org.status === 'rejected') {
    return {
      next: 'rejected',
      message: 'בקשת הארגון נדחתה. אפשר לפנות לסופר אדמין.',
    }
  }
  if (org.status === 'suspended') {
    return {
      next: 'suspended',
      message: 'הגישה לארגון מושעית. אפשר לפנות לסופר אדמין.',
    }
  }
  if (org.status !== 'approved') {
    return {
      next: 'pending_approval',
      message: 'הארגון ממתין לאישור סופר אדמין. אחרי האישור אפשר להיכנס.',
    }
  }
  if (!modules.selectors && !modules.inspectors) {
    return {
      next: 'no_modules',
      message: 'הארגון אושר, ועדיין לא נפתח מודול. סופר אדמין צריך לבחור סלקטורים או בודקים.',
    }
  }
  return null
}

function superAdminIdentity(phone) {
  const configured = normalizePhone(process.env.SUPER_ADMIN_PHONE || '')
  const password = process.env.SUPER_ADMIN_PASSWORD || ''
  if (!configured || !password) return null
  if (normalizePhone(phone) !== configured) return null
  return {
    id: 'super-admin',
    fullName: 'סופר אדמין',
    phone: configured,
    role: 'super_admin',
    orgId: null,
    orgName: null,
    modules: emptyModules(),
    module: null,
    isOrgManager: false,
    staffKind: null,
  }
}

export async function registerOrganization(body) {
  const name = String(body?.organizationName || '').trim()
  const fullName = String(body?.fullName || '').trim()
  const phone = normalizePhone(body?.phone)
  const email = normalizeEmail(body?.email)
  const password = typeof body?.password === 'string' ? body.password : ''
  const passwordConfirm =
    typeof body?.passwordConfirm === 'string' ? body.passwordConfirm : ''

  if (name.length < 2) throw httpError('נא להזין שם ארגון', 400)
  if (fullName.length < 2) throw httpError('נא להזין שם מנהל', 400)
  if (phone.length < 9) throw httpError('נא להזין מספר טלפון תקין', 400)
  if (!isValidEmail(email)) throw httpError('נא להזין כתובת מייל תקינה', 400)
  const ruleError = validatePasswordRules(password)
  if (ruleError) throw httpError(ruleError, 400)
  if (password !== passwordConfirm) throw httpError('אימות הסיסמה אינו תואם', 400)

  const superAdmin = superAdminIdentity(phone)
  if (superAdmin) {
    throw httpError('המספר הזה שמור לסופר אדמין', 400)
  }

  const existing = await findAccountByPhone(phone)
  if (existing) throw httpError('המספר כבר רשום לארגון', 409)

  const now = new Date().toISOString()
  const orgId = randomUUID()
  const orgCol = await organizations()
  const accountCol = await accounts()
  const passwordHash = await hashPassword(password)

  await orgCol.insertOne({
    _id: orgId,
    name,
    status: 'pending',
    modules: emptyModules(),
    createdAt: now,
    updatedAt: now,
  })
  await accountCol.insertOne({
    _id: randomUUID(),
    orgId,
    fullName,
    phone,
    email,
    passwordHash,
    mustChangePassword: false,
    status: 'active',
    isOrgManager: true,
    staffKind: 'selector',
  })

  let mailed = false
  try {
    const sent = await sendOrganizationCreatedEmail({
      to: email,
      fullName,
      organizationName: name,
    })
    mailed = Boolean(sent?.queued)
  } catch (err) {
    console.error('[mail] organization created email failed', err?.message || err)
  }
  try {
    await sendNewOrganizationAdminEmail({
      organizationName: name,
      managerName: fullName,
      phone,
      email,
    })
  } catch (err) {
    console.error('[mail] new organization notice failed', err?.message || err)
  }

  return {
    ok: true,
    message: mailed
      ? 'הבקשה נשלחה למייל. אפשר להיכנס אחרי שאישור סופר אדמין יפתח מודול לארגון.'
      : 'הבקשה נשלחה. אפשר להיכנס אחרי שאישור סופר אדמין יפתח מודול לארגון.',
  }
}

export async function listOrganizations() {
  await purgeExpiredOrganizations()
  const orgCol = await organizations()
  const accountCol = await accounts()
  const orgs = await orgCol.find({}).sort({ createdAt: -1 }).toArray()
  const orgIds = orgs.map((org) => org._id)
  const managers = await accountCol
    .find({ orgId: { $in: orgIds }, status: 'active' })
    .toArray()
  const managersByOrg = new Map()
  for (const account of managers) {
    const list = managersByOrg.get(account.orgId) ?? []
    list.push(account)
    managersByOrg.set(account.orgId, list)
  }
  return orgs.map((org) => {
    const list = managersByOrg.get(org._id) ?? []
    const manager =
      list.find((account) => String(account._id) === String(org.primaryAccountId)) ||
      list[0]
    return orgSummary(org, manager)
  })
}

export async function reviewOrganization(id, patch) {
  const orgCol = await organizations()
  const org = await orgCol.findOne({ _id: String(id) })
  if (!org) throw httpError('הארגון לא נמצא', 404)

  const next = {}
  if (patch?.status != null) {
    const status = String(patch.status)
    if (
      status !== 'approved' &&
      status !== 'rejected' &&
      status !== 'pending' &&
      status !== 'suspended'
    ) {
      throw httpError('סטטוס לא תקין', 400)
    }
    if (org.deletedAt) throw httpError('הארגון ממתין לשחזור או למחיקה סופית', 400)
    const now = new Date().toISOString()
    next.status = status
    next.reviewedAt = now
    if (status === 'approved') next.approvedAt = now
    if (status === 'rejected') next.rejectedAt = now
    if (status === 'suspended') next.suspendedAt = now
  }
  if (patch?.modules != null) {
    next.modules = {
      selectors: Boolean(patch.modules.selectors),
      inspectors: Boolean(patch.modules.inspectors),
    }
  }
  if (Object.keys(next).length === 0) throw httpError('אין שינוי לעדכון', 400)
  next.updatedAt = new Date().toISOString()

  await orgCol.updateOne({ _id: org._id }, { $set: next })
  const saved = await orgCol.findOne({ _id: org._id })
  if (next.status === 'approved' && org.status !== 'approved') {
    await notifyOrganizationApproved(saved)
  }
  if (next.status === 'rejected' && org.status !== 'rejected') {
    await notifyOrganizationRejected(saved)
  }
  if (saved?.status === 'approved' && next.modules) {
    const opened =
      (next.modules.selectors && !org.modules?.selectors) ||
      (next.modules.inspectors && !org.modules?.inspectors)
    if (opened) await notifyModulesOpened(saved)
  }
  const rows = await listOrganizations()
  return rows.find((row) => row.id === String(saved._id)) || null
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function restoreOrganization(id) {
  const orgCol = await organizations()
  const org = await orgCol.findOne({ _id: String(id) })
  if (!org) throw httpError('הארגון לא נמצא', 404)
  if (!org.deletedAt) throw httpError('הארגון לא מסומן למחיקה', 400)
  if (Date.now() > restoreDeadline(org)) {
    throw httpError('חלון השחזור נסגר', 400)
  }
  await orgCol.updateOne(
    { _id: org._id },
    { $set: { updatedAt: new Date().toISOString() }, $unset: { deletedAt: '' } },
  )
  await appendAuditLog({
    action: 'org_restore',
    details: `שוחזר הארגון ${org.name || org._id}`,
  })
  const rows = await listOrganizations()
  return rows.find((row) => row.id === String(org._id)) || null
}

async function purgeExpiredOrganizations() {
  const orgCol = await organizations()
  const marked = await orgCol.find({ deletedAt: { $exists: true, $nin: [null, ''] } }).toArray()
  const now = Date.now()
  for (const org of marked) {
    if (restoreDeadline(org) < now) await hardDeleteOrganization(String(org._id))
  }
}

export async function extendOrganizationRestore(id) {
  const orgCol = await organizations()
  const org = await orgCol.findOne({ _id: String(id) })
  if (!org) throw httpError('הארגון לא נמצא', 404)
  if (!org.deletedAt) throw httpError('הארגון לא מסומן למחיקה', 400)
  const deleted = new Date(org.deletedAt).getTime()
  const cap = deleted + DELETE_RESTORE_MAX_MS
  const current = restoreDeadline(org)
  if (current >= cap) throw httpError('חלון השחזור כבר באורך המרבי', 400)
  const next = Math.min(current + 7 * DAY_MS, cap)
  const restoreUntil = new Date(next).toISOString()
  await orgCol.updateOne(
    { _id: org._id },
    { $set: { restoreUntil, updatedAt: new Date().toISOString() } },
  )
  await appendAuditLog({
    action: 'org_restore',
    details: `חלון השחזור של ${org.name || org._id} הוארך`,
  })
  const rows = await listOrganizations()
  return rows.find((row) => row.id === String(org._id)) || null
}

export async function purgeOrganization(id, body = {}) {
  const orgCol = await organizations()
  const org = await orgCol.findOne({ _id: String(id) })
  if (!org) throw httpError('הארגון לא נמצא', 404)
  if (!org.deletedAt) throw httpError('קודם מסמנים את הארגון למחיקה', 400)
  const confirmName = String(body.confirmName || '').trim()
  if (confirmName !== String(org.name || '').trim()) {
    throw httpError('שם הארגון אינו תואם', 400)
  }
  const expected = process.env.SUPER_ADMIN_PASSWORD || ''
  if (!passwordsMatch(String(body.password || ''), expected)) {
    throw httpError('סיסמת סופר אדמין שגויה', 401)
  }
  await hardDeleteOrganization(String(org._id))
  return { ok: true }
}

export async function deleteOrganization(id) {
  const orgId = String(id || '')
  if (!orgId) throw httpError('חסר מזהה ארגון', 400)
  const orgCol = await organizations()
  const org = await orgCol.findOne({ _id: orgId })
  if (!org) throw httpError('הארגון לא נמצא', 404)

  const now = new Date().toISOString()
  await orgCol.updateOne(
    { _id: orgId },
    { $set: { deletedAt: now, updatedAt: now } },
  )
  await appendAuditLog({
    action: 'org_delete',
    details: `סומן למחיקה הארגון ${org.name || orgId}. אפשר לשחזר בתוך 7 ימים.`,
  })
  return { ok: true, deletedAt: now }
}

async function hardDeleteOrganization(id) {
  const orgId = String(id || '')
  if (!orgId) return
  const orgCol = await organizations()
  const org = await orgCol.findOne({ _id: orgId })
  if (!org) return

  const targets = ['selectors']
  if (process.env.MONGODB_URI_INSPECTORS?.trim()) targets.push('inspectors')
  for (const target of targets) {
    const db = await getDb(target)
    for (const name of OPERATIONAL_COLLECTIONS) {
      await db.collection(name).deleteMany({ orgId })
    }
    const meta = await getMetaCollection(target)
    await meta.deleteMany({ _id: { $regex: `^${escapeRegex(orgId)}:` } })
    const audit = await getAuditCollection(target)
    await audit.deleteMany({ orgId })
  }

  const accountCol = await accounts()
  await withDbTransaction(async (session) => {
    const opts = session ? { session } : {}
    await accountCol.deleteMany({ orgId }, opts)
    await orgCol.deleteOne({ _id: orgId }, opts)
  })

  await appendAuditLog({
    action: 'org_delete',
    details: `נמחק הארגון ${org.name || orgId}`,
  })
  return { ok: true }
}

async function managerForMail(org) {
  const accountCol = await accounts()
  const managers = await accountCol
    .find({ orgId: String(org._id), status: 'active' })
    .toArray()
  return (
    managers.find((account) => account.isOrgManager && isValidEmail(account.email)) ||
    managers.find((account) => isValidEmail(account.email)) ||
    null
  )
}

async function notifyOrganizationRejected(org) {
  const manager = await managerForMail(org)
  if (!manager) return
  try {
    await sendOrganizationRejectedEmail({
      to: normalizeEmail(manager.email),
      fullName: manager.fullName || '',
      organizationName: org.name || '',
    })
  } catch (err) {
    console.error('[mail] organization rejected email failed', err?.message || err)
  }
}

async function notifyModulesOpened(org) {
  const manager = await managerForMail(org)
  if (!manager) return
  try {
    await sendModulesOpenedEmail({
      to: normalizeEmail(manager.email),
      fullName: manager.fullName || '',
      organizationName: org.name || '',
      modules: publicModules(org.modules),
    })
  } catch (err) {
    console.error('[mail] modules email failed', err?.message || err)
  }
}

async function notifyOrganizationApproved(org) {
  const accountCol = await accounts()
  const managers = await accountCol
    .find({ orgId: String(org._id), status: 'active' })
    .toArray()
  const manager =
    managers.find((account) => account.isOrgManager && isValidEmail(account.email)) ||
    managers.find((account) => isValidEmail(account.email))
  if (!manager) return
  try {
    await sendOrganizationApprovedEmail({
      to: normalizeEmail(manager.email),
      fullName: manager.fullName || '',
      organizationName: org.name || '',
    })
  } catch (err) {
    console.error('[mail] organization approved email failed', err?.message || err)
  }
}

export async function authenticateManager(phoneRaw, credentials = {}) {
  const phone = normalizePhone(phoneRaw)
  if (!phone) throw httpError('נא להזין מספר טלפון', 400)

  const superAdmin = superAdminIdentity(phone)
  let account = superAdmin ? null : await findAccountByPhone(phone)
  if (!superAdmin && !account) throw httpError('אין הרשאת מנהל למספר זה', 401)

  const org = account ? await getOrganization(account.orgId) : null
  if (account && org) account = await recognizeModuleOrgManager(account, org)
  if (account && !org) throw httpError('הארגון לא נמצא', 401)
  if (account && account.status === 'inactive') {
    throw httpError('אין הרשאת מנהל למספר זה', 401)
  }

  const identity = superAdmin || sessionFromAccount(account, org)
  const storedHash = superAdmin ? '' : account.passwordHash || ''
  const mustChangePassword = superAdmin ? false : Boolean(account.mustChangePassword)
  const password = typeof credentials.password === 'string' ? credentials.password : ''
  const newPassword =
    typeof credentials.newPassword === 'string' ? credentials.newPassword : ''
  const newPasswordConfirm =
    typeof credentials.newPasswordConfirm === 'string'
      ? credentials.newPasswordConfirm
      : typeof credentials.passwordConfirm === 'string'
        ? credentials.passwordConfirm
        : ''

  if (!password) {
    if (!superAdmin && !storedHash) {
      return {
        next: 'await_email',
        phone,
        message:
          'טרם הוגדרה סיסמה. פנו למנהל שישלח סיסמה זמנית למייל, או השתמשו באיפוס סיסמה.',
      }
    }
    if (!superAdmin) {
      const blocked = orgGate(org, modulesForAccount(account, org))
      if (blocked) return { ...blocked, phone }
    }
    return {
      next: mustChangePassword ? 'change_password' : 'login',
      phone,
      mustChangePassword,
    }
  }

  if (superAdmin) {
    const expected = process.env.SUPER_ADMIN_PASSWORD || ''
    if (!passwordsMatch(password, expected)) throw httpError('סיסמה שגויה', 401)
    await appendAuditLog({
      action: 'login',
      actor: identity,
      details: 'התחברות סופר אדמין',
    })
    return identity
  }

  if (!storedHash) {
    throw httpError(
      'אין סיסמה לחשבון. יש לבקש סיסמה זמנית במייל ממנהל המערכת או דרך איפוס סיסמה.',
      400,
    )
  }
  const ok = await verifyPassword(password, storedHash)
  if (!ok) throw httpError('סיסמה שגויה', 401)
  if (mustChangePassword && tempPasswordExpired(account.passwordExpiresAt)) {
    throw httpError('הסיסמה הזמנית פגה אחרי 24 שעות. בקשו סיסמה חדשה.', 400)
  }

  const blocked = orgGate(org, modulesForAccount(account, org))
  if (blocked) return { ...blocked, phone }

  if (mustChangePassword) {
    if (!newPassword) return { next: 'change_password', phone }
    const ruleError = validatePasswordRules(newPassword)
    if (ruleError) throw httpError(ruleError, 400)
    if (newPassword !== newPasswordConfirm) throw httpError('אימות הסיסמה אינו תואם', 400)
    if (newPassword === password) {
      throw httpError('יש לבחור סיסמה קבועה שונה מהסיסמה הזמנית', 400)
    }
    const passwordHash = await hashPassword(newPassword)
    const col = await accounts()
    await col.updateOne(
      { _id: account._id },
      {
        $set: { passwordHash, mustChangePassword: false },
        $unset: { passwordExpiresAt: '' },
      },
    )
    await appendAuditLog({
      action: 'login',
      actor: identity,
      orgId: identity.orgId,
      module: identity.module,
      details: 'הגדרת סיסמה קבועה והתחברות',
    })
    await touchOrgLogin(identity.orgId)
    return identity
  }

  await appendAuditLog({
    action: 'login',
    actor: identity,
    orgId: identity.orgId,
    module: identity.module,
    details: 'התחברות למערכת',
  })
  await touchOrgLogin(identity.orgId)
  return identity
}

async function touchOrgLogin(orgId) {
  if (!orgId) return
  const orgCol = await organizations()
  await orgCol.updateOne(
    { _id: String(orgId) },
    { $set: { lastLoginAt: new Date().toISOString() } },
  )
}

const DAY_MS = 24 * 60 * 60 * 1000
const DELETE_RESTORE_MS = 7 * DAY_MS
const DELETE_RESTORE_MAX_MS = 28 * DAY_MS

function restoreDeadline(org) {
  const deleted = new Date(org?.deletedAt || '').getTime()
  if (!Number.isFinite(deleted)) return 0
  const base = deleted + DELETE_RESTORE_MS
  const extra = org?.restoreUntil ? new Date(org.restoreUntil).getTime() : 0
  return Math.max(base, Number.isFinite(extra) ? extra : 0)
}

function orgSummary(org, manager) {
  return {
    id: String(org._id),
    name: org.name || '',
    status: org.deletedAt ? 'deleted' : org.status || 'pending',
    modules: publicModules(org.modules),
    createdAt: org.createdAt || '',
    approvedAt: org.approvedAt || '',
    rejectedAt: org.rejectedAt || '',
    suspendedAt: org.suspendedAt || '',
    lastLoginAt: org.lastLoginAt || '',
    deletedAt: org.deletedAt || '',
    restoreUntil: org.restoreUntil || '',
    manager: manager
      ? {
          fullName: manager.fullName || '',
          phone: manager.phone || '',
          email: manager.email || '',
        }
      : null,
  }
}

export async function requestAccountPasswordReset(phoneRaw) {
  const phone = normalizePhone(phoneRaw)
  if (!phone) throw httpError('נא להזין מספר טלפון', 400)
  const generic = {
    ok: true,
    message: 'אם המספר רשום כמנהל, נשלחה סיסמה זמנית למייל המשויך.',
  }
  if (superAdminIdentity(phone)) return generic

  const account = await findAccountByPhone(phone)
  if (!account || account.status === 'inactive' || !isValidEmail(account.email)) {
    return generic
  }

  const tempPassword = generateTempPassword()
  try {
    await sendTempPasswordEmail({
      to: account.email,
      fullName: account.fullName,
      tempPassword,
      reason: 'reset',
    })
  } catch (e) {
    console.error('password reset mail failed', e)
    throw httpError(
      e instanceof Error && e.status === 503
        ? e.message
        : 'שליחת מייל האיפוס נכשלה. נסו שוב מאוחר יותר.',
      e?.status || 502,
    )
  }

  const passwordHash = await hashPassword(tempPassword)
  const col = await accounts()
  await col.updateOne(
    { _id: account._id },
    {
      $set: {
        passwordHash,
        mustChangePassword: true,
        passwordExpiresAt: tempPasswordExpiresAt(),
      },
    },
  )
  await appendAuditLog({
    action: 'password_reset',
    actor: {
      id: String(account._id),
      fullName: account.fullName,
      phone: account.phone,
    },
    orgId: account.orgId,
    details: `איפוס סיסמה נשלח אל ${account.email}`,
  })
  return generic
}

export async function upsertManagerAccount({
  orgId,
  workerId,
  fullName,
  phone,
  email,
  passwordHash,
  mustChangePassword,
  staffKind,
  isOrgManager,
}) {
  const normalized = normalizePhone(phone)
  if (!orgId || !normalized) return
  const col = await accounts()
  const existing = await col.findOne({ phone: normalized })
  if (existing && String(existing.orgId) !== String(orgId)) {
    throw httpError(`מספר הטלפון של ${fullName || 'המנהל'} שייך לארגון אחר`, 409)
  }
  const fields = {
    orgId: String(orgId),
    fullName: String(fullName || ''),
    phone: normalized,
    email: normalizeEmail(email),
    status: 'active',
  }
  if (passwordHash) {
    fields.passwordHash = passwordHash
    fields.mustChangePassword = Boolean(mustChangePassword)
    if (mustChangePassword) fields.passwordExpiresAt = tempPasswordExpiresAt()
    else fields.passwordExpiresAt = ''
  }
  if (staffKind === 'inspector' || staffKind === 'selector') fields.staffKind = staffKind
  if (typeof isOrgManager === 'boolean') fields.isOrgManager = isOrgManager
  if (existing) {
    await col.updateOne({ _id: existing._id }, { $set: fields })
    return
  }
  await col.insertOne({
    _id: workerId ? String(workerId) : randomUUID(),
    mustChangePassword: Boolean(mustChangePassword),
    passwordHash: passwordHash || '',
    isOrgManager: Boolean(isOrgManager),
    staffKind: staffKind === 'inspector' ? 'inspector' : 'selector',
    ...fields,
  })
}

export async function disableWorkerAccount(orgId, workerId) {
  if (!orgId || !workerId) return
  const col = await accounts()
  await col.updateOne(
    { _id: String(workerId), orgId: String(orgId) },
    { $set: { status: 'inactive' } },
  )
}

export async function ensureLegacyManagerAccounts(orgId, workers) {
  const col = await accounts()
  for (const worker of workers || []) {
    if (!worker?.isManager || worker.status === 'inactive') continue
    const phone = normalizePhone(worker.phone)
    if (!phone || superAdminIdentity(phone)) continue
    const existing = await col.findOne({ phone })
    if (existing && String(existing.orgId) !== String(orgId)) continue
    if (existing?.passwordHash) continue
    try {
      await upsertManagerAccount({
        orgId,
        workerId: worker.id,
        fullName: worker.fullName,
        phone,
        email: worker.email,
        passwordHash: worker.passwordHash || existing?.passwordHash || '',
        mustChangePassword: Boolean(worker.mustChangePassword),
      })
    } catch (err) {
      if (err.status !== 409) throw err
    }
  }
}

export async function createLegacyOrganization(workers) {
  const orgCol = await organizations()
  const existing = await orgCol.findOne({ legacy: true })
  if (existing) {
    await ensureLegacyManagerAccounts(existing._id, workers)
    return String(existing._id)
  }

  const now = new Date().toISOString()
  const orgId = randomUUID()
  await orgCol.insertOne({
    _id: orgId,
    name: 'הארגון הקיים',
    status: 'approved',
    legacy: true,
    modules: { selectors: true, inspectors: true },
    createdAt: now,
    updatedAt: now,
  })

  for (const worker of workers || []) {
    if (!worker?.isManager || worker.status === 'inactive') continue
    const phone = normalizePhone(worker.phone)
    if (!phone || superAdminIdentity(phone)) continue
    try {
      await upsertManagerAccount({
        orgId,
        workerId: worker.id,
        fullName: worker.fullName,
        phone,
        email: worker.email,
        passwordHash: worker.passwordHash || '',
        mustChangePassword: Boolean(worker.mustChangePassword),
      })
    } catch (err) {
      if (err.status !== 409) throw err
    }
  }
  return orgId
}

export function publicAssignmentModes(org) {
  const raw =
    org?.assignmentModes && typeof org.assignmentModes === 'object'
      ? org.assignmentModes
      : {}
  return {
    selectors: raw.selectors === 'single' ? 'single' : 'rounds',
    inspectors: raw.inspectors === 'rounds' ? 'rounds' : 'single',
  }
}

function assignmentModeLabel(mode) {
  return mode === 'rounds' ? 'שיבוץ בסבבים' : 'שיבוץ אחד לכל המשמרת'
}

const ROUND_CHOICES = [60, 90, 120, 180]

export function publicRoundMinutes(org) {
  const raw = org?.roundMinutes || {}
  const pick = (value) =>
    ROUND_CHOICES.includes(Number(value)) ? Number(value) : 120
  return { selectors: pick(raw.selectors), inspectors: pick(raw.inspectors) }
}

export function publicStaggerRounds(org) {
  const raw =
    org?.staggerRounds && typeof org.staggerRounds === 'object'
      ? org.staggerRounds
      : {}
  return {
    selectors: raw.selectors === true,
    inspectors: raw.inspectors === true,
  }
}

export async function readOrgAssignmentSettings(orgId) {
  const org = await getOrganization(orgId)
  if (!org) throw httpError('הארגון לא נמצא', 404)
  return {
    modules: publicModules(org.modules),
    assignmentModes: publicAssignmentModes(org),
    roundMinutes: publicRoundMinutes(org),
    staggerRounds: publicStaggerRounds(org),
    organization: publicOrgProfile(org),
  }
}

function publicOrgProfile(org) {
  const logo = typeof org?.logo === 'string' ? org.logo : ''
  return {
    name: String(org?.name || ''),
    logo: logo.startsWith('data:image/') ? logo : '',
  }
}

export async function updateOrgProfile(orgId, profile) {
  const orgCol = await organizations()
  const org = await orgCol.findOne({ _id: String(orgId) })
  if (!org) throw httpError('הארגון לא נמצא', 404)
  const name = String(profile?.name || '').trim()
  if (name.length < 2 || name.length > 80) {
    throw httpError('שם הארגון צריך להיות בין 2 ל־80 תווים', 400)
  }
  let logo = profile?.logo == null ? publicOrgProfile(org).logo : String(profile.logo)
  if (logo) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(logo) || logo.length > 180_000) {
      throw httpError('הלוגו צריך להיות תמונה קטנה מסוג PNG, JPG או WEBP', 400)
    }
  } else {
    logo = ''
  }
  await orgCol.updateOne(
    { _id: org._id },
    { $set: { name, logo, updatedAt: new Date().toISOString() } },
  )
  await appendAuditLog({
    action: 'org_profile',
    orgId: String(org._id),
    details: name !== org.name ? `שם הארגון עודכן ל־${name}` : 'לוגו הארגון עודכן',
  })
  return publicOrgProfile({ name, logo })
}

export async function updateOrgAssignmentSettings(orgId, patch, actor) {
  const orgCol = await organizations()
  const org = await orgCol.findOne({ _id: String(orgId) })
  if (!org) throw httpError('הארגון לא נמצא', 404)
  const current = publicAssignmentModes(org)
  const next = { ...current }
  const modes =
    patch?.assignmentModes && typeof patch.assignmentModes === 'object'
      ? patch.assignmentModes
      : patch
  if (modes?.selectors != null) {
    if (modes.selectors !== 'rounds' && modes.selectors !== 'single') {
      throw httpError('אופן שיבוץ לא תקין לסלקטורים', 400)
    }
    next.selectors = modes.selectors
  }
  if (modes?.inspectors != null) {
    if (modes.inspectors !== 'rounds' && modes.inspectors !== 'single') {
      throw httpError('אופן שיבוץ לא תקין לבודקים', 400)
    }
    next.inspectors = modes.inspectors
  }
  const minutes = publicRoundMinutes(org)
  const minutePatch = patch?.roundMinutes
  if (minutePatch && typeof minutePatch === 'object') {
    for (const key of ['selectors', 'inspectors']) {
      if (ROUND_CHOICES.includes(Number(minutePatch[key]))) {
        minutes[key] = Number(minutePatch[key])
      }
    }
  }
  const stagger = publicStaggerRounds(org)
  const staggerPatch = patch?.staggerRounds
  if (staggerPatch && typeof staggerPatch === 'object') {
    for (const key of ['selectors', 'inspectors']) {
      if (typeof staggerPatch[key] === 'boolean') stagger[key] = staggerPatch[key]
    }
  }
  const sameModes =
    next.selectors === current.selectors && next.inspectors === current.inspectors
  const sameMinutes =
    minutes.selectors === publicRoundMinutes(org).selectors &&
    minutes.inspectors === publicRoundMinutes(org).inspectors
  const previousStagger = publicStaggerRounds(org)
  const sameStagger =
    stagger.selectors === previousStagger.selectors &&
    stagger.inspectors === previousStagger.inspectors
  if (sameModes && sameMinutes && sameStagger) {
    return {
      modules: publicModules(org.modules),
      assignmentModes: current,
      roundMinutes: minutes,
      staggerRounds: stagger,
      organization: publicOrgProfile(org),
    }
  }
  await orgCol.updateOne(
    { _id: org._id },
    {
      $set: {
        assignmentModes: next,
        roundMinutes: minutes,
        staggerRounds: stagger,
        updatedAt: new Date().toISOString(),
      },
    },
  )
  const details = [
    next.selectors !== current.selectors
      ? `סלקטורים: ${assignmentModeLabel(next.selectors)}`
      : '',
    next.inspectors !== current.inspectors
      ? `בודקים: ${assignmentModeLabel(next.inspectors)}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')
  await appendAuditLog({
    action: 'assignment_settings',
    actor: actor || null,
    orgId: String(org._id),
    details: details || 'עדכון אופן שיבוץ',
  })
  return {
    modules: publicModules(org.modules),
    assignmentModes: next,
    roundMinutes: minutes,
    staggerRounds: stagger,
    organization: publicOrgProfile(org),
  }
}

export async function changeOwnPassword(user, body) {
  if (user?.role !== 'org_manager' || !user.orgId) {
    throw httpError('סיסמת סופר אדמין משתנה רק בהגדרות השרת', 400)
  }
  const currentPassword = String(body?.currentPassword || '')
  const newPassword = String(body?.newPassword || '')
  const newPasswordConfirm = String(body?.newPasswordConfirm || '')
  if (!currentPassword) throw httpError('נא להזין את הסיסמה הנוכחית', 400)
  const ruleError = validatePasswordRules(newPassword)
  if (ruleError) throw httpError(ruleError, 400)
  if (newPassword !== newPasswordConfirm) throw httpError('אימות הסיסמה אינו תואם', 400)
  if (newPassword === currentPassword) {
    throw httpError('הסיסמה החדשה חייבת להיות שונה מהנוכחית', 400)
  }

  const col = await accounts()
  const account = await col.findOne({
    _id: String(user.id),
    orgId: String(user.orgId),
  })
  if (!account?.passwordHash) throw httpError('לא נמצא חשבון לעדכון סיסמה', 400)
  const ok = await verifyPassword(currentPassword, account.passwordHash)
  if (!ok) throw httpError('הסיסמה הנוכחית שגויה', 400)

  const passwordHash = await hashPassword(newPassword)
  await col.updateOne(
    { _id: account._id },
    {
      $set: { passwordHash, mustChangePassword: false },
      $unset: { passwordExpiresAt: '' },
    },
  )
  await appendAuditLog({
    action: 'password_change',
    actor: user,
    orgId: user.orgId,
    module: user.module,
    details: 'החלפת סיסמה',
  })
  return { ok: true }
}
