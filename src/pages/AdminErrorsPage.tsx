import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { fetchSystemErrorsRemote, type SystemErrorEntry } from '../api'
import { BrandMark } from '../components/BrandMark'
import { ThemeToggle } from '../components/ThemeToggle'
import { useApp } from '../context/AppContext'

const PAGE_SIZE = 50

function dateLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('he-IL')
}

function ErrorRow({ item }: { item: SystemErrorEntry }) {
  return (
    <details className="border-b border-line/60 px-4 py-3 last:border-b-0">
      <summary className="cursor-pointer list-none">
        <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:items-center">
          <div className="min-w-0">
            <p className="break-words font-semibold text-ink">{item.message}</p>
            <p className="mt-1 break-all text-[12px] text-ink-soft">
              {item.method ? `${item.method} ` : ''}{item.path || '—'}
            </p>
          </div>
          <p className="text-[12px] text-ink-soft">{dateLabel(item.at)}</p>
          <p className="text-[12px] text-ink-soft">
            {item.actor ? `משתמש ${item.actor.id}` : 'אורח'}
            {item.orgId ? ` · ${item.orgId}` : ''}
          </p>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-md px-2 py-0.5 text-[12px] font-bold ${
                item.source === 'server' ? 'bg-hard-soft text-hard' : 'bg-warn-soft text-warn'
              }`}
            >
              {item.source === 'server' ? 'שרת' : 'לקוח'}
            </span>
            {item.status ? <span className="text-xs font-semibold text-ink-soft">{item.status}</span> : null}
          </div>
        </div>
      </summary>
      {item.stack ? (
        <pre dir="ltr" className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-3 text-left text-[11px] text-ink-soft">
          {item.stack}
        </pre>
      ) : null}
    </details>
  )
}

export function AdminErrorsPage() {
  const { user } = useApp()
  const [items, setItems] = useState<SystemErrorEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (nextOffset = offset) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchSystemErrorsRemote(PAGE_SIZE, nextOffset)
      setItems(result.items)
      setTotal(result.total)
      setOffset(result.offset)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת השגיאות נכשלה')
    } finally {
      setLoading(false)
    }
  }, [offset])

  useEffect(() => {
    if (user?.role !== 'super_admin') return
    void load(0)
    const timer = window.setInterval(() => void load(0), 30_000)
    return () => window.clearInterval(timer)
  }, [load, user?.role])

  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'super_admin') return <Navigate to="/" replace />

  return (
    <main className="mx-auto min-h-dvh w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="size-11" />
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">יומן שגיאות</h1>
            <p className="mt-1 text-sm text-ink-soft">שגיאות מערכת ולקוח · {total} רשומות</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin" className="ui-btn ui-btn-secondary">
            <ArrowRight className="size-4" aria-hidden /> חזרה לניהול
          </Link>
          <ThemeToggle />
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            disabled={loading}
            onClick={() => void load(offset)}
            aria-label="רענון יומן השגיאות"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>
      </header>

      <section className="overflow-hidden rounded-xl border border-line/70 bg-card">
        <div className="border-b border-line/70 bg-surface/80 px-4 py-3">
          <h2 className="font-display text-base font-bold text-ink">אירועים אחרונים</h2>
        </div>
        {error ? <p role="alert" className="px-4 py-5 text-sm text-hard">{error}</p> : null}
        {!error && !loading && items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-soft">לא נרשמו שגיאות.</p>
        ) : null}
        {items.map((item) => <ErrorRow key={item.id} item={item} />)}
        {loading && items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-soft">טוען שגיאות…</p>
        ) : null}
      </section>

      <nav className="mt-4 flex items-center justify-between" aria-label="עמודי יומן השגיאות">
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          disabled={loading || offset + PAGE_SIZE >= total}
          onClick={() => void load(offset + PAGE_SIZE)}
        >
          ישנות יותר <ChevronLeft className="size-4" aria-hidden />
        </button>
        <span className="text-[12px] text-ink-soft">
          {total === 0 ? '0' : `${offset + 1}–${Math.min(offset + items.length, total)}`} מתוך {total}
        </span>
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          disabled={loading || offset === 0}
          onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
        >
          <ChevronRight className="size-4" aria-hidden /> חדשות יותר
        </button>
      </nav>
    </main>
  )
}
