import { getDb, operationalDbTargets } from '../server/db.js'
import { assertPiiEncryptionConfigured, sealWorkerPii } from '../server/piiCrypto.js'

const APPLY = process.argv.includes('--apply')
const EMAIL_RE = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g
const PHONE_RE = /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g
const PRIVATE_KEYS = new Set([
  'email',
  'phone',
  'managerNotes',
  'phoneSealed',
  'phoneLookup',
  'emailLookup',
])

function scrubAuditValue(value) {
  if (Array.isArray(value)) return value.map(scrubAuditValue)
  if (!value || typeof value !== 'object') {
    return typeof value === 'string'
      ? value.replace(EMAIL_RE, '[redacted]').replace(PHONE_RE, '[redacted]')
      : value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_KEYS.has(key))
      .map(([key, child]) => [key, scrubAuditValue(child)]),
  )
}

async function migrateTarget(target) {
  const db = await getDb(target)
  const workers = db.collection('workers')
  let scannedWorkers = 0
  let changedWorkers = 0
  const cursor = workers.find({})
  for await (const worker of cursor) {
    scannedWorkers += 1
    const sealed = sealWorkerPii(worker)
    const set = {}
    for (const field of [
      'email',
      'phone',
      'managerNotes',
      'emailLookup',
      'phoneLookup',
    ]) {
      if (sealed[field] !== worker[field]) set[field] = sealed[field]
    }
    if (Object.keys(set).length || worker.phoneSealed) {
      changedWorkers += 1
      if (APPLY) {
        await workers.updateOne(
          { _id: worker._id },
          {
            ...(Object.keys(set).length ? { $set: set } : {}),
            ...(worker.phoneSealed ? { $unset: { phoneSealed: '' } } : {}),
          },
        )
      }
    }
  }

  const audit = db.collection('audit_logs')
  let scannedAudit = 0
  let changedAudit = 0
  const auditCursor = audit.find({})
  for await (const entry of auditCursor) {
    scannedAudit += 1
    const actor = scrubAuditValue(entry.actor)
    const before = scrubAuditValue(entry.before)
    const after = scrubAuditValue(entry.after)
    const details =
      typeof entry.details === 'string'
        ? entry.details.replace(EMAIL_RE, '[redacted]').replace(PHONE_RE, '[redacted]')
        : entry.details
    const set = {}
    if (JSON.stringify(actor) !== JSON.stringify(entry.actor)) set.actor = actor
    if (JSON.stringify(before) !== JSON.stringify(entry.before)) set.before = before
    if (JSON.stringify(after) !== JSON.stringify(entry.after)) set.after = after
    if (details !== entry.details) set.details = details
    if (Object.keys(set).length) {
      changedAudit += 1
      if (APPLY) await audit.updateOne({ _id: entry._id }, { $set: set })
    }
  }

  return { target, scannedWorkers, changedWorkers, scannedAudit, changedAudit }
}

async function main() {
  if (!assertPiiEncryptionConfigured()) {
    throw new Error('Configure a 32+ character active PII encryption key before migration')
  }
  if (!APPLY) {
    console.log('Dry run only. Review counts, take a database backup, then rerun with --apply.')
  }
  const results = []
  for (const target of operationalDbTargets()) {
    results.push(await migrateTarget(target))
  }
  for (const result of results) console.log(JSON.stringify(result))
}

main().catch((error) => {
  console.error('PII migration failed:', error.message)
  process.exitCode = 1
})
