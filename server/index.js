import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import cors from 'cors'
import express from 'express'
import {
  appendClientAuditEvent,
  listAuditLogs,
} from './audit.js'
import {
  createSeedData,
  deleteShift,
  loginByPhone,
  migrateInspectorsDatabase,
  migrateLegacyTenancy,
  publicData,
  readState,
  requestPasswordReset,
  resendManagerTempPassword,
  upsertShift,
  writeState,
} from './data.js'
import { getDb } from './db.js'
import { isSmtpConfigured, sendTestEmail } from './mail.js'
import { changeOwnPassword, deleteOrganization, ensureOrgIndexes, listOrganizations, readOrgAssignmentSettings, refreshManagerSession, registerOrganization, restoreOrganization, reviewOrganization, updateOrgAssignmentSettings } from './orgs.js'
import { assertRateLimit, clientKey } from './rateLimit.js'
import { scopeForRequest } from './scope.js'
import { createSessionToken, getBearerToken, requireSuperAdmin, requireUser, verifySessionToken } from './session.js'
import { submitBugReport } from './support.js'

const PORT = Number(process.env.PORT || 3001)

const app = express()
app.use(cors())
app.use((req, res, next) => {
  if (req.body != null && typeof req.body === 'object') {
    next()
    return
  }
  express.json({ limit: '5mb' })(req, res, next)
})

function sendError(res, err) {
  const status = err.status || 500
  if (status >= 500) console.error(err?.message || err)
  const body = { error: err.message || 'שגיאת שרת' }
  if (err.current) body.current = err.current
  if (err.retryAfterSec) body.retryAfterSec = err.retryAfterSec
  if (err.code) body.code = err.code
  res.status(status).json(body)
}

app.get('/api/health', async (_req, res) => {
  try {
    await getDb('selectors')
    if (process.env.MONGODB_URI_INSPECTORS?.trim()) await getDb('inspectors')
    res.json({
      ok: true,
      db: true,
      smtpConfigured: isSmtpConfigured(),
      at: new Date().toISOString(),
      service: 'shibutzon-api',
    })
  } catch {
    res.status(500).json({ ok: false, db: false, smtpConfigured: isSmtpConfigured() })
  }
})

