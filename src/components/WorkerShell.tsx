import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  BookOpen,
  CircleHelp,
  ClipboardList,
  History,
  KeyRound,
  LogOut,
  UserRound,
} from 'lucide-react'
import { fetchWorkerNotificationsRemote } from '../api'
import { useApp } from '../context/AppContext'
import { notifyNewWorkerInbox } from '../lib/workerNotify'
import { AppFooter } from './AppFooter'
import { BrandMark } from './BrandMark'
import { ThemeToggle } from './ThemeToggle'

const NAV: {
  to: string
  label: string
  icon: typeof ClipboardList
  end?: boolean
}[] = [
  { to: '/worker', label: 'עכשיו', icon: ClipboardList, end: true },
  { to: '/worker/history', label: 'היסטוריה', icon: History },
  { to: '/worker/briefings', label: 'תדריכים', icon: BookOpen },
  { to: '/worker/profile', label: 'הפרופיל שלי', icon: UserRound },
]

export function WorkerShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [unread, setUnread] = useState(0)

  const refreshUnread = useCallback(async () => {
    try {
      const data = await fetchWorkerNotificationsRemote()
      setUnread(data.unread)
      notifyNewWorkerInbox(data.items)
    } catch {
      /* ignore badge errors */
    }
  }, [])

  useEffect(() => {
    void refreshUnread()
    const id = window.setInterval(() => void refreshUnread(), 60_000)
    return () => window.clearInterval(id)
  }, [refreshUnread, location.pathname])

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pb-24 pt-4 sm:pb-8 sm:pt-6">
      <header className="mb-5 flex items-center justify-between gap-3 no-print">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-display text-base font-bold text-ink">
              שיבוצון · פורטל עובדים
            </p>
            <p className="truncate text-xs text-ink-soft">
              {user?.fullName}
              {user?.orgName ? ` · ${user.orgName}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            to="/worker/notifications"
            className="relative ui-btn ui-btn-ghost !px-2.5 !py-2"
            aria-label={
              unread > 0 ? `התראות, ${unread} שלא נקראו` : 'התראות'
            }
          >
            <Bell className="size-4" aria-hidden />
            {unread > 0 ? (
              <span className="absolute -top-0.5 -start-0.5 flex min-w-4 items-center justify-center rounded-full bg-hard px-1 text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            ) : null}
          </Link>
          <ThemeToggle />
          <div className="relative">
            <button
              type="button"
              className="ui-btn ui-btn-ghost !px-2.5 !py-2 text-sm"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              תפריט
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute left-0 z-40 mt-1 w-48 overflow-hidden rounded-xl border border-line/80 bg-card py-1 shadow-[var(--shadow-panel-hover)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm text-ink-soft hover:bg-surface hover:text-ink"
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/worker/notifications')
                  }}
                >
                  <Bell className="size-4" aria-hidden />
                  התראות
                  {unread > 0 ? ` (${unread})` : ''}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm text-ink-soft hover:bg-surface hover:text-ink"
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/worker/help')
                  }}
                >
                  <CircleHelp className="size-4" aria-hidden />
                  איך משתמשים
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm text-ink-soft hover:bg-surface hover:text-ink"
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/worker/password')
                  }}
                >
                  <KeyRound className="size-4" aria-hidden />
                  החלפת סיסמה
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm text-ink-soft hover:bg-surface hover:text-hard"
                  onClick={() => {
                    setMenuOpen(false)
                    logout()
                  }}
                >
                  <LogOut className="size-4" aria-hidden />
                  יציאה
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <nav
        className="mb-5 hidden gap-1 rounded-xl border border-line/70 bg-card/70 p-1 sm:flex no-print"
        aria-label="ניווט עובדים"
      >
        {NAV.map((item) => {
          const active = item.end
            ? location.pathname === item.to || location.pathname === '/worker/'
            : location.pathname.startsWith(item.to)
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] transition ${
                active
                  ? 'bg-brand/10 font-semibold text-brand'
                  : 'text-ink-soft hover:bg-surface/70 hover:text-ink'
              }`}
            >
              <Icon className="size-4 opacity-80" aria-hidden />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <main className="min-w-0 flex-1">{children}</main>
      <AppFooter className="mt-10 no-print" />

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-card/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 backdrop-blur-xl sm:hidden no-print"
        aria-label="ניווט מובייל עובדים"
      >
        <div className="mx-auto flex max-w-lg justify-around">
          {NAV.map((item) => {
            const active = item.end
              ? location.pathname === item.to || location.pathname === '/worker/'
              : location.pathname.startsWith(item.to)
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-semibold ${
                  active ? 'text-brand' : 'text-ink-soft'
                }`}
              >
                <Icon className="size-[18px]" aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
