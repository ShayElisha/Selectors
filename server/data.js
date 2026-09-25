import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getStateCollection } from './db.js'
import { appendAuditLog, diffAppDataAuditEvents, shiftAuditHeader, summarizeAssignmentChanges } from './audit.js'
import { sendTempPasswordEmail } from './mail.js'
import {
  generateTempPassword,
  hashPassword,
  validatePasswordRules,
  verifyPassword,
} from './password.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadCustomsBrokersSeed() {
  try {
    const raw = readFileSync(
      join(__dirname, 'customsBrokersSeed.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const DEFAULT_CERTIFICATIONS = [
  'בדיקת דרכונים',
  'בידוק ביטחוני',
  'נתיב מהיר',
  'כבודה',
  'ראיון',
  'מפקד נתיב',
]

const WORKER_ROSTER = [
  { fullName: 'אביב חי טפלשוילי', phone: '0508676524' },
  { fullName: 'אבירן אברהם דסה', phone: '0539633063' },
  { fullName: 'אדיר דאי', phone: '0528885977' },
  { fullName: 'אוריה כהן', phone: '0536071196' },
  { fullName: 'אירנה גלפרין', phone: '0537273180' },
  { fullName: 'אליאן דדון', phone: '0524776343' },
  { fullName: 'דור בכור', phone: '0502384846' },
  { fullName: 'זיווה אלמדאי', phone: '0505250483' },
  { fullName: 'חיה מנגדיש', phone: '0506945567' },
  { fullName: 'לאון קולסניק', phone: '0542064272' },
  { fullName: 'לירז דרבה', phone: '0539277541' },
  { fullName: 'מעיין איילי', phone: '0539740744' },
  { fullName: 'מעיין באסטקאר', phone: '0534280149' },
  { fullName: 'נתנאל מאיר', phone: '0525651294' },
  { fullName: 'עדי אנגאו', phone: '0538916668' },
  { fullName: 'קורל שמואל', phone: '0549486021' },
  { fullName: 'קיריל ליטבק', phone: '0538658879' },
  { fullName: 'קריסטינה שקיראק', phone: '0526442431' },
  { fullName: 'רונית בכר', phone: '0535586417' },
  { fullName: "שחר צ'קול", phone: '0507433706' },
  { fullName: 'שי אלישע', phone: '0537171884', isManager: true },
  { fullName: 'שיראל טגבה', phone: '0533200457' },
]

export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

export function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
}

export function isValidEmail(email) {
  const e = normalizeEmail(email)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

function isDefaultManager(w) {
  return w.fullName === 'שי אלישע' || normalizePhone(w.phone) === '0537171884'
}

export function createSeedData() {
  return {
    workers: WORKER_ROSTER.map((w) => {
      const isManager = Boolean(w.isManager) || isDefaultManager(w)
      return {
        id: randomUUID(),
        fullName: w.fullName,
        phone: w.phone,
        email: w.email || (isDefaultManager(w) ? process.env.ADMIN_EMAIL || '' : ''),
        certifications: [],
        status: 'active',
        isInspector: !isManager,
        isManager,
      }
    }),
    lanes: [
      {
        id: randomUUID(),
        name: 'נתיב 1',
        staffingStandard: 2,
        requiredCertifications: [],
        intensity: 'medium',
      },
      {
        id: randomUUID(),
        name: 'נתיב 2',
        staffingStandard: 1,
        requiredCertifications: [],
        intensity: 'hard',
      },
      {
        id: randomUUID(),
        name: 'נתיב מהיר',
        staffingStandard: 1,
        requiredCertifications: [],
        intensity: 'easy',
      },
      {
        id: randomUUID(),
        name: 'כבודה',
        staffingStandard: 2,
        requiredCertifications: [],
        intensity: 'hard',
      },
      {
        id: randomUUID(),
        name: 'מכס',
        staffingStandard: 1,
        requiredCertifications: [],
        intensity: 'medium',
        afternoonHandoff: true,
      },
      {
        id: randomUUID(),
        name: 'ראיונות',
        staffingStandard: 1,
        requiredCertifications: [],
        intensity: 'medium',
      },
      {
        id: randomUUID(),
        name: 'מנהל שער',
        staffingStandard: 1,
        requiredCertifications: [],
        intensity: 'hard',
      },
    ],
    history: [],
    certificationsCatalog: [...DEFAULT_CERTIFICATIONS],
    briefingSections: [
      {
        id: randomUUID(),
        title: 'פתיחת משמרת',
        body: 'בדקו נוכחות, ציוד ומצב העמדות לפני תחילת השיבוץ. ודאו שכל בודק יודע את הנתיב והדגשים למשמרת.',
        order: 0,
        updatedAt: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        title: 'בטיחות ותשומת לב',
        body: 'שמרו על ערנות בעמדות עמוסות. דווחו מיד על תקלה, חשד או מצב חריג למנהל המשמרת.',
        order: 1,
        updatedAt: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        title: 'מסירה בין משמרות',
        body: 'בסיום — העבירו דגשים פתוחים למשמרת הבאה (נתיבים בעייתיים, חוסרים, אירועים). אל תסתמכו על זיכרון בלבד.',
        order: 2,
        updatedAt: new Date().toISOString(),
      },
    ],
    questionBank: [
      {
        id: randomUUID(),
        prompt: 'מה עושים כשחסר בודק בעמדה לפי התקן?',
        answer:
          'מדווחים למנהל המשמרת ומתאימים שיבוץ או תגבור — לא משאירים עמדה חסרה בלי דיווח.',
        order: 0,
        updatedAt: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        prompt: 'מתי חשוב לבדוק הסמכות לפני שיבוץ לנתיב?',
        answer:
          'כשלנתיב יש דרישת הסמכה (למשל מכס) — משבצים רק בודקים מוסמכים.',
        order: 1,
        updatedAt: new Date().toISOString(),
      },
    ],
    customsBrokers: loadCustomsBrokersSeed(),
  }
}

function normalizeWorker(w) {
  const isManager = Boolean(w.isManager) || isDefaultManager(w)
  const hasInspectorFlag = Object.prototype.hasOwnProperty.call(w, 'isInspector')
  let isInspector = hasInspectorFlag ? Boolean(w.isInspector) : !isManager
  if (!isInspector && !isManager) isInspector = true
  const worker = {
    id: w.id,
    fullName: w.fullName || '',
    phone: w.phone || '',
    email: normalizeEmail(w.email),
    certifications: Array.isArray(w.certifications) ? w.certifications : [],
    status: w.status === 'inactive' ? 'inactive' : 'active',
    isInspector,
    isManager,
  }
  if (typeof w.passwordHash === 'string' && w.passwordHash) {
    worker.passwordHash = w.passwordHash
  }
  if ('mustChangePassword' in w) {
    worker.mustChangePassword = Boolean(w.mustChangePassword)
  }
  return worker
}

function normalizeLane(l) {
  const std = Number(l?.staffingStandard)
  const staffingStandard =
    Number.isInteger(std) && std >= 1 && std <= 5 ? std : 1
  return {
    id: l.id,
    name: l.name || '',
    staffingStandard,
    requiredCertifications: Array.isArray(l.requiredCertifications)
      ? l.requiredCertifications
      : [],
    intensity:
      l.intensity === 'easy' || l.intensity === 'hard' || l.intensity === 'medium'
        ? l.intensity
        : 'medium',
    afternoonHandoff: Boolean(l.afternoonHandoff),
  }
}

function normalizeCustomsBrokerContact(c, brokerId) {
  if (!c || typeof c !== 'object') return null
  let digits = String(c.phoneDigits || c.phone || '').replace(/\D/g, '')
  if (digits.length === 9 && digits.startsWith('5')) digits = `0${digits}`
  if (digits.length === 8 && /^[23489]/.test(digits)) digits = `0${digits}`
  if (digits.length < 9 || digits.length > 10 || !digits.startsWith('0')) {
    return null
  }
  const id = String(c.id || '').trim() || `${brokerId}-${digits}`
  let phone = String(c.phone || '').trim()
  if (!phone) {
    phone =
      digits.length === 10
        ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
        : `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`
  }
  return {
    id,
    name: String(c.name || '').trim(),
    phone,
    phoneDigits: digits,
  }
}

function normalizeCustomsBrokersList(list) {
  const seed = loadCustomsBrokersSeed()
  const raw = Array.isArray(list) ? list : []
  if (raw.length === 0) return seed
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.id || '').trim()
    const name = String(item.name || '').trim()
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    const contacts = []
    const phoneSeen = new Set()
    for (const c of Array.isArray(item.contacts) ? item.contacts : []) {
      const n = normalizeCustomsBrokerContact(c, id)
      if (!n || phoneSeen.has(n.phoneDigits)) continue
      phoneSeen.add(n.phoneDigits)
      contacts.push(n)
    }
    out.push({ id, name, contacts })
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'he'))
  return out.length > 0 ? out : seed
}

