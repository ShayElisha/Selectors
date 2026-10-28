import { useCallback, useEffect, useState } from 'react'
import { Bell, Loader2, MailOpen } from 'lucide-react'
import {
  fetchWorkerNotificationsRemote,
  markAllWorkerNotificationsReadRemote,
  markWorkerNotificationReadRemote,
  type WorkerNotificationItem,
} from '../api'
import { SectionCard } from '../components/ui'
import { formatShiftDate } from '../lib/hebrew'
import { notify } from '../lib/notify'

function sourceLabel(source: string) {
  if (source === 'manager') return 'מנהל'
  if (source === 'briefing') return 'תדריך'
  if (source === 'system') return 'מערכת'
  return source
}

export function WorkerNotificationsPage() {
  const [items, setItems] = useState<WorkerNotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchWorkerNotificationsRemote()
      setItems(data.items)
      setUnread(data.unread)
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'טעינת ההתראות נכשלה')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const markOne = async (item: WorkerNotificationItem) => {
    if (item.read || item.source !== 'manager') return
    try {
      await markWorkerNotificationReadRemote(item.id)
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, read: true } : row)),
      )
      setUnread((n) => Math.max(0, n - 1))
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'סימון כנקרא נכשל')
    }
  }

  const markAll = async () => {
    setBusy(true)
    try {
      await markAllWorkerNotificationsReadRemote()
      setItems((prev) =>
        prev.map((row) =>
          row.source === 'manager' ? { ...row, read: true } : row,
        ),
      )
      setUnread(0)
      notify.success('כל הודעות המנהלים סומנו כנקראו')
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'סימון הכל נכשל')
    } finally {
      setBusy(false)
    }
  }

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-ink-soft">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        טוען התראות…
      </div>
    )
  }

  return (
    <SectionCard
      title="מרכז התראות"
      subtitle="הודעות ממנהלים, תדריכים חשובים והודעות מערכת."
      actions={
        unread > 0 ? (
          <button
            type="button"
            className="ui-btn ui-btn-ghost !px-2.5 text-xs"
            disabled={busy}
            onClick={() => void markAll()}
          >
            <MailOpen className="size-3.5" aria-hidden />
            סמן הכל כנקרא
          </button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Bell className="size-4" aria-hidden />
          אין התראות כרגע.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const unreadManager = item.source === 'manager' && !item.read
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`w-full rounded-xl border p-3 text-start transition ${
                    unreadManager
                      ? 'border-brand/30 bg-brand/[0.06]'
                      : 'border-line/70 bg-surface/40'
                  }`}
                  onClick={() => void markOne(item)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{item.title}</p>
                    <span className="text-[11px] text-ink-soft">
                      {sourceLabel(item.source)}
                      {item.at
                        ? ` · ${formatShiftDate(item.at.slice(0, 10))}`
                        : ''}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
                    {item.body}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-soft">
                    מאת {item.authorName}
                    {unreadManager ? ' · לחצו לסימון כנקרא' : ''}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}
