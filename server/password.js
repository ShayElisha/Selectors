import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const MIN_LENGTH = 8
const SCRYPT_KEYLEN = 64

/** @param {string} password */
export function validatePasswordRules(password) {
  if (typeof password !== 'string' || !password) {
    return 'נא להזין סיסמה'
  }
  if (password.length < MIN_LENGTH) {
    return `הסיסמה חייבת להכיל לפחות ${MIN_LENGTH} תווים`
  }
  if (!/[A-Z]/.test(password)) {
    return 'הסיסמה חייבת להכיל לפחות אות גדולה אחת באנגלית'
  }
  if (!/[0-9]/.test(password)) {
    return 'הסיסמה חייבת להכיל לפחות ספרה אחת'
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'הסיסמה חייבת להכיל לפחות סימן מיוחד אחד'
  }
  return null
}

/** First-login / reset code sent by email: exactly 6 digits. */
export function generateTempPassword() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** @param {string} password */
export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = /** @type {Buffer} */ (
    await scryptAsync(password, salt, SCRYPT_KEYLEN)
  )
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

/**
 * @param {string} password
 * @param {string} stored
 */
export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const salt = Buffer.from(parts[1], 'base64url')
    const expected = Buffer.from(parts[2], 'base64url')
    const derived = /** @type {Buffer} */ (
      await scryptAsync(password, salt, expected.length)
    )
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}
