import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { useApp } from '../context/AppContext'
import {
  ensureShiftEndNotice,
  listManagerNotices,
  markAllManagerNoticesRead,
  markManagerNoticeRead,
  unreadManagerNoticeCount,
  type ManagerNotice,
} from '../lib/managerNotifications'

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    })
  } catch {
    return ''
  }
}

export function ManagerBell() {
  const { draft, setView } = useApp()
  const [open, setOpen] = useState(false)
  const [notices, setNotices] = useState<ManagerNotice[]>(() => listManagerNotices())
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const refresh = () => setNotices(listManagerNotices())

  useEffect(() => {
    if (!draft || draft.signOff?.signedAt) return
    ensureShiftEndNotice({
      shiftId: draft.id,
      date: draft.date,
      shiftType: draft.shiftType,
      signedOff: Boolean(draft.signOff?.signedAt),
    })
    refresh()
    const timer = window.setInterval(() => {
      ensureShiftEndNotice({
        shiftId: draft.id,
        date: draft.date,
        shiftType: draft.shiftType,
        signedOff: Boolean(draft.signOff?.signedAt),
      })
      refresh()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [draft])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unread = useMemo(
    () => notices.filter((n) => !n.read).length || unreadManagerNoticeCount(),
    [notices],
  )

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className="relative inline-flex size-10 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        aria-label={unread ? `התראות מנהל, ${unread} שלא נקראו` : 'התראות מנהל'}
        aria-expanded={open}
        onClick={() => {
          refresh()
          setOpen((v) => !v)
        }}
      >
        <Bell className="size-4.5 size-5" aria-hidden />
        {unread > 0 ? (
          <span className="absolute end-1.5 top-1.5 size-2 rounded-full bg-warn ring-2 ring-card" />
        ) : null}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="התראות מנהל"
              className="fixed end-3 top-14 z-[220] w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-panel-hover)]"
            >
              <div className="flex items-center justify-between border-b border-line/70 px-3 py-2.5">
                <p className="text-sm font-bold text-ink">התראות</p>
                {notices.some((n) => !n.read) ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:underline"
                    onClick={() => {
                      markAllManagerNoticesRead()
                      refresh()
                    }}
                  >
                    <CheckCheck className="size-3.5" aria-hidden />
                    סמן הכול כנקרא
                  </button>
                ) : null}
              </div>
              <ul className="max-h-[min(24rem,60vh)] overflow-y-auto">
                {notices.length === 0 ? (
                  <li className="px-3 py-6 text-center text-sm text-ink-soft">
                    אין התראות כרגע
                  </li>
                ) : (
                  notices.map((notice) => (
                    <li key={notice.id} className="border-b border-line/60 last:border-0">
                      <button
                        type="button"
                        className={`w-full px-3 py-2.5 text-start transition hover:bg-surface ${
                          notice.read ? '' : 'bg-brand/[0.04]'
                        }`}
                        onClick={() => {
                          markManagerNoticeRead(notice.id)
                          refresh()
                          if (notice.kind === 'shift_end') {
                            setOpen(false)
                            setView('shift')
                          }
                        }}
                      >
                        <p className="text-[13px] font-bold text-ink">{notice.title}</p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">
                          {notice.body}
                        </p>
                        <p className="mt-1 text-[11px] text-ink-soft">
                          {formatWhen(notice.at)}
                        </p>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
