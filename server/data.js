import { randomUUID } from 'node:crypto'
import {
  getAuditCollection,
  getDb,
  getMetaCollection,
  getStateCollection,
  withDbTransaction,
} from './db.js'
import { appendAuditLog, diffAppDataAuditEvents, shiftAuditHeader, summarizeAssignmentChanges } from './audit.js'
import { sendTempPasswordEmail } from './mail.js'
import {
  generateTempPassword,
  hashPassword,
} from './password.js'
import {
  authenticateManager,
  createLegacyOrganization,
  disableWorkerAccount,
  requestAccountPasswordReset,
  upsertManagerAccount,
} from './orgs.js'

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
    customsBrokers: [],
  }
}

function uniqueLabels(values) {
  const seen = new Set()
  const out = []
  for (const value of values || []) {
    const label = String(value || '').trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  return out
}

function normalizeWorker(w, fallbackKind = 'selector') {
  const isManager = Boolean(w.isManager) || isDefaultManager(w)
  const hasInspectorFlag = Object.prototype.hasOwnProperty.call(w, 'isInspector')
  let isInspector = hasInspectorFlag ? Boolean(w.isInspector) : !isManager
  if (!isInspector && !isManager) isInspector = true
  const staffKind =
    w.staffKind === 'inspector' || w.staffKind === 'selector' ? w.staffKind : fallbackKind
  const isOrgManager = Boolean(w.isOrgManager)
  const worker = {
    id: w.id,
    fullName: w.fullName || '',
    phone: w.phone || '',
    email: normalizeEmail(w.email),
    certifications: uniqueLabels(w.certifications),
    status:
      w.status === 'inactive' || w.status === 'archived' ? w.status : 'active',
    isInspector,
    isManager: isManager || isOrgManager,
    staffKind,
    isOrgManager,
  }
  if (typeof w.passwordHash === 'string' && w.passwordHash) {
    worker.passwordHash = w.passwordHash
  }
  if ('mustChangePassword' in w) {
    worker.mustChangePassword = Boolean(w.mustChangePassword)
  }
  return worker
}

function normalizeShiftModels(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const id = String(item.id || '').trim()
      const name = String(item.name || '').trim()
      const startMinutes = Number(item.startMinutes)
      const endMinutes = Number(item.endMinutes)
      if (!id || !name) return null
      if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return null
      return {
        id,
        name,
        startMinutes: Math.max(0, Math.round(startMinutes)),
        endMinutes: Math.max(0, Math.round(endMinutes)),
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
}

function normalizeLane(l) {
  const std = Number(l?.staffingStandard)
  const staffingStandard =
    Number.isInteger(std) && std >= 1 && std <= 5 ? std : 1
  return {
    id: l.id,
    name: l.name || '',
    staffingStandard,
    requiredCertifications: uniqueLabels(l.requiredCertifications),
    intensity:
      l.intensity === 'easy' || l.intensity === 'hard' || l.intensity === 'medium'
        ? l.intensity
        : 'medium',
    afternoonHandoff: Boolean(l.afternoonHandoff),
    ...(Array.isArray(l.activeHours) && l.activeHours.length > 0
      ? {
          activeHours: l.activeHours
            .map((h) => ({
              start: Math.trunc(Number(h?.start)),
              end: Math.trunc(Number(h?.end)),
            }))
            .filter(
              (h) =>
                Number.isFinite(h.start) &&
                Number.isFinite(h.end) &&
                h.start >= 0 &&
                h.end <= 36 * 60 &&
                h.end > h.start,
            ),
        }
      : {}),
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
  const raw = Array.isArray(list) ? list : []
  if (raw.length === 0) return []
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

export function normalizeData(raw, fallbackKind = 'selector') {
  const kind = fallbackKind === 'inspector' ? 'inspector' : 'selector'
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
    workers: Array.isArray(raw?.workers)
      ? raw.workers.map((worker) => normalizeWorker(worker, kind))
      : [],
    lanes,
    history: Array.isArray(raw?.history) ? raw.history : [],
    certificationsCatalog: Array.isArray(raw?.certificationsCatalog)
      ? uniqueLabels(raw.certificationsCatalog)
      : [...DEFAULT_CERTIFICATIONS],
    briefingSections,
    questionBank,
    customsBrokers: normalizeCustomsBrokersList(raw?.customsBrokers),
    shiftModels: normalizeShiftModels(raw?.shiftModels),
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

function assertOrgManagerEdits(nextWorkers, prevWorkers, actor) {
  if (actor?.isOrgManager || actor?.role === 'super_admin') return
  const prevById = new Map((prevWorkers || []).map((worker) => [worker.id, worker]))
  for (const worker of nextWorkers) {
    const prev = prevById.get(worker.id)
    if (Boolean(prev?.isOrgManager) !== Boolean(worker.isOrgManager)) {
      const err = new Error('רק מנהל ארגון יכול למנות או להסיר מנהל ארגון')
      err.status = 403
      throw err
    }
  }
}

async function syncManagerAccess(workers, orgId) {
  if (!orgId) return
  for (const worker of workers) {
    if (!worker.isManager && !worker.isOrgManager) continue
    if (!worker.phone) continue
    await upsertManagerAccount({
      orgId,
      workerId: worker.id,
      fullName: worker.fullName,
      phone: worker.phone,
      email: worker.email,
      staffKind: worker.staffKind === 'inspector' ? 'inspector' : 'selector',
      isOrgManager: Boolean(worker.isOrgManager),
    })
  }
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
    if (options.scope?.orgId && prev?.isManager && !w.isManager) {
      await disableWorkerAccount(options.scope.orgId, w.id)
    }
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
    const invited = {
      ...w,
      passwordHash,
      mustChangePassword: true,
    }
    if (options.scope?.orgId) {
      await upsertManagerAccount({
        orgId: options.scope.orgId,
        workerId: w.id,
        fullName: w.fullName,
        phone: w.phone,
        email: w.email,
        passwordHash,
        mustChangePassword: true,
        staffKind: w.staffKind,
        isOrgManager: Boolean(w.isOrgManager),
      })
    }
    nextWorkers.push(invited)
    await appendAuditLog({
      action: 'manager_invite',
      actor: options.actor || null,
      orgId: options.scope?.orgId,
      module: options.scope?.module,
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

const MODEL_COLLECTIONS = {
  workers: 'workers',
  lanes: 'lanes',
  shifts: 'shifts',
  certifications: 'certifications',
  briefingSections: 'briefing_sections',
  questionBank: 'questions',
  customsBrokers: 'customs_brokers',
  shiftModels: 'shift_models',
}

function orderedDocs(items) {
  return items.map((item, listOrder) => {
    const id = item?.id || randomUUID()
    return { ...item, id, _id: id, listOrder }
  })
}

function fromOrderedDocs(docs) {
  return [...docs]
    .sort((a, b) => (a.listOrder ?? 0) - (b.listOrder ?? 0))
    .map(({ _id: _ignored, listOrder: _order, orgId: _org, module: _module, ...item }) => item)
}

function scopeFilter(scope) {
  if (!scope) return { orgId: { $exists: false } }
  return { orgId: scope.orgId, module: scope.module }
}

function metaIdFor(scope) {
  return scope ? `${scope.orgId}:${scope.module}` : 'main'
}

function stampScope(doc, scope) {
  if (!scope) return doc
  const next = { ...doc, orgId: scope.orgId, module: scope.module }
  if (doc.id) next._id = `${scope.orgId}:${scope.module}:${doc.id}`
  return next
}

async function loadModelDocs(db, name, session, scope) {
  const query = db.collection(name).find(
    scopeFilter(scope),
    session ? { session } : {},
  )
  return query.toArray()
}

async function assembleState(revision, session, scope, target = 'selectors') {
  const db = await getDb(target)
  const read = (name) => loadModelDocs(db, name, session, scope)
  const workers = fromOrderedDocs(await read(MODEL_COLLECTIONS.workers))
  const lanes = fromOrderedDocs(await read(MODEL_COLLECTIONS.lanes))
  const history = fromOrderedDocs(await read(MODEL_COLLECTIONS.shifts))
  const certifications = fromOrderedDocs(
    await read(MODEL_COLLECTIONS.certifications),
  )
  const briefingSections = fromOrderedDocs(
    await read(MODEL_COLLECTIONS.briefingSections),
  )
  const questionBank = fromOrderedDocs(await read(MODEL_COLLECTIONS.questionBank))
  const customsBrokers = fromOrderedDocs(
    await read(MODEL_COLLECTIONS.customsBrokers),
  )
  const shiftModels = fromOrderedDocs(await read(MODEL_COLLECTIONS.shiftModels))
  return normalizeData(
    {
      workers,
      lanes,
      history,
      certificationsCatalog: certifications.map((item) => item.name),
      briefingSections,
      questionBank,
      customsBrokers,
      shiftModels,
      revision: Number.isFinite(Number(revision)) ? Number(revision) : 0,
    },
    scope?.module === 'inspectors' ? 'inspector' : 'selector',
  )
}

async function replaceModels(snapshot, revision, session, scope = null, target = 'selectors') {
  const db = await getDb(target)
  const certPrefix = scope ? `${scope.orgId}:${scope.module}:cert` : 'cert'
  const models = [
    [
      MODEL_COLLECTIONS.workers,
      orderedDocs(snapshot.workers || []).map((doc) => stampScope(doc, scope)),
    ],
    [
      MODEL_COLLECTIONS.lanes,
      orderedDocs(snapshot.lanes || []).map((doc) => stampScope(doc, scope)),
    ],
    [
      MODEL_COLLECTIONS.shifts,
      orderedDocs(snapshot.history || []).map((doc) => stampScope(doc, scope)),
    ],
    [
      MODEL_COLLECTIONS.certifications,
      (snapshot.certificationsCatalog || []).map((name, listOrder) =>
        stampScope(
          {
            _id: `${certPrefix}:${listOrder}`,
            name: String(name),
            listOrder,
          },
          scope,
        ),
      ),
    ],
    [
      MODEL_COLLECTIONS.briefingSections,
      orderedDocs(snapshot.briefingSections || []).map((doc) => stampScope(doc, scope)),
    ],
    [
      MODEL_COLLECTIONS.questionBank,
      orderedDocs(snapshot.questionBank || []).map((doc) => stampScope(doc, scope)),
    ],
    [
      MODEL_COLLECTIONS.customsBrokers,
      orderedDocs(snapshot.customsBrokers || []).map((doc) => stampScope(doc, scope)),
    ],
    [
      MODEL_COLLECTIONS.shiftModels,
      orderedDocs(snapshot.shiftModels || []).map((doc) => stampScope(doc, scope)),
    ],
  ]
  for (const [name, docs] of models) {
    const col = db.collection(name)
    const opts = session ? { session } : {}
    await col.deleteMany(scopeFilter(scope), opts)
    if (docs.length > 0) await col.insertMany(docs, opts)
  }
  const meta = await getMetaCollection(target)
  await meta.updateOne(
    { _id: metaIdFor(scope) },
    {
      $set: {
        schema: 'collections',
        revision,
        updatedAt: new Date(),
      },
    },
    { upsert: true, ...(session ? { session } : {}) },
  )
}

async function migrateLegacyState(session, target = 'selectors') {
  const metaCol = await getMetaCollection(target)
  const opts = session ? { session } : {}
  const meta = await metaCol.findOne({ _id: 'main' }, opts)
  if (meta?.schema === 'collections') {
    return assembleState(meta.revision, session, null, target)
  }

  const legacyCol = await getStateCollection(target)
  const legacy = await legacyCol.findOne({ _id: 'main' }, opts)
  const source = legacy ? normalizeData(legacy) : createSeedData()
  const revision = legacy
    ? Number.isFinite(Number(legacy.revision))
      ? Number(legacy.revision)
      : 1
    : 1
  await replaceModels(
    {
      workers: source.workers,
      lanes: source.lanes,
      history: source.history,
      certificationsCatalog: source.certificationsCatalog,
      briefingSections: source.briefingSections,
      questionBank: source.questionBank,
      customsBrokers: source.customsBrokers,
    },
    revision,
    session,
    null,
    target,
  )
  if (legacy) {
    await legacyCol.updateOne(
      { _id: 'main' },
      { $set: { archivedAt: new Date(), supersededBy: 'collections' } },
      opts,
    )
  }
  return { ...source, revision }
}

let tenancyMigration = null

function snapshotOf(source) {
  return {
    workers: source.workers,
    lanes: source.lanes,
    history: source.history,
    certificationsCatalog: source.certificationsCatalog,
    briefingSections: source.briefingSections,
    questionBank: source.questionBank,
    customsBrokers: source.customsBrokers,
    shiftModels: source.shiftModels,
  }
}

async function hasStoredOperationalData(target = 'selectors') {
  const db = await getDb(target)
  for (const name of Object.values(MODEL_COLLECTIONS)) {
    const count = await db.collection(name).countDocuments({ orgId: { $exists: false } })
    if (count > 0) return true
  }
  const legacyCol = await getStateCollection(target)
  const legacy = await legacyCol.findOne({ _id: 'main' })
  if (!legacy || legacy.archivedAt || legacy.supersededBy === 'tenancy') return false
  return Boolean(
    (Array.isArray(legacy.workers) && legacy.workers.length) ||
      (Array.isArray(legacy.lanes) && legacy.lanes.length) ||
      (Array.isArray(legacy.history) && legacy.history.length),
  )
}

/** Move the previous single-body database into one approved organization. */
export async function migrateLegacyTenancy() {
  if (!tenancyMigration) {
    tenancyMigration = runLegacyTenancyMigration().catch((err) => {
      tenancyMigration = null
      throw err
    })
  }
  return tenancyMigration
}

async function runLegacyTenancyMigration() {
  const metaCol = await getMetaCollection()
  const done = await metaCol.findOne({ _id: 'tenancy-v1' })
  if (done?.done) return

  const exists = await hasStoredOperationalData()
  if (exists) {
    const meta = await metaCol.findOne({ _id: 'main' })
    let source
    if (meta?.schema === 'collections') {
      source = await assembleState(meta.revision, undefined, null)
    } else {
      source = await migrateLegacyState()
    }
    const hasRows =
      source.workers.length > 0 ||
      source.lanes.length > 0 ||
      source.history.length > 0
    if (hasRows) {
      const orgId = await createLegacyOrganization(source.workers)
      const revision = source.revision || 1
      await replaceModels(
        { ...snapshotOf(source), history: source.history },
        revision,
        undefined,
        { orgId, module: 'selectors' },
      )
      await replaceModels(
        { ...snapshotOf(source), history: [] },
        revision,
        undefined,
        { orgId, module: 'inspectors' },
      )
      const db = await getDb()
      for (const name of Object.values(MODEL_COLLECTIONS)) {
        await db.collection(name).deleteMany({ orgId: { $exists: false } })
      }
    }
  }

  await metaCol.updateOne(
    { _id: 'tenancy-v1' },
    { $set: { done: true, at: new Date() } },
    { upsert: true },
  )
}

function emptyState() {
  return normalizeData({
    workers: [],
    lanes: [],
    history: [],
    certificationsCatalog: [],
    briefingSections: [],
    questionBank: [],
    customsBrokers: [],
    shiftModels: [],
    revision: 0,
  })
}

function targetForScope(scope) {
  return scope?.module === 'inspectors' ? 'inspectors' : 'selectors'
}

let inspectorsMigration = null

/** Attach the existing inspectors database to the original organization. */
export async function migrateInspectorsDatabase() {
  if (!process.env.MONGODB_URI_INSPECTORS?.trim()) return
  if (!inspectorsMigration) {
    inspectorsMigration = runInspectorsMigration().catch((err) => {
      inspectorsMigration = null
      throw err
    })
  }
  return inspectorsMigration
}

async function runInspectorsMigration() {
  const target = 'inspectors'
  const metaCol = await getMetaCollection(target)
  const done = await metaCol.findOne({ _id: 'inspectors-tenancy-v1' })
  if (done?.done) return

  const exists = await hasStoredOperationalData(target)
  if (!exists) {
    await metaCol.updateOne(
      { _id: 'inspectors-tenancy-v1' },
      { $set: { done: true, at: new Date(), empty: true } },
      { upsert: true },
    )
    return
  }

  const meta = await metaCol.findOne({ _id: 'main' })
  const source =
    meta?.schema === 'collections'
      ? await assembleState(meta.revision, undefined, null, target)
      : await migrateLegacyState(undefined, target)

  const orgId = await createLegacyOrganization(source.workers)
  const revision = source.revision || 1
  await replaceModels(
    snapshotOf(source),
    revision,
    undefined,
    { orgId, module: 'inspectors' },
    target,
  )
  const db = await getDb(target)
  for (const name of Object.values(MODEL_COLLECTIONS)) {
    await db.collection(name).deleteMany({ orgId: { $exists: false } })
  }
  const audit = await getAuditCollection(target)
  await audit.updateMany(
    { orgId: { $exists: false } },
    { $set: { orgId, module: 'inspectors' } },
  )
  await metaCol.updateOne(
    { _id: 'inspectors-tenancy-v1' },
    { $set: { done: true, at: new Date(), orgId } },
    { upsert: true },
  )
}

function modelId(doc) {
  return String(doc?.id || doc?._id || '')
}

/** Copy documents that still sit in the module collections without an organization. */
export function modelsMissingFromScope(unscoped, scopedIds) {
  const have = new Set(scopedIds)
  const missing = []
  for (const doc of unscoped || []) {
    const id = modelId(doc)
    if (!id || have.has(id)) continue
    have.add(id)
    missing.push(doc)
  }
  return missing
}

export async function importUnscopedInspectorModels(scope) {
  const db = await getDb('inspectors')
  const metaCol = await getMetaCollection('inspectors')
  let imported = 0
  for (const name of Object.values(MODEL_COLLECTIONS)) {
    const col = db.collection(name)
    const unscoped = await col.find({ orgId: { $exists: false } }).toArray()
    if (unscoped.length === 0) continue
    const scoped = await col.find(scopeFilter(scope)).project({ id: 1 }).toArray()
    const missing = modelsMissingFromScope(
      unscoped,
      scoped.map((doc) => modelId(doc)),
    )
    if (missing.length === 0) continue
    const docs = missing.map((item) => {
      const {
        _id: _ignored,
        orgId: _org,
        module: _module,
        ...rest
      } = item
      return stampScope({ ...rest, id: modelId(item) }, scope)
    })
    try {
      await col.insertMany(docs, { ordered: false })
    } catch (err) {
      const writeErrors = Array.isArray(err?.writeErrors) ? err.writeErrors : []
      const onlyDuplicates =
        err?.code === 11000 ||
        (writeErrors.length > 0 && writeErrors.every((entry) => entry.code === 11000))
      if (!onlyDuplicates) throw err
    }
    imported += missing.length
  }
  if (imported > 0) {
    await metaCol.updateOne(
      { _id: metaIdFor(scope) },
      { $inc: { revision: imported }, $set: { updatedAt: new Date() } },
    )
  }
  return imported
}

const stateCache = new Map()
const STATE_CACHE_MS = 20_000

function stateCacheKey(scope) {
  return `${scope.orgId}:${scope.module}`
}

/** Drop the assembled snapshot so the next read hits Mongo again. */
export function invalidateStateCache(scope) {
  if (!scope?.orgId) {
    stateCache.clear()
    return
  }
  stateCache.delete(stateCacheKey(scope))
}

export async function readState(scope) {
  if (!scope?.orgId || !scope?.module) {
    const err = new Error('חסר הקשר ארגון')
    err.status = 400
    throw err
  }
  const target = targetForScope(scope)
  if (target === 'inspectors') {
    await migrateInspectorsDatabase()
    await importUnscopedInspectorModels(scope)
  } else {
    await migrateLegacyTenancy()
  }
  const metaCol = await getMetaCollection(target)
  const meta = await metaCol.findOne({ _id: metaIdFor(scope) })
  if (meta?.schema === 'collections') {
    const key = stateCacheKey(scope)
    const cached = stateCache.get(key)
    const revision = Number(meta.revision ?? 0)
    if (
      cached &&
      cached.revision === revision &&
      Date.now() - cached.at < STATE_CACHE_MS
    ) {
      return cached.state
    }
    const state = await assembleState(meta.revision, undefined, scope, target)
    stateCache.set(key, { at: Date.now(), revision, state })
    return state
  }
  return emptyState()
}

/** One page of saved shifts, newest first, without loading the whole history. */
export async function listHistoryPage(scope, query = {}) {
  if (!scope?.orgId || !scope?.module) {
    const err = new Error('חסר הקשר ארגון')
    err.status = 400
    throw err
  }
  const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 60)
  const offset = Math.max(Number(query.offset) || 0, 0)
  const target = targetForScope(scope)
  const db = await getDb(target)
  const filter = { ...scopeFilter(scope) }
  if (query.from || query.to) {
    filter.date = {}
    if (query.from) filter.date.$gte = String(query.from)
    if (query.to) filter.date.$lte = String(query.to)
  }
  const col = db.collection(MODEL_COLLECTIONS.shifts)
  const total = await col.countDocuments(filter)
  const docs = await col
    .find(filter)
    .sort({ date: -1, updatedAt: -1 })
    .skip(offset)
    .limit(limit)
    .toArray()
  return { total, offset, limit, items: fromOrderedDocs(docs) }
}

export async function writeState(data, options = {}) {
  const scope = options.scope
  if (!scope?.orgId || !scope?.module) {
    const err = new Error('חסר הקשר ארגון')
    err.status = 400
    throw err
  }
  const prev = await readState(scope)
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

  const normalized = normalizeData(
    data,
    scope.module === 'inspectors' ? 'inspector' : 'selector',
  )
  let workers = mergeWorkerSecrets(normalized.workers, prev?.workers)
  assertOrgManagerEdits(workers, prev?.workers, options.actor)
  if (!options.skipManagerInvites) {
    assertManagersHaveEmail(workers, prev?.workers)
  }

  const invited = await applyManagerInvites(workers, prev?.workers, options)
  workers = invited.workers
  await syncManagerAccess(workers, scope.orgId)

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
    shiftModels: payload.shiftModels ?? [],
  }

  const target = targetForScope(scope)
  await withDbTransaction(async (session) => {
    const metaCol = await getMetaCollection(target)
    const opts = session ? { session } : {}
    const meta = await metaCol.findOne({ _id: metaIdFor(scope) }, opts)
    const liveRevision = Number(meta?.revision ?? 0)
    if (
      options.expectedRevision != null &&
      Number(options.expectedRevision) !== liveRevision
    ) {
      const err = new Error(
        'הנתונים עודכנו ע״י מנהל אחר. רעננו את המסך וחזרו על השינוי.',
      )
      err.status = 409
      throw err
    }
    await replaceModels(toStore, nextRevision, session, scope, target)
  }, target)

  const result = { ...payload, revision: nextRevision }

  if (!options.skipAudit) {
    if (options.action === 'data_reset') {
      await appendAuditLog({
        action: 'data_reset',
        actor: options.actor,
        details: options.details || 'איפוס לכל נתוני הדוגמה',
        orgId: scope.orgId,
        module: scope.module,
      })
    } else if (prev) {
      const events = diffAppDataAuditEvents(prev, result)
      for (const ev of events) {
        await appendAuditLog({
          action: ev.action,
          actor: options.actor,
          details: ev.details,
          orgId: scope.orgId,
          module: scope.module,
        })
      }
    }
  }

  invalidateStateCache(scope)
  return publicData(result)
}

export async function loginByPhone(phoneRaw, credentials = {}) {
  return authenticateManager(phoneRaw, credentials)
}

/** Self-service: email a new temporary password to an organization manager. */
export async function requestPasswordReset(phoneRaw) {
  return requestAccountPasswordReset(phoneRaw)
}

/** Authenticated: re-send temporary password to a manager. */
export async function resendManagerTempPassword(workerId, actor, options = {}) {
  const scope = options.scope
  const data = await readState(scope)
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
  await upsertManagerAccount({
    orgId: scope.orgId,
    workerId: manager.id,
    fullName: manager.fullName,
    phone: manager.phone,
    email: manager.email,
    passwordHash,
    mustChangePassword: true,
  })
  await writeState(
    {
      ...data,
      workers: data.workers.map((w) =>
        w.id === manager.id
          ? { ...w, passwordHash, mustChangePassword: true }
          : w,
      ),
    },
    { skipAudit: true, skipManagerInvites: true, scope },
  )

  await appendAuditLog({
    action: 'manager_invite',
    actor: actor || null,
    orgId: scope.orgId,
    module: scope.module,
    details: `סיסמה זמנית נשלחה מחדש אל ${manager.fullName} (${manager.email})`,
  })
  return { ok: true }
}

export async function upsertShift(id, body, actor, options = {}) {
  const scope = options.scope
  const state = await readState(scope)
  const schedule = { ...body, id }
  delete schedule.actor
  delete schedule.expectedRevision
  if (schedule.assignmentMode !== 'rounds' && schedule.assignmentMode !== 'single') {
    schedule.assignmentMode =
      schedule.audience === 'selector' ||
      (scope?.module !== 'inspectors' &&
        Array.isArray(schedule.rounds) &&
        schedule.rounds.length > 0)
        ? 'rounds'
        : 'single'
  }
  if (scope?.module === 'inspectors') {
    schedule.audience = 'inspector'
  }
  if (schedule.assignmentMode !== 'rounds') {
    delete schedule.rounds
  }

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
      scope,
      actor,
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
    orgId: scope?.orgId,
    module: scope?.module,
  })

  return saved
}

export async function deleteShift(id, actor, options = {}) {
  const scope = options.scope
  const state = await readState(scope)
  const existing = state.history.find((h) => h.id === id)
  const saved = await writeState(
    {
      ...state,
      history: state.history.filter((h) => h.id !== id),
    },
    {
      skipAudit: true,
      expectedRevision: options.expectedRevision,
      scope,
      actor,
    },
  )
  await appendAuditLog({
    action: 'shift_delete',
    actor,
    details: existing
      ? `נמחק שיבוץ ${existing.date} · ${existing.shiftType}`
      : `נמחק שיבוץ ${id}`,
    orgId: scope?.orgId,
    module: scope?.module,
  })
  return saved
}
