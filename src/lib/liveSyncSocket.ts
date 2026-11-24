import { io, type Socket } from 'socket.io-client'

export type OrgRevisionEvent = {
  orgId: string
  module: string
  revision: number
  at?: string
}

type LiveSyncHandlers = {
  onRevision: (event: OrgRevisionEvent) => void
  onConnectionChange?: (connected: boolean) => void
  /** Fired once when the socket cannot stay connected — callers should poll. */
  onUnavailable?: () => void
}

let socket: Socket | null = null
let activeModule: string | null = null

/**
 * Socket.IO needs a long-lived API process (`npm run start:api` / dedicated host).
 * Vercel serverless does not attach realtime, so skip there to avoid WS spam.
 */
export function isLiveSocketAvailable(): boolean {
  if (typeof window === 'undefined') return false
  if (import.meta.env.VITE_ENABLE_SOCKET === 'false') return false
  if (import.meta.env.VITE_SOCKET_URL) return true
  if (import.meta.env.VITE_ENABLE_SOCKET === 'true') return true
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return true
  if (host.endsWith('.vercel.app')) return false
  return false
}

function ensureSocket(): Socket {
  if (socket) return socket
  const url = String(import.meta.env.VITE_SOCKET_URL || '').trim() || undefined
  socket = io(url, {
    path: '/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 8_000,
  })
  return socket
}

/** Connect (or switch module room) for org live revision pushes. */
export function startLiveSync(
  module: 'selectors' | 'inspectors' | 'security',
  handlers: LiveSyncHandlers,
): () => void {
  if (!isLiveSocketAvailable()) {
    handlers.onUnavailable?.()
    handlers.onConnectionChange?.(false)
    return () => undefined
  }

  const s = ensureSocket()
  activeModule = module
  let gaveUp = false

  const onRevision = (event: OrgRevisionEvent) => {
    if (!event || event.module !== activeModule) return
    handlers.onRevision(event)
  }
  const onConnect = () => {
    handlers.onConnectionChange?.(true)
    s.emit('subscribe', { module: activeModule })
  }
  const onDisconnect = () => handlers.onConnectionChange?.(false)
  const onReconnectFailed = () => {
    if (gaveUp) return
    gaveUp = true
    handlers.onUnavailable?.()
    stopLiveSync()
  }
  const onConnectError = () => {
    // First failures are retried by socket.io; reconnect_failed handles give-up.
  }

  s.on('org:revision', onRevision)
  s.on('connect', onConnect)
  s.on('disconnect', onDisconnect)
  s.on('reconnect_failed', onReconnectFailed)
  s.on('connect_error', onConnectError)

  s.auth = { module }
  if (s.connected) {
    s.emit('subscribe', { module })
  } else {
    s.connect()
  }

  return () => {
    s.off('org:revision', onRevision)
    s.off('connect', onConnect)
    s.off('disconnect', onDisconnect)
    s.off('reconnect_failed', onReconnectFailed)
    s.off('connect_error', onConnectError)
  }
}

export function stopLiveSync() {
  if (!socket) return
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
  activeModule = null
}
