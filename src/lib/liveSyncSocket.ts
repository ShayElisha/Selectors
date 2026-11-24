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
}

let socket: Socket | null = null
let activeModule: string | null = null

function ensureSocket(): Socket {
  if (socket) return socket
  socket = io({
    path: '/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 8_000,
  })
  return socket
}

/** Connect (or switch module room) for org live revision pushes. */
export function startLiveSync(
  module: 'selectors' | 'inspectors' | 'security',
  handlers: LiveSyncHandlers,
): () => void {
  const s = ensureSocket()
  activeModule = module

  const onRevision = (event: OrgRevisionEvent) => {
    if (!event || event.module !== activeModule) return
    handlers.onRevision(event)
  }
  const onConnect = () => {
    handlers.onConnectionChange?.(true)
    s.emit('subscribe', { module: activeModule })
  }
  const onDisconnect = () => handlers.onConnectionChange?.(false)

  s.on('org:revision', onRevision)
  s.on('connect', onConnect)
  s.on('disconnect', onDisconnect)

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
    // Keep the shared socket for fast remounts; only leave when module changes away.
  }
}

export function stopLiveSync() {
  if (!socket) return
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
  activeModule = null
}
