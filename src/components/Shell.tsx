import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ClipboardList,
  History,
  Home,
  LayoutGrid,
  Users,
  BadgeCheck,
  LogOut,
  Table2,
  ScrollText,
  MoreHorizontal,
  X,
  BarChart3,
  ChevronDown,
  Circle,
  Settings2,
  BookOpen,
  Briefcase,
} from 'lucide-react'
import type { View } from '../types'
import { useApp } from '../context/AppContext'
import { toast } from '../lib/notify'
import {
  findShiftForSlot,
  getCurrentShiftContext,
} from '../constants'
import { AppFooter } from './AppFooter'
import { ThemeToggle } from './ThemeToggle'

type NavItem = { id: View; label: string; icon: typeof Home }

const DAILY: NavItem[] = [
  { id: 'home', label: 'ראשי', icon: Home },
  { id: 'shift', label: 'שיבוץ', icon: ClipboardList },
  { id: 'briefings', label: 'תדריכים', icon: BookOpen },
  { id: 'customsBrokers', label: 'עמילי מכס', icon: Briefcase },
]

const DATA: NavItem[] = [
  { id: 'tracking', label: 'מעקב נתיבים', icon: Table2 },
  { id: 'analytics', label: 'סטטיסטיקות ואנליזה', icon: BarChart3 },
  { id: 'history', label: 'היסטוריה', icon: History },
  { id: 'audit', label: 'יומן', icon: ScrollText },
]

const MANAGE: NavItem[] = [
  { id: 'workers', label: 'בודקים', icon: Users },
  { id: 'lanes', label: 'נתיבים', icon: LayoutGrid },
  { id: 'certs', label: 'הסמכות', icon: BadgeCheck },
]

const MOBILE_PRIMARY: View[] = ['home', 'shift', 'workers', 'history']
const MOBILE_MORE: View[] = [
  'briefings',
  'customsBrokers',
  'lanes',
  'certs',
  'tracking',
  'analytics',
  'audit',
]

const ALL_NAV = [...DAILY, ...DATA, ...MANAGE]

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`
}

function syncLabel(
  loading: boolean,
  refreshing: boolean,
  syncing: boolean,
): string {
  if (loading) return 'טוען…'
  if (refreshing) return 'מעדכן…'
  if (syncing) return 'שומר…'
  return 'מסונכרן'
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        active
          ? 'bg-brand text-white shadow-sm'
          : 'text-ink-soft hover:bg-surface/70 hover:text-ink'
      }`}
    >
      <Icon className="size-[17px] shrink-0 opacity-80" aria-hidden />
      <span className="whitespace-nowrap">{item.label}</span>
    </button>
  )
}