export function normalizeData(raw) {
  const briefingSections = Array.isArray(raw?.briefingSections)
    ? raw.briefingSections
        .map((s) => {
          if (!s || typeof s !== 'object') return null
          const id = String(s.id || '').trim()
          const title = String(s.title || '').trim()
          if (!id || !title) return null
          const order = Number(s.order)
          return {
            id,
            title,
            body: String(s.body || '').trim(),
            order: Number.isFinite(order) ? order : 0,
            updatedAt: String(s.updatedAt || new Date().toISOString()),
            ...(typeof s.updatedBy === 'string' && s.updatedBy.trim()
              ? { updatedBy: s.updatedBy.trim() }
              : {}),
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
    : []

  const questionBank = Array.isArray(raw?.questionBank)
    ? raw.questionBank
        .map((q) => {
          if (!q || typeof q !== 'object') return null
          const id = String(q.id || '').trim()
          const prompt = String(q.prompt || '').trim()
          let answer = String(q.answer || '').trim()
          if (!answer) {
            const options = Array.isArray(q.options)
              ? q.options.map((x) => String(x ?? '').trim()).filter(Boolean)
              : []
            if (options.length > 0) {
              let correctIndex = Math.trunc(Number(q.correctIndex))
              if (!Number.isFinite(correctIndex) || correctIndex < 0) {
                correctIndex = 0
              }
              if (correctIndex >= options.length) correctIndex = 0
              const picked = options[correctIndex] || ''
              const explanation = String(q.explanation || '').trim()
              answer = explanation ? `${picked} — ${explanation}` : picked
            } else {
              answer = String(q.explanation || '').trim()
            }
          }
          if (!id || !prompt || !answer) return null
          const order = Number(q.order)
          return {
            id,
            prompt,
            answer,
            order: Number.isFinite(order) ? order : 0,
            updatedAt: String(q.updatedAt || new Date().toISOString()),
            ...(typeof q.updatedBy === 'string' && q.updatedBy.trim()
              ? { updatedBy: q.updatedBy.trim() }
              : {}),
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
    : []

  const lanes = Array.isArray(raw?.lanes) ? raw.lanes.map(normalizeLane) : []
  const gateIdx = lanes.findIndex(
    (l) => String(l.name || '').trim() === 'מנהל שער',
  )
  if (gateIdx < 0) {
    lanes.push({
      id: randomUUID(),
      name: 'מנהל שער',
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: 'medium',
      afternoonHandoff: false,
    })
  } else {
    const gate = lanes[gateIdx]
    lanes[gateIdx] = {
      ...gate,
      name: 'מנהל שער',
      staffingStandard: 1,
      intensity: 'medium',
    }
  }

  return {
    workers: Array.isArray(raw?.workers) ? raw.workers.map(normalizeWorker) : [],
    lanes,
    history: Array.isArray(raw?.history) ? raw.history : [],
    certificationsCatalog: Array.isArray(raw?.certificationsCatalog)
      ? raw.certificationsCatalog
      : [...DEFAULT_CERTIFICATIONS],
    briefingSections,
    questionBank,
    customsBrokers: normalizeCustomsBrokersList(raw?.customsBrokers),
    revision: Number.isFinite(Number(raw?.revision)) ? Number(raw.revision) : 0,
  }
}

/** Strip secrets before sending AppData to clients. */
export function publicData(data) {
  if (!data) return data
  return {
    ...data,
    workers: Array.isArray(data.workers)
      ? data.workers.map(
          ({ passwordHash: _h, mustChangePassword: _m, ...w }) => w,
        )
      : [],
  }
}

function mergeWorkerSecrets(incomingWorkers, prevWorkers) {
  const prevById = new Map((prevWorkers || []).map((w) => [w.id, w]))
  return incomingWorkers.map((w) => {
    const prev = prevById.get(w.id)
    const next = { ...w }
    if (!next.passwordHash && prev?.passwordHash) {
      next.passwordHash = prev.passwordHash
    }
    if ('mustChangePassword' in w) {
      if (w.mustChangePassword && next.isManager) {
        next.mustChangePassword = true
      } else {
        delete next.mustChangePassword
      }
    } else if (prev?.mustChangePassword && next.isManager) {
      next.mustChangePassword = true
    }
    if (!next.isManager) {
      delete next.mustChangePassword
    }
    return next
  })
}

function assertManagersHaveEmail(workers, prevWorkers) {
  const prevById = new Map((prevWorkers || []).map((w) => [w.id, w]))
  for (const w of workers) {
    if (!w.isManager) continue
    if (isValidEmail(w.email)) continue
    const prev = prevById.get(w.id)
    const newlyManager = !prev || !prev.isManager
    if (newlyManager) {
      const err = new Error(
        `לא ניתן למנות מנהל ללא מייל תקין (${w.fullName || 'ללא שם'})`,
      )
      err.status = 400
      throw err
    }
  }
}

function shouldIssueTempPassword(worker, prev) {
  if (!worker.isManager) return false
  if (!isValidEmail(worker.email)) return false
  if (!prev) return true
  if (!prev.isManager) return true
  if (!prev.passwordHash) return true
  return false
}

/**
 * Issue temp passwords + emails for new/promoted managers.
 * @returns {Promise<{ workers: object[], mailErrors: string[] }>}
 */
async function applyManagerInvites(workers, prevWorkers, options = {}) {
  if (options.skipManagerInvites) {
    return { workers, mailErrors: [] }
  }
  const prevById = new Map((prevWorkers || []).map((w) => [w.id, w]))
  const mailErrors = []
  const nextWorkers = []

  for (const w of workers) {
    const prev = prevById.get(w.id)
    if (!shouldIssueTempPassword(w, prev)) {
      nextWorkers.push(w)
      continue
    }
    const tempPassword = generateTempPassword()
    try {
      await sendTempPasswordEmail({
        to: w.email,
        fullName: w.fullName,
        tempPassword,
        reason: 'invite',
      })
    } catch (e) {
      mailErrors.push(
        `${w.fullName}: ${e instanceof Error ? e.message : 'שליחת מייל נכשלה'}`,
      )
      nextWorkers.push(w)
      continue
    }
    const passwordHash = await hashPassword(tempPassword)
    nextWorkers.push({
      ...w,
      passwordHash,
      mustChangePassword: true,
    })
    await appendAuditLog({
      action: 'manager_invite',
      actor: options.actor || null,
      details: `סיסמה זמנית נשלחה אל ${w.fullName} (${w.email})`,
    })
  }

  if (mailErrors.length > 0) {
    const err = new Error(
      `שליחת מייל למנהל נכשלה — השינויים לא נשמרו: ${mailErrors.join(' · ')}`,
    )
    err.status = 502
    throw err
  }

  return { workers: nextWorkers, mailErrors }
}

export async function readState() {
  const col = await getStateCollection()
  const doc = await col.findOne({ _id: 'main' })
  if (!doc) {
    const seed = createSeedData()
    const revision = 1
    await col.insertOne({
      _id: 'main',
      ...seed,
      revision,
      updatedAt: new Date(),
    })
    return { ...seed, revision }
  }
  return normalizeData(doc)
}

export async function writeState(data, options = {}) {
  const col = await getStateCollection()
  const prevDoc = await col.findOne({ _id: 'main' })
  const prev = prevDoc ? normalizeData(prevDoc) : null
  const currentRevision = prev?.revision ?? 0

  if (
    options.expectedRevision != null &&
    Number(options.expectedRevision) !== currentRevision
  ) {
    const err = new Error(
      'הנתונים עודכנו ע״י מנהל אחר. רעננו את המסך וחזרו על השינוי.',
    )
    err.status = 409
    err.current = publicData(prev)
    throw err
  }

  const normalized = normalizeData(data)
  let workers = mergeWorkerSecrets(normalized.workers, prev?.workers)
  if (!options.skipManagerInvites) {
    assertManagersHaveEmail(workers, prev?.workers)
  }

  const invited = await applyManagerInvites(workers, prev?.workers, options)
  workers = invited.workers

  const payload = {
    ...normalized,
    workers,
  }
  const nextRevision = currentRevision + 1
  const toStore = {
    workers: payload.workers,
    lanes: payload.lanes,
    history: payload.history,
    certificationsCatalog: payload.certificationsCatalog,
    briefingSections: payload.briefingSections ?? [],
    questionBank: payload.questionBank ?? [],
    customsBrokers: payload.customsBrokers ?? [],
    revision: nextRevision,
    updatedAt: new Date(),
  }

  await col.updateOne({ _id: 'main' }, { $set: toStore }, { upsert: true })

  const result = { ...payload, revision: nextRevision }

  if (!options.skipAudit) {
    if (options.action === 'data_reset') {
      await appendAuditLog({
        action: 'data_reset',
        actor: options.actor,
        details: options.details || 'איפוס לכל נתוני הדוגמה',
      })
    } else if (prev) {
      const events = diffAppDataAuditEvents(prev, result)
      for (const ev of events) {
        await appendAuditLog({
          action: ev.action,
          actor: options.actor,
          details: ev.details,
        })
      }
    }
  }

  return publicData(result)
}

export async function loginByPhone(phoneRaw, credentials = {}) {
  const phone = normalizePhone(phoneRaw)
  if (!phone) {
    const err = new Error('נא להזין מספר טלפון')
    err.status = 400
    throw err
  }
  const data = await readState()
  const manager = data.workers.find(
    (w) =>
      w.isManager &&
      w.status === 'active' &&
      normalizePhone(w.phone) === phone,
  )
  if (!manager) {
    const err = new Error('אין הרשאת מנהל למספר זה')
    err.status = 401
    throw err
  }

  const hasPassword = Boolean(manager.passwordHash)
  const password =
    typeof credentials.password === 'string' ? credentials.password : ''
  const newPassword =
    typeof credentials.newPassword === 'string' ? credentials.newPassword : ''
  const newPasswordConfirm =
    typeof credentials.newPasswordConfirm === 'string'
      ? credentials.newPasswordConfirm
      : typeof credentials.passwordConfirm === 'string'
        ? credentials.passwordConfirm
        : ''

  // Step 1: phone only
  if (!password) {
    if (!hasPassword) {
      return {
        next: 'await_email',
        phone: manager.phone,
        message:
          'טרם הוגדרה סיסמה. פנה/י למנהל שישלח סיסמה זמנית למייל, או השתמשו באיפוס סיסמה.',
      }
    }
    return {
      next: 'login',
      phone: manager.phone,
      mustChangePassword: Boolean(manager.mustChangePassword),
    }
  }

  if (!hasPassword) {
    const err = new Error(
      'אין סיסמה לחשבון. יש לבקש סיסמה זמנית במייל ממנהל המערכת או דרך איפוס סיסמה.',
    )
    err.status = 400
    throw err
  }

  const ok = await verifyPassword(password, manager.passwordHash)
  if (!ok) {
    const err = new Error('סיסמה שגויה')
    err.status = 401
    throw err
  }

  // Forced permanent password after temp / reset
  if (manager.mustChangePassword) {
    if (!newPassword) {
      return {
        next: 'change_password',
        phone: manager.phone,
      }
    }
    const ruleError = validatePasswordRules(newPassword)
    if (ruleError) {
      const err = new Error(ruleError)
      err.status = 400
      throw err
    }
    if (newPassword !== newPasswordConfirm) {
      const err = new Error('אימות הסיסמה אינו תואם')
      err.status = 400
      throw err
    }
    if (newPassword === password) {
      const err = new Error('יש לבחור סיסמה קבועה שונה מהסיסמה הזמנית')
      err.status = 400
      throw err
    }
    const passwordHash = await hashPassword(newPassword)
    await writeState(
      {
        ...data,
        workers: data.workers.map((w) =>
          w.id === manager.id
            ? { ...w, passwordHash, mustChangePassword: false }
            : w,
        ),
      },
      { skipAudit: true, skipManagerInvites: true },
    )
    const user = {
      id: manager.id,
      fullName: manager.fullName,
      phone: manager.phone,
    }
    await appendAuditLog({
      action: 'login',
      actor: user,
      details: 'הגדרת סיסמה קבועה והתחברות',
    })
    return user
  }

  const user = {
    id: manager.id,
    fullName: manager.fullName,
    phone: manager.phone,
  }
  await appendAuditLog({
    action: 'login',
    actor: user,
    details: 'התחברות למערכת',
  })
  return user
}

/** Self-service / admin: email a new temporary password. */
export async function requestPasswordReset(phoneRaw) {
  const phone = normalizePhone(phoneRaw)
  if (!phone) {
    const err = new Error('נא להזין מספר טלפון')
    err.status = 400
    throw err
  }
  const data = await readState()
  const manager = data.workers.find(
    (w) =>
      w.isManager &&
      w.status === 'active' &&
      normalizePhone(w.phone) === phone,
  )

  // Generic response — do not reveal whether the phone exists
  const generic = {
    ok: true,
    message: 'אם המספר רשום כמנהל, נשלחה סיסמה זמנית למייל המשויך.',
  }

  if (!manager || !isValidEmail(manager.email)) {
    return generic
  }

  const tempPassword = generateTempPassword()
  try {
    await sendTempPasswordEmail({
      to: manager.email,
      fullName: manager.fullName,
      tempPassword,
      reason: 'reset',
    })
  } catch (e) {
    console.error('password reset mail failed', e)
    const err = new Error(
      e instanceof Error && e.status === 503
        ? e.message
        : 'שליחת מייל האיפוס נכשלה. נסו שוב מאוחר יותר.',
    )
    err.status = e?.status || 502
    throw err
  }

  const passwordHash = await hashPassword(tempPassword)
  await writeState(
    {
      ...data,
      workers: data.workers.map((w) =>
        w.id === manager.id
          ? { ...w, passwordHash, mustChangePassword: true }
          : w,
      ),
    },
    { skipAudit: true, skipManagerInvites: true },
  )

  await appendAuditLog({
    action: 'password_reset',
    actor: { id: manager.id, fullName: manager.fullName, phone: manager.phone },
    details: `איפוס סיסמה נשלח אל ${manager.email}`,
  })

  return generic
}

/** Authenticated: re-send temporary password to a manager. */
export async function resendManagerTempPassword(workerId, actor) {
  const data = await readState()
  const manager = data.workers.find((w) => w.id === workerId)
  if (!manager || !manager.isManager) {
    const err = new Error('המשתמש אינו מנהל')
    err.status = 400
    throw err
  }
  if (!isValidEmail(manager.email)) {
    const err = new Error('למנהל חובה כתובת מייל תקינה לפני שליחת סיסמה')
    err.status = 400
    throw err
  }

  const tempPassword = generateTempPassword()
  await sendTempPasswordEmail({
    to: manager.email,
    fullName: manager.fullName,
    tempPassword,
    reason: 'invite',
  })

  const passwordHash = await hashPassword(tempPassword)
  await writeState(
    {
      ...data,
      workers: data.workers.map((w) =>
        w.id === manager.id
          ? { ...w, passwordHash, mustChangePassword: true }
          : w,
      ),
    },
    { skipAudit: true, skipManagerInvites: true },
  )

  await appendAuditLog({
    action: 'manager_invite',
    actor: actor || null,
    details: `סיסמה זמנית נשלחה מחדש אל ${manager.fullName} (${manager.email})`,
  })
  return { ok: true }
}

export async function upsertShift(id, body, actor, options = {}) {
  const state = await readState()
  const schedule = { ...body, id }
  delete schedule.actor
  delete schedule.expectedRevision

  const audienceOf = (h) => (h?.audience === 'selector' ? 'selector' : 'inspector')
  const conflict = (state.history || []).find(
    (h) =>
      h.id !== schedule.id &&
      h.date === schedule.date &&
      h.shiftType === schedule.shiftType &&
      audienceOf(h) === audienceOf(schedule),
  )
  if (conflict) {
    const err = new Error(
      'כבר קיים שיבוץ לאותו תאריך ואותה משמרת. לא ניתן ליצור שיבוץ כפול.',
    )
    err.status = 400
    throw err
  }

  const idx = state.history.findIndex((h) => h.id === schedule.id)
  const isNew = idx === -1
  const previous = isNew ? null : state.history[idx]
  const history =
    isNew
      ? [schedule, ...state.history]
      : state.history.map((h, i) => (i === idx ? { ...h, ...schedule } : h))
  const saved = await writeState(
    { ...state, history },
    {
      skipAudit: true,
      expectedRevision: options.expectedRevision,
    },
  )

  const header = shiftAuditHeader(schedule)
  const movement = summarizeAssignmentChanges(previous, schedule, {
    workers: state.workers,
    lanes: state.lanes,
  })
  const details = movement ? `${header} · ${movement}` : header

  await appendAuditLog({
    action: isNew ? 'shift_save' : 'shift_update',
    actor,
    details,
  })

  return saved
}

export async function deleteShift(id, actor, options = {}) {
  const state = await readState()
  const existing = state.history.find((h) => h.id === id)
  const saved = await writeState(
    {
      ...state,
      history: state.history.filter((h) => h.id !== id),
    },
    {
      skipAudit: true,
      expectedRevision: options.expectedRevision,
    },
  )
  await appendAuditLog({
    action: 'shift_delete',
    actor,
    details: existing
      ? `נמחק שיבוץ ${existing.date} · ${existing.shiftType}`
      : `נמחק שיבוץ ${id}`,
  })
  return saved
}
