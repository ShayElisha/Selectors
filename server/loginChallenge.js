import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { getDb } from './db.js'
import { sendLoginCodeEmail } from './mail.js'

const CHALLENGE_TTL_MS = 10 * 60_000
const MAX_ATTEMPTS = 5

let indexPromise

function httpError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

function secret() {
  const value = String(process.env.SESSION_SECRET || '').trim()
  if (value.length < 16) {
    throw httpError('אימות דו־שלבי אינו מוגדר בשרת', 503)
  }
  return value
}

function hashCode(challengeId, code) {
  return createHmac('sha256', secret())
    .update(`${challengeId}:${code}`)
    .digest()
}

function sameHash(left, right) {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

async function challenges() {
  const db = await getDb()
  const collection = db.collection('login_challenges')
  if (!indexPromise) {
    indexPromise = collection
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch((error) => {
        indexPromise = null
        throw error
      })
  }
  await indexPromise
  return collection
}

function maskEmail(email) {
  const [local, domain] = email.split('@')
  const visible = local.length > 1 ? `${local[0]}***${local.at(-1)}` : '*'
  return `${visible}@${domain}`
}

function identityReference(user) {
  return {
    id: String(user.id),
    role: user.role,
    orgId: user.orgId || null,
    module: user.module || null,
    ...(user.role === 'super_admin' ? { phone: String(user.phone) } : {}),
  }
}

export async function createLoginChallenge(
  user,
  { email, passwordChanged = false } = {},
) {
  const destination = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
    throw httpError('לא הוגדרה כתובת מייל תקינה לאימות. פנו למנהל המערכת.', 503)
  }

  const collection = await challenges()
  const challengeId = randomUUID()
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const now = Date.now()
  const challenge = {
    _id: challengeId,
    identity: identityReference(user),
    codeHash: hashCode(challengeId, code).toString('hex'),
    attempts: 0,
    passwordChanged: Boolean(passwordChanged),
    createdAt: new Date(now),
    expiresAt: new Date(now + CHALLENGE_TTL_MS),
  }

  await collection.insertOne(challenge)
  try {
    await sendLoginCodeEmail({
      to: destination,
      fullName: user.fullName || '',
      code,
    })
  } catch (error) {
    await collection.deleteOne({ _id: challengeId })
    throw error
  }

  return {
    next: 'verify_email',
    challengeId,
    emailHint: maskEmail(destination),
  }
}

export async function verifyLoginChallenge(challengeId, code) {
  const id = typeof challengeId === 'string' ? challengeId : ''
  const value = typeof code === 'string' ? code : ''
  if (!id || id.length > 64 || !/^\d{6}$/.test(value)) {
    throw httpError('קוד אימות שגוי או שפג תוקפו', 401)
  }

  const collection = await challenges()
  const now = new Date()
  const challenge = await collection.findOneAndUpdate(
    {
      _id: id,
      expiresAt: { $gt: now },
      attempts: { $lt: MAX_ATTEMPTS },
    },
    { $inc: { attempts: 1 } },
    { returnDocument: 'before' },
  )
  if (!challenge) {
    throw httpError('קוד אימות שגוי או שפג תוקפו', 401)
  }

  const expected = hashCode(id, value).toString('hex')
  if (!sameHash(challenge.codeHash, expected)) {
    throw httpError('קוד אימות שגוי או שפג תוקפו', 401)
  }

  const consumed = await collection.deleteOne({
    _id: id,
    codeHash: challenge.codeHash,
    expiresAt: { $gt: now },
  })
  if (consumed.deletedCount !== 1) {
    throw httpError('קוד אימות שגוי או שפג תוקפו', 401)
  }

  return {
    identity: challenge.identity,
    passwordChanged: Boolean(challenge.passwordChanged),
  }
}