export function Shell({ children }: { children: React.ReactNode }) {
  const {
    view,
    setView,
    startShift,
    loadShiftFromHistory,
    draft,
    data,
    loading,
    syncing,
    refreshing,
    error,
    refreshFromServer,
    user,
    logout,
  } = useApp()
  const [moreOpen, setMoreOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [manageMenuPos, setManageMenuPos] = useState<{
    top: number
    left: number
  } | null>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const manageRef = useRef<HTMLDivElement>(null)
  const manageMenuRef = useRef<HTMLDivElement>(null)
  const manageBtnRef = useRef<HTMLButtonElement>(null)
  const lastErrorToast = useRef<string | null>(null)

  useEffect(() => {
    if (!error) {
      lastErrorToast.current = null
      return
    }
    if (lastErrorToast.current === error) return
    lastErrorToast.current = error
    toast.error('שגיאת שרת', {
      description: error,
      duration: 8000,
      action: {
        label: 'נסה שוב',
        onClick: () => {
          void refreshFromServer()
        },
      },
    })
  }, [error, refreshFromServer])

  const go = (id: View) => {
    setMoreOpen(false)
    setProfileOpen(false)
    setManageOpen(false)
    setManageMenuPos(null)
    if (id === 'shift' && !draft) {
      const ctx = getCurrentShiftContext()
      const existing = findShiftForSlot(
        data.history,
        ctx.date,
        ctx.shiftType,
      )
      if (existing) {
        loadShiftFromHistory(existing.id)
      } else {
        startShift()
      }
      return
    }
    setView(id)
  }

  const moreActive = useMemo(() => MOBILE_MORE.includes(view), [view])
  const manageActive = useMemo(() => MANAGE.some((n) => n.id === view), [view])
  const manageCurrent = useMemo(
    () => MANAGE.find((n) => n.id === view) ?? null,
    [view],
  )
  const statusText = syncLabel(loading, refreshing, syncing)
  const online = !loading && !refreshing && !syncing

  useLayoutEffect(() => {
    if (!manageOpen || !manageBtnRef.current) {
      setManageMenuPos(null)
      return
    }
    const place = () => {
      const r = manageBtnRef.current!.getBoundingClientRect()
      // RTL: align menu's right edge with button's right edge
      const menuWidth = 192
      setManageMenuPos({
        top: r.bottom + 6,
        left: Math.max(8, r.right - menuWidth),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [manageOpen])

  useEffect(() => {
    if (!profileOpen && !manageOpen) return
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (profileOpen && profileRef.current && !profileRef.current.contains(t)) {
        setProfileOpen(false)
      }
      if (manageOpen) {
        const inBtn = manageRef.current?.contains(t)
        const inMenu = manageMenuRef.current?.contains(t)
        if (!inBtn && !inMenu) {
          setManageOpen(false)
          setManageMenuPos(null)
        }
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setProfileOpen(false)
        setManageOpen(false)
        setManageMenuPos(null)
      }
    }
    // Defer so the opening click does not immediately close the menu
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onPointer)
      document.addEventListener('touchstart', onPointer)
    }, 0)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [profileOpen, manageOpen])

  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl flex-col px-4 pb-32 pt-5 sm:px-6 sm:pt-7 lg:pb-10 lg:pt-8">
      <header className="relative z-40 mb-6 flex flex-wrap items-center justify-between gap-4 animate-fade-up sm:mb-7 no-print">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className="inline-flex size-8 items-center justify-center rounded-lg bg-brand text-[11px] font-bold tracking-wide text-white shadow-sm"
              aria-hidden
            >
              CI
            </span>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase sm:text-[11px]">
              CHECK IN
            </p>
          </div>
          <h1 className="font-display text-[1.65rem] font-bold leading-none tracking-tight text-ink sm:text-[2rem]">
            שיבוצון
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-soft sm:text-sm">
            ניהול ושיבוץ עמדות סלקטורים
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <div
            className="hidden items-center gap-1.5 rounded-full border border-line/80 bg-card/80 px-2.5 py-1 text-[11px] text-ink-soft shadow-sm backdrop-blur-md lg:inline-flex"
            title={statusText}
          >
            <Circle
              className={`size-2 fill-current ${
                online ? 'text-ok' : 'animate-pulse text-warn'
              }`}
              aria-hidden
            />
            <span className="font-medium">{statusText}</span>
          </div>

          {user && (
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => setProfileOpen((o) => !o)}
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                aria-label="תפריט משתמש"
                className="group inline-flex items-center gap-2 rounded-full border border-line/80 bg-card/90 py-1 pe-2.5 ps-1 shadow-sm backdrop-blur-md transition hover:border-brand/25 hover:bg-card"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-deep text-[11px] font-bold tracking-wide text-white">
                  {initials(user.fullName)}
                </span>
                <span className="hidden max-w-[9rem] truncate text-xs font-semibold text-ink sm:inline">
                  {user.fullName}
                </span>
                <ChevronDown
                  className={`size-3.5 text-ink-soft transition group-hover:text-ink ${
                    profileOpen ? 'rotate-180' : ''
                  }`}
                  aria-hidden
                />
              </button>

              {profileOpen && (
                <div
                  role="menu"
                  className="absolute end-0 z-[60] mt-2 w-56 overflow-hidden rounded-xl border border-line/80 bg-card py-1 shadow-[var(--shadow-panel-hover)] animate-fade-up"
                >
                  <div className="border-b border-line/70 px-3.5 py-3">
                    <p className="truncate text-sm font-semibold text-ink">
                      {user.fullName}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-soft">מנהל משמרת</p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false)
                      logout()
                    }}
                    className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-ink-soft transition hover:bg-surface hover:text-hard"
                  >
                    <LogOut className="size-4 shrink-0" aria-hidden />
                    יציאה מהמערכת
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {(loading || refreshing) && (
        <div
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-line/80 bg-card/90 px-3.5 py-2.5 text-[13px] text-ink-soft shadow-sm backdrop-blur no-print"
          role="status"
          aria-live="polite"
        >
          <span className="page-loader page-loader--sm shrink-0" aria-hidden />
          {loading ? 'טוען נתונים מהשרת…' : 'מרענן נתונים ברקע…'}
        </div>
      )}

      <nav
        className="relative z-30 mb-6 hidden rounded-xl border border-line/70 bg-card/70 p-1 shadow-sm backdrop-blur-md lg:block no-print"
        aria-label="ניווט ראשי"
      >
        <div className="flex flex-wrap items-center gap-0.5">
          {DAILY.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={view === item.id}
              onClick={() => go(item.id)}
            />
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-line/80" aria-hidden />
          {DATA.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={view === item.id}
              onClick={() => go(item.id)}
            />
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-line/80" aria-hidden />
          <div className="relative" ref={manageRef}>
            <button
              ref={manageBtnRef}
              type="button"
              onClick={() => {
                setProfileOpen(false)
                setManageOpen((o) => !o)
              }}
              aria-expanded={manageOpen}
              aria-haspopup="menu"
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                manageActive
                  ? 'bg-brand text-white shadow-sm'
                  : manageOpen
                    ? 'bg-surface text-ink shadow-sm ring-1 ring-line/80'
                    : 'text-ink-soft hover:bg-surface/70 hover:text-ink'
              }`}
            >
              <Settings2 className="size-[17px] opacity-80" aria-hidden />
              {manageCurrent
                ? `ניהול · ${manageCurrent.label}`
                : 'ניהול'}
              <ChevronDown
                className={`size-3.5 transition ${manageOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
          </div>
        </div>
      </nav>

      {manageOpen &&
        manageMenuPos &&
        createPortal(
          <div
            ref={manageMenuRef}
            role="menu"
            className="fixed z-[200] min-w-[12rem] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[var(--shadow-panel-hover)] animate-fade-up no-print"
            style={{ top: manageMenuPos.top, left: manageMenuPos.left }}
          >
            {MANAGE.map((item) => {
              const Icon = item.icon
              const active = view === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => go(item.id)}
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? 'bg-brand/8 text-brand'
                      : 'text-ink hover:bg-surface'
                  }`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </button>
              )
            })}
          </div>,
          document.body,
        )}

      <main className="flex-1">{children}</main>

      <AppFooter className="mb-2 mt-10 sm:mt-12 lg:mb-0 no-print" />

      {moreOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden no-print"
          role="dialog"
          aria-modal="true"
          aria-label="תפריט נוסף"
        >
          <button
            type="button"
            className="absolute inset-0 bg-ink/35 backdrop-blur-[2px]"
            aria-label="סגור"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 animate-fade-up rounded-t-2xl border border-line bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-panel-hover)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="ui-title">עוד</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="ui-btn ui-btn-ghost !p-2"
                aria-label="סגור"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ALL_NAV.filter((n) => MOBILE_MORE.includes(n.id)).map((item) => {
                const Icon = item.icon
                const active = view === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                      active
                        ? 'border-brand/30 bg-brand/8 text-brand'
                        : 'border-line bg-surface text-ink hover:border-brand/20'
                    }`}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden />
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-card/90 px-1 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-[0_-8px_24px_rgb(15_28_46/0.05)] backdrop-blur-xl lg:hidden no-print"
        aria-label="ניווט מובייל"
      >
        <div className="mx-auto flex max-w-lg justify-around">
          {ALL_NAV.filter((n) => MOBILE_PRIMARY.includes(n.id)).map((item) => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 text-[11px] font-semibold tracking-wide transition ${
                  active ? 'text-brand' : 'text-ink-soft hover:text-ink'
                }`}
              >
                <Icon
                  className={`size-[18px] ${active ? 'stroke-[2.25]' : ''}`}
                  aria-hidden
                />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            aria-label="עוד תפריטים"
            className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 text-[11px] font-semibold tracking-wide transition ${
              moreActive || moreOpen ? 'text-brand' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <MoreHorizontal
              className={`size-[18px] ${moreActive || moreOpen ? 'stroke-[2.25]' : ''}`}
              aria-hidden
            />
            <span>עוד</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
