import { publicData, readState, writeState } from '../server/data.js'
import { scopeForRequest } from '../server/scope.js'

export default async function handler(req, res) {
  try {
    const { actor, scope } = await scopeForRequest(req)
    if (req.method === 'GET') {
      res.status(200).json(publicData(await readState(scope)))
      return
    }
    if (req.method === 'PUT') {
      const expectedRevision =
        req.body?.expectedRevision ?? req.headers['x-expected-revision']
      const { expectedRevision: _er, ...data } = req.body || {}
      res.status(200).json(
        await writeState(data, {
          actor,
          scope,
          expectedRevision:
            expectedRevision === undefined || expectedRevision === ''
              ? undefined
              : Number(expectedRevision),
        }),
      )
      return
    }
    res.setHeader('Allow', 'GET, PUT')
    res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    const body = { error: err.message || 'Failed' }
    if (err.current) body.current = err.current
    res.status(status).json(body)
  }
}
