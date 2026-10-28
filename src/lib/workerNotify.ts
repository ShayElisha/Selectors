const PERM_KEY = 'getin.worker.notify.permissionAsked'
const SEEN_KEY = 'getin.worker.notify.seen'
const REMINDER_PREFIX = 'getin.worker.reminder.'

export type NotifyPermission = NotificationPermission | 'unsupported'

export function notificationSupport(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function currentNotifyPermission(): NotifyPermission {
  if (!notificationSupport()) return 'unsupported'
  return Notification.permission
}

export async function requestWorkerNotifyPermission(): Promise<NotifyPermission> {
  if (!notificationSupport()) return 'unsupported'
  try {
    localStorage.setItem(PERM_KEY, '1')
    if (Notification.permission === 'granted') return 'granted'
    if (Notification.permission === 'denied') return 'denied'
    const result = await Notification.requestPermission()
    return result
  } catch {
    return currentNotifyPermission()
  }
}

export function wasNotifyPermissionAsked(): boolean {
  try {
    return localStorage.getItem(PERM_KEY) === '1'
  } catch {
    return false
  }
}

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.map(String) : [])
  } catch {
    return new Set()
  }
}

function writeSeen(ids: Set<string>) {
  try {
    const list = [...ids].slice(-80)
    localStorage.setItem(SEEN_KEY, JSON.stringify(list))
  } catch {
    /* ignore quota */
  }
}

let inboxPrimed = false

/** Show desktop notifications for newly unread inbox items. */
export function notifyNewWorkerInbox(
  items: { id: string; title: string; body: string; read: boolean }[],
) {
  if (!notificationSupport() || Notification.permission !== 'granted') return
  const seen = readSeen()
  // First poll in this tab: remember existing items without notifying.
  if (!inboxPrimed) {
    inboxPrimed = true
    for (const item of items) seen.add(item.id)
    writeSeen(seen)
    return
  }
  let changed = false
  for (const item of items) {
    if (item.read || seen.has(item.id)) continue
    seen.add(item.id)
    changed = true
    try {
      const n = new Notification(item.title || 'התראה משיבוצון', {
        body: item.body?.slice(0, 160) || '',
        tag: item.id,
        lang: 'he',
        dir: 'rtl',
      })
      n.onclick = () => {
        window.focus()
        n.close()
        window.location.assign('/worker/notifications')
      }
    } catch {
      /* ignore */
    }
  }
  if (changed) writeSeen(seen)
}

const reminderTimers = new Map<string, number>()

/**
 * Schedule a local browser notification ~60 minutes before shift start.
 * Works while the portal tab stays open (or recently visited).
 */
export function scheduleShiftStartReminder(args: {
  shiftId: string
  shiftStartsAt: string | null | undefined
  label: string
}) {
  if (!notificationSupport() || Notification.permission !== 'granted') return
  if (!args.shiftId || !args.shiftStartsAt) return
  const startMs = new Date(args.shiftStartsAt).getTime()
  if (!Number.isFinite(startMs)) return
  const fireAt = startMs - 60 * 60_000
  const delay = fireAt - Date.now()
  const key = `${REMINDER_PREFIX}${args.shiftId}`

  const existing = reminderTimers.get(key)
  if (existing != null) window.clearTimeout(existing)

  if (delay < 0 || delay > 36 * 60 * 60_000) return

  try {
    if (localStorage.getItem(key) === '1') return
  } catch {
    /* ignore */
  }

  const timer = window.setTimeout(() => {
    reminderTimers.delete(key)
    try {
      if (localStorage.getItem(key) === '1') return
      localStorage.setItem(key, '1')
    } catch {
      /* ignore */
    }
    try {
      new Notification('תזכורת: המשמרת בעוד כשעה', {
        body: args.label,
        tag: key,
        lang: 'he',
        dir: 'rtl',
      })
    } catch {
      /* ignore */
    }
  }, delay)
  reminderTimers.set(key, timer)
}

export function phoneDigitsForWhatsApp(phone: string): string | null {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length < 9) return null
  if (digits.startsWith('972')) return digits
  if (digits.startsWith('0')) return `972${digits.slice(1)}`
  return digits
}
