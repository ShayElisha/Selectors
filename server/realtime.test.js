import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { io as ioClient } from 'socket.io-client'

vi.mock('./session.js', () => ({
  getBearerToken: () => 'tok',
  verifySessionToken: () => ({
    id: 'u1',
    role: 'org_manager',
    orgId: 'org1',
    module: 'inspectors',
    modules: { inspectors: true, selectors: false, security: false },
  }),
}))

describe('realtime', () => {
  /** @type {import('node:http').Server | null} */
  let httpServer = null
  /** @type {import('socket.io').Server | null} */
  let io = null
  /** @type {import('socket.io-client').Socket | null} */
  let client = null

  afterEach(async () => {
    client?.disconnect()
    client = null
    if (io) {
      await new Promise((resolve) => io.close(() => resolve(undefined)))
      io = null
    }
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(() => resolve(undefined)))
      httpServer = null
    }
    vi.resetModules()
  })

  it('pushes org:revision to subscribed managers', async () => {
    httpServer = createServer()
    const { attachRealtime, publishScopeRevision, scopeRoom } = await import(
      './realtime.js'
    )
    io = attachRealtime(httpServer)
    await new Promise((resolve) => httpServer.listen(0, resolve))
    const { port } = httpServer.address()

    client = ioClient(`http://127.0.0.1:${port}`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { module: 'inspectors' },
    })

    await new Promise((resolve, reject) => {
      client.once('connect', resolve)
      client.once('connect_error', reject)
    })

    expect(scopeRoom('org1', 'inspectors')).toBe('org:org1:inspectors')

    const got = new Promise((resolve) => {
      client.once('org:revision', resolve)
    })
    publishScopeRevision(
      { orgId: 'org1', module: 'inspectors' },
      42,
    )
    const event = await got
    expect(event).toMatchObject({
      orgId: 'org1',
      module: 'inspectors',
      revision: 42,
    })
  })
})