app.post('/api/login', async (req, res) => {
  try {
    const phone = String(req.body?.phone || '')
    await assertRateLimit({
      key: `login:${clientKey(req)}:${phone.replace(/\D/g, '') || 'empty'}`,
      limit: 10,
      windowMs: 15 * 60_000,
    })
    const result = await loginByPhone(phone, {
      password: req.body?.password,
      passwordConfirm: req.body?.passwordConfirm,
      newPassword: req.body?.newPassword,
      newPasswordConfirm: req.body?.newPasswordConfirm,
    })
    if (result.next) {
      res.json(result)
      return
    }
    const token = createSessionToken(result)
    res.json({ ...result, token })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/password', async (req, res) => {
  try {
    const user = requireUser(req)
    await assertRateLimit({
      key: `password:${user.id}`,
      limit: 8,
      windowMs: 15 * 60_000,
    })
    res.json(await changeOwnPassword(user, req.body || {}))
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/bug-reports', async (req, res) => {
  try {
    await assertRateLimit({
      key: `bug:${clientKey(req)}`,
      limit: 5,
      windowMs: 15 * 60_000,
    })
    const user = verifySessionToken(getBearerToken(req))
    res.status(201).json(await submitBugReport({ ...(req.body || {}), user }))
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/password-reset', async (req, res) => {
  try {
    const phone = String(req.body?.phone || '')
    await assertRateLimit({
      key: `reset:${clientKey(req)}:${phone.replace(/\D/g, '') || 'empty'}`,
      limit: 5,
      windowMs: 15 * 60_000,
    })
    res.json(await requestPasswordReset(phone))
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/register', async (req, res) => {
  try {
    await assertRateLimit({
      key: `register:${clientKey(req)}`,
      limit: 5,
      windowMs: 15 * 60_000,
    })
    res.status(201).json(await registerOrganization(req.body || {}))
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/session', async (req, res) => {
  try {
    const user = requireUser(req)
    if (user.role === 'super_admin') {
      res.json({ ...user, token: createSessionToken(user) })
      return
    }
    const fresh = await refreshManagerSession(user)
    const requested = String(req.headers['x-app-module'] || '')
    if (
      (requested === 'selectors' || requested === 'inspectors') &&
      fresh.modules?.[requested]
    ) {
      fresh.module = requested
    }
    const token = createSessionToken(fresh)
    res.json({ ...fresh, token })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/shift-presence', async (req, res) => {
  try {
    const user = requireUser(req)
    const shiftId = String(req.body?.shiftId || '')
    if (!shiftId || !user.orgId) {
      res.json({ others: [] })
      return
    }
    const db = await getDb()
    const col = db.collection('shift_presence')
    const now = new Date()
    await col.updateOne(
      { _id: `${user.orgId}:${shiftId}:${user.id}` },
      {
        $set: {
          orgId: user.orgId,
          shiftId,
          userId: user.id,
          name: user.fullName || 'מנהל',
          at: now,
        },
      },
      { upsert: true },
    )
    const since = new Date(Date.now() - 45_000)
    const rows = await col
      .find({
        orgId: user.orgId,
        shiftId,
        userId: { $ne: user.id },
        at: { $gte: since },
      })
      .toArray()
    res.json({ others: rows.map((row) => row.name).filter(Boolean) })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/organizations', async (req, res) => {
  try {
    requireSuperAdmin(req)
    res.json(await listOrganizations())
  } catch (err) {
    sendError(res, err)
  }
})

app.delete('/api/organizations', async (req, res) => {
  try {
    requireSuperAdmin(req)
    const id = String(req.body?.id || req.query?.id || '')
    if (!id) {
      const err = new Error('חסר מזהה ארגון')
      err.status = 400
      throw err
    }
    res.json(await deleteOrganization(id))
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/organizations/restore', async (req, res) => {
  try {
    requireSuperAdmin(req)
    const id = String(req.body?.id || '')
    if (!id) {
      const err = new Error('חסר מזהה ארגון')
      err.status = 400
      throw err
    }
    res.json(await restoreOrganization(id))
  } catch (err) {
    sendError(res, err)
  }
})

app.patch('/api/organizations', async (req, res) => {
  try {
    requireSuperAdmin(req)
    const id = String(req.body?.id || '')
    if (!id) {
      const err = new Error('חסר מזהה ארגון')
      err.status = 400
      throw err
    }
    res.json(await reviewOrganization(id, req.body || {}))
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/org-settings', async (req, res) => {
  try {
    const user = requireUser(req)
    if (user.role !== 'org_manager' || !user.orgId) {
      const err = new Error('אין הרשאה להגדרות הארגון')
      err.status = 403
      throw err
    }
    res.json(await readOrgAssignmentSettings(user.orgId))
  } catch (err) {
    sendError(res, err)
  }
})

app.patch('/api/org-settings', async (req, res) => {
  try {
    const user = requireUser(req)
    if (user.role !== 'org_manager' || !user.orgId) {
      const err = new Error('אין הרשאה להגדרות הארגון')
      err.status = 403
      throw err
    }
    if (!user.isOrgManager) {
      const err = new Error('רק מנהל הארגון יכול לשנות את אופן השיבוץ')
      err.status = 403
      throw err
    }
    res.json(
      await updateOrgAssignmentSettings(user.orgId, req.body || {}, user),
    )
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/data', async (req, res) => {
  try {
    const { scope } = await scopeForRequest(req)
    res.json(publicData(await readState(scope)))
  } catch (err) {
    sendError(res, err)
  }
})

app.put('/api/data', async (req, res) => {
  try {
    const { actor, scope } = await scopeForRequest(req)
    const expectedRevision =
      req.body?.expectedRevision ?? req.headers['x-expected-revision']
    const { expectedRevision: _er, ...data } = req.body || {}
    res.json(
      await writeState(data, {
        actor,
        scope,
        expectedRevision:
          expectedRevision === undefined || expectedRevision === ''
            ? undefined
            : Number(expectedRevision),
      }),
    )
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/seed', async (req, res) => {
  try {
    const { actor, scope } = await scopeForRequest(req)
    if (req.body?.confirm !== 'RESET') {
      const err = new Error('לאיפוס יש לשלוח confirm: \"RESET\"')
      err.status = 400
      throw err
    }
    res.json(
      await writeState(createSeedData(), {
        action: 'data_reset',
        actor,
        scope,
        skipManagerInvites: true,
        expectedRevision:
          req.body?.expectedRevision != null
            ? Number(req.body.expectedRevision)
            : undefined,
      }),
    )
  } catch (err) {
    sendError(res, err)
  }
})

app.put('/api/shifts/:id', async (req, res) => {
  try {
    const { actor, scope } = await scopeForRequest(req)
    const body = req.body || {}
    const expectedRevision = body.expectedRevision
    delete body.expectedRevision
    res.json(
      await upsertShift(req.params.id, body, actor, {
        scope,
        expectedRevision:
          expectedRevision === undefined ? undefined : Number(expectedRevision),
      }),
    )
  } catch (err) {
    sendError(res, err)
  }
})

app.delete('/api/shifts/:id', async (req, res) => {
  try {
    const { actor, scope } = await scopeForRequest(req)
    const expectedRevision = req.query.expectedRevision
    res.json(
      await deleteShift(req.params.id, actor, {
        scope,
        expectedRevision:
          expectedRevision === undefined ? undefined : Number(expectedRevision),
      }),
    )
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/audit', async (req, res) => {
  try {
    const { scope } = await scopeForRequest(req)
    res.json(await listAuditLogs({ limit: req.query.limit, ...scope }))
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/audit', async (req, res) => {
  try {
    const { actor, scope } = await scopeForRequest(req)
    res.status(201).json(await appendClientAuditEvent(req.body || {}, actor, scope))
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/resend-temp-password', async (req, res) => {
  try {
    const { actor, scope } = await scopeForRequest(req)
    const workerId = String(req.body?.workerId || '')
    if (!workerId) {
      const err = new Error('חסר מזהה עובד')
      err.status = 400
      throw err
    }
    await assertRateLimit({
      key: `reinvite:${clientKey(req)}:${workerId}`,
      limit: 5,
      windowMs: 15 * 60_000,
    })
    res.json(await resendManagerTempPassword(workerId, actor, { scope }))
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/mail-test', async (req, res) => {
  try {
    requireUser(req)
    const to =
      typeof req.body?.to === 'string' && req.body.to.trim()
        ? req.body.to.trim()
        : undefined
    const result = await sendTestEmail({ to })
    res.json({
      ok: true,
      queued: result.queued,
      devLogged: result.devLogged,
    })
  } catch (err) {
    sendError(res, err)
  }
})

async function start() {
  await getDb('selectors')
  await ensureOrgIndexes()
  await migrateLegacyTenancy()
  await migrateInspectorsDatabase()
  app.listen(PORT, () => {
    console.log(`API listening on http://127.0.0.1:${PORT}`)
  })
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  start().catch((err) => {
    console.error('Failed to start server', err)
    process.exit(1)
  })
}

export default app
