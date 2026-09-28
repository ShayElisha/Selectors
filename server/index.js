import 'dotenv/config'
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
import { ensureOrgIndexes, listOrganizations, registerOrganization, reviewOrganization } from './orgs.js'
import { assertRateLimit, clientKey } from './rateLimit.js'
import { scopeForRequest } from './scope.js'
import { createSessionToken, requireSuperAdmin, requireUser } from './session.js'

const PORT = Number(process.env.PORT || 3001)

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

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

app.get('/api/organizations', async (req, res) => {
  try {
    requireSuperAdmin(req)
    res.json(await listOrganizations())
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

start().catch((err) => {
  console.error('Failed to start server', err)
  process.exit(1)
})
