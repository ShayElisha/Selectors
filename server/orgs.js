import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { getDb } from './db.js'
import { appendAuditLog } from './audit.js'
import { sendTempPasswordEmail } from './mail.js'
import {
  generateTempPassword,
  hashPassword,
  validatePasswordRules,
  verifyPassword,
} from './password.js'

const ORG_COLLECTION = 'organizations'
const ACCOUNT_COLLECTION = 'accounts'

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
  if (!org || org.status === 'rejected') {
    return {
      next: 'rejected',
      message: 'בקשת הארגון נדחתה. אפשר לפנות לסופר אדמין.',
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

  return {
    ok: true,
    message: 'הבקשה נשלחה. אפשר להיכנס אחרי שאישור סופר אדמין יפתח מודול לארגון.',
  }
}

export async function listOrganizations() {
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
    return {
      id: String(org._id),
      name: org.name || '',
      status: org.status || 'pending',
      modules: publicModules(org.modules),
      createdAt: org.createdAt || '',
      manager: manager
        ? {
            fullName: manager.fullName || '',
            phone: manager.phone || '',
            email: manager.email || '',
          }
        : null,
    }
  })
}

export async function reviewOrganization(id, patch) {
  const orgCol = await organizations()
  const org = await orgCol.findOne({ _id: String(id) })
  if (!org) throw httpError('הארגון לא נמצא', 404)

  const next = {}
  if (patch?.status != null) {
    const status = String(patch.status)
    if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
      throw httpError('סטטוס לא תקין', 400)
    }
    next.status = status
    next.reviewedAt = new Date().toISOString()
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
  const rows = await listOrganizations()
  return rows.find((row) => row.id === String(saved._id)) || null
}

export async function authenticateManager(phoneRaw, credentials = {}) {
  const phone = normalizePhone(phoneRaw)
  if (!phone) throw httpError('נא להזין מספר טלפון', 400)

  const superAdmin = superAdminIdentity(phone)
  const account = superAdmin ? null : await findAccountByPhone(phone)
  if (!superAdmin && !account) throw httpError('אין הרשאת מנהל למספר זה', 401)

  const org = account ? await getOrganization(account.orgId) : null
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
      { $set: { passwordHash, mustChangePassword: false } },
    )
    await appendAuditLog({
      action: 'login',
      actor: identity,
      orgId: identity.orgId,
      module: identity.module,
      details: 'הגדרת סיסמה קבועה והתחברות',
    })
    return identity
  }

  await appendAuditLog({
    action: 'login',
    actor: identity,
    orgId: identity.orgId,
    module: identity.module,
    details: 'התחברות למערכת',
  })
  return identity
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
    { $set: { passwordHash, mustChangePassword: true } },
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

export async function readOrgAssignmentSettings(orgId) {
  const org = await getOrganization(orgId)
  if (!org) throw httpError('הארגון לא נמצא', 404)
  return {
    modules: publicModules(org.modules),
    assignmentModes: publicAssignmentModes(org),
  }
}

export async function updateOrgAssignmentSettings(orgId, patch, actor) {
  const orgCol = await organizations()
  const org = await orgCol.findOne({ _id: String(orgId) })
  if (!org) throw httpError('הארגון לא נמצא', 404)
  const current = publicAssignmentModes(org)
  const next = { ...current }
  if (patch?.selectors != null) {
    if (patch.selectors !== 'rounds' && patch.selectors !== 'single') {
      throw httpError('אופן שיבוץ לא תקין לסלקטורים', 400)
    }
    next.selectors = patch.selectors
  }
  if (patch?.inspectors != null) {
    if (patch.inspectors !== 'rounds' && patch.inspectors !== 'single') {
      throw httpError('אופן שיבוץ לא תקין לבודקים', 400)
    }
    next.inspectors = patch.inspectors
  }
  if (next.selectors === current.selectors && next.inspectors === current.inspectors) {
    return {
      modules: publicModules(org.modules),
      assignmentModes: current,
    }
  }
  await orgCol.updateOne(
    { _id: org._id },
    {
      $set: {
        assignmentModes: next,
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
  }
}
