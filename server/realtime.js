import { Server } from 'socket.io'
import { getBearerToken, verifySessionToken } from './session.js'

/** @type {import('socket.io').Server | null} */
let io = null

export function scopeRoom(orgId, module) {
  return `org:${orgId}:${module}`
}

/**
 * Attach Socket.IO to the long-lived HTTP server (dev / start:api).
 * Clients join org+module rooms and receive `org:revision` pushes.
 */
export function attachRealtime(httpServer) {
  if (io) return io
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: true,
      credentials: true,
    },
    // Prefer websocket; polling remains as transport fallback only.
    transports: ['websocket', 'polling'],
  })

  io.use((socket, next) => {
    try {
      const user = verifySessionToken(getBearerToken(socket.request))
      if (!user || user.role !== 'org_manager' || !user.orgId) {
        next(new Error('unauthorized'))
        return
      }
      socket.data.user = user
      next()
    } catch (err) {
      next(err instanceof Error ? err : new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user
    if (!user?.orgId) {
      socket.disconnect(true)
      return
    }

    const joinModule = (rawModule) => {
      const module =
        rawModule === 'inspectors' ||
        rawModule === 'selectors' ||
        rawModule === 'security'
          ? rawModule
          : user.module
      if (!module || !user.modules?.[module]) return null
      const room = scopeRoom(user.orgId, module)
      socket.join(room)
      return { module, room }
    }

    // Auto-join active module from handshake, then allow switches.
    const initial =
      socket.handshake.auth?.module ||
      socket.handshake.query?.module ||
      user.module
    joinModule(initial)

    socket.on('subscribe', (payload, ack) => {
      const joined = joinModule(payload?.module)
      if (typeof ack === 'function') {
        ack(joined ? { ok: true, ...joined } : { ok: false })
      }
    })
  })

  return io
}

export function getRealtime() {
  return io
}

/** Push a revision tip to every manager watching this org module. */
export function publishScopeRevision(scope, revision) {
  if (!io || !scope?.orgId || !scope?.module) return
  const rev = Number(revision)
  if (!Number.isFinite(rev)) return
  io.to(scopeRoom(scope.orgId, scope.module)).emit('org:revision', {
    orgId: String(scope.orgId),
    module: String(scope.module),
    revision: rev,
    at: new Date().toISOString(),
  })
}
