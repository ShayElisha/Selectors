import { getDb } from './db.js'
import { appendAuditLog } from './audit.js'
import { readState } from './data.js'
import { listOrganizations } from './orgs.js'

/** Rest credit applied for a full day without real work. */
export const LOAD_REST_DELTA = -2

/**
 * Calendar date YYYY-MM-DD in Asia/Jerusalem.
 * @param {Date} [now]
 */
export function israelDateISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Yesterday in Asia/Jerusalem.
 * @param {Date} [now]
 */
export function israelYesterdayISO(now = new Date()) {
  const today = israelDateISO(now)
  const [y, m, d] = today.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  utc.setUTCDate(utc.getUTCDate() - 1)
  const yy = utc.getUTCFullYear()
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(utc.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * True when the worker had a real seat or was gate manager on the shift.
 * Presence alone does not count as work (same rule as the load engine).
 * @param {string} workerId
 * @param {object} shift
 */
export function workerWorkedOnShift(workerId, shift) {
  if (!workerId || !shift) return false
  if (String(shift.gateManagerWorkerId || '').trim() === workerId) return true
  for (const assignment of shift.assignments || []) {
    if ((assignment.workerIds || []).includes(workerId)) return true
  }
  for (const round of shift.rounds || []) {
    for (const assignment of round.assignments || []) {
      if ((assignment.workerIds || []).includes(workerId)) return true
    }
  }
  for (const segment of shift.seatSegments || []) {
    if (segment.workerId === workerId) return true
  }
  return false
}

/**
 * @param {string} workerId
 * @param {object[]} shifts
 * @param {string} date
 */
export function workerWorkedOnDate(workerId, shifts, date) {
  return (shifts || []).some(
    (shift) => shift.date === date && workerWorkedOnShift(workerId, shift),
  )
}

/**
 * Active roster members who should receive rest credit when idle.
 * @param {object[]} workers
 */
function restEligibleWorkers(workers) {
  return (workers || []).filter((worker) => {
    if (!worker || worker.status === 'inactive' || worker.status === 'archived') {
      return false
    }
    return Boolean(worker.isInspector) || worker.staffKind === 'selector'
  })
}

/**
 * Apply daily rest for one org module: workers who did not work `date`
 * get a −2 rest credit recorded (idempotent per worker+date).
 * The live עומס number still comes from history via accumulateLoadBalance;
 * this run persists the nightly check and audit trail.
 *
 * @param {{ orgId: string, module: 'inspectors' | 'selectors', date: string }} args
 */
export async function applyLoadRestForScope({ orgId, module, date }) {
  const scope = { orgId, module }
  const state = await readState(scope)
  const workers = restEligibleWorkers(state.workers)
  const history = state.history || []
  const rested = []
  const worked = []

  const db = await getDb(module === 'inspectors' ? 'inspectors' : 'selectors')
  const col = db.collection('load_rest_credits')

  for (const worker of workers) {
    const didWork = workerWorkedOnDate(worker.id, history, date)
    if (didWork) {
      worked.push(worker.id)
      continue
    }
    const _id = `${orgId}:${module}:${worker.id}:${date}`
    await col.updateOne(
      { _id },
      {
        $setOnInsert: {
          _id,
          orgId,
          module,
          workerId: worker.id,
          workerName: worker.fullName || '',
          date,
          delta: LOAD_REST_DELTA,
          createdAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    )
    rested.push({ id: worker.id, fullName: worker.fullName || '' })
  }

  if (rested.length > 0) {
    await appendAuditLog({
      action: 'load_rest_cron',
      actor: { id: 'cron', fullName: 'Load rest cron', phone: '' },
      details: `מנוחה יומית ${date}: ${rested.length} לא עבדו (−2), ${worked.length} עבדו`,
      orgId,
      module,
    })
  }

  return {
    orgId,
    module,
    date,
    restedCount: rested.length,
    workedCount: worked.length,
    rested,
  }
}

/**
 * Run the nightly rest check for every approved organization.
 * @param {{ date?: string, now?: Date }} [opts]
 */
export async function runDailyLoadRest(opts = {}) {
  const date = opts.date || israelYesterdayISO(opts.now)
  const orgs = await listOrganizations()
  const approved = orgs.filter((org) => org.status === 'approved' && !org.deletedAt)
  const results = []

  for (const org of approved) {
    const modules = []
    if (org.modules?.inspectors) modules.push('inspectors')
    if (org.modules?.selectors) modules.push('selectors')
    for (const module of modules) {
      try {
        results.push(
          await applyLoadRestForScope({ orgId: org.id, module, date }),
        )
      } catch (err) {
        results.push({
          orgId: org.id,
          module,
          date,
          error: err?.message || String(err),
        })
      }
    }
  }

  const restedTotal = results.reduce(
    (sum, row) => sum + (row.restedCount || 0),
    0,
  )
  return {
    ok: true,
    date,
    at: new Date().toISOString(),
    orgs: results.length,
    restedTotal,
    results,
  }
}

/**
 * Schedule a local daily tick at 02:00 Asia/Jerusalem when the API
 * process stays up (npm run start:api / dev:api). Vercel uses vercel.json crons.
 */
export function scheduleLocalLoadRestCron() {
  if (process.env.LOAD_REST_CRON === '0') return () => {}
  let lastRunKey = ''
  const tick = async () => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date())
      const get = (type) => parts.find((p) => p.type === type)?.value || ''
      const hour = Number(get('hour'))
      const minute = Number(get('minute'))
      if (hour !== 2 || minute > 1) return
      const day = `${get('year')}-${get('month')}-${get('day')}`
      const key = `${day}@02`
      if (key === lastRunKey) return
      lastRunKey = key
      const summary = await runDailyLoadRest()
      console.log(
        `[load-rest] ${summary.date}: rested ${summary.restedTotal} across ${summary.orgs} scopes`,
      )
    } catch (err) {
      console.error('[load-rest] cron failed', err?.message || err)
    }
  }
  const id = setInterval(tick, 30_000)
  tick()
  return () => clearInterval(id)
}
