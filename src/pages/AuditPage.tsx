import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { fetchAuditLogs, type AuditLogEntry } from '../api'
import { FieldLabel, SectionCard } from '../components/ui'
import {
  AUDIT_ACTION_LABELS,
  downloadAuditExcel,
} from '../lib/auditExport'
import { notify } from '../lib/notify'

const PAGE_SIZE = 20

const ACTION_LABELS = AUDIT_ACTION_LABELS

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function toLocalDateInput(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return ''
  }
}

function matchesFilters(
  row: AuditLogEntry,
  opts: {
    q: string
    action: string
    actorName: string
    actorPhone: string
    details: string
    dateFrom: string
    dateTo: string
  },
): boolean {
  if (opts.action !== 'all' && row.action !== opts.action) return false

  const name = (row.actor?.fullName || '').toLowerCase()
  const phone = (row.actor?.phone || '').replace(/\D/g, '')
  const details = (row.details || '').toLowerCase()
  const actionLabel = (ACTION_LABELS[row.action] ?? row.action).toLowerCase()
  const when = formatWhen(row.at).toLowerCase()

  if (opts.actorName.trim()) {
    const needle = opts.actorName.trim().toLowerCase()
    if (!name.includes(needle)) return false
  }
  if (opts.actorPhone.trim()) {
    const needle = opts.actorPhone.replace(/\D/g, '')
    if (!needle || !phone.includes(needle)) return false
  }
  if (opts.details.trim()) {
    const needle = opts.details.trim().toLowerCase()
    if (!details.includes(needle)) return false
  }

  const day = toLocalDateInput(row.at)
  if (opts.dateFrom && day && day < opts.dateFrom) return false
  if (opts.dateTo && day && day > opts.dateTo) return false

  if (opts.q.trim()) {
    const needle = opts.q.trim().toLowerCase()
    const phoneNeedle = opts.q.replace(/\D/g, '')
    const hay = [name, details, actionLabel, row.action, when, row.id].join(' ')
    const textHit = hay.includes(needle)
    const phoneHit = phoneNeedle.length >= 3 && phone.includes(phoneNeedle)
    if (!textHit && !phoneHit) return false
  }

  return true
}

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [action, setAction] = useState('all')
  const [actorName, setActorName] = useState('')
  const [actorPhone, setActorPhone] = useState('')
  const [details, setDetails] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [filtersExpanded, setFiltersExpanded] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setLogs(await fetchAuditLogs(500))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'טעינת היומן נכשלה'
      setError(msg)
      notify.error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filterOptions = useMemo(() => {
    const fromData = [...new Set(logs.map((l) => l.action))]
    const known = Object.keys(ACTION_LABELS)
    return [...new Set([...known, ...fromData])].sort((a, b) =>
      (ACTION_LABELS[a] ?? a).localeCompare(ACTION_LABELS[b] ?? b, 'he'),
    )
  }, [logs])

  const filtered = useMemo(() => {
    return logs.filter((row) =>
      matchesFilters(row, {
        q,
        action,
        actorName,
        actorPhone,
        details,
        dateFrom,
        dateTo,
      }),
    )
  }, [logs, q, action, actorName, actorPhone, details, dateFrom, dateTo])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  useEffect(() => {
    setPage(1)
  }, [q, action, actorName, actorPhone, details, dateFrom, dateTo])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])

  const hasActiveFilters =
    q.trim() !== '' ||
    action !== 'all' ||
    actorName.trim() !== '' ||
    actorPhone.trim() !== '' ||
    details.trim() !== '' ||
    dateFrom !== '' ||
    dateTo !== ''

  const clearFilters = () => {
    setQ('')
    setAction('all')
    setActorName('')
    setActorPhone('')
    setDetails('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const fromIdx = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx = Math.min(page * PAGE_SIZE, filtered.length)

  const exportFiltered = () => {
    downloadAuditExcel(filtered, {
      q,
      action,
      actorName,
      actorPhone,
      details,
      dateFrom,
      dateTo,
      totalLogs: logs.length,
      filteredCount: filtered.length,
    })
    notify.success(
      hasActiveFilters
        ? `יוצאו ${filtered.length} רשומות מסוננות`
        : `יוצאו ${filtered.length} רשומות`,
    )
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="יומן פעולות"
        subtitle="20 רשומות בעמוד · חיפוש וסינון לפי פעולה, משתמש, טלפון, פרטים ותאריך"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={exportFiltered}
              disabled={filtered.length === 0}
              title={
                filtered.length === 0
                  ? 'אין רשומות לייצוא'
                  : hasActiveFilters
                    ? `ייצוא ${filtered.length} רשומות מסוננות לאקסל (CSV)`
                    : `ייצוא ${filtered.length} רשומות לאקסל (CSV)`
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-40 sm:text-sm"
            >
              <Download className="size-3.5" aria-hidden />
              ייצוא לאקסל
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface sm:text-sm"
            >
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              רענון
            </button>
          </div>
        }
      >
        <div className="mb-4 space-y-3 rounded-xl border border-line/70 bg-surface/50 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setFiltersExpanded((o) => !o)}
              aria-expanded={filtersExpanded}
              className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-ink hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {filtersExpanded ? (
                <ChevronUp className="size-4 text-ink-soft" aria-hidden />
              ) : (
                <ChevronDown className="size-4 text-ink-soft" aria-hidden />
              )}
              מסננים
              {hasActiveFilters ? (
                <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand">
                  פעיל
                </span>
              ) : null}
            </button>
            <div className="flex flex-wrap items-center gap-2">
              {hasActiveFilters ? (
                <>
                  <p className="text-xs text-ink-soft">
                    נמצאו {filtered.length} מתוך {logs.length} רשומות
                  </p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-surface"
                  >
                    <X className="size-3.5" />
                    נקה סינון
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {filtersExpanded ? (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
                  aria-hidden
                />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="חיפוש חופשי בכל השדות…"
                  className="ui-field !py-2 pe-3 ps-10 text-sm"
                  aria-label="חיפוש חופשי"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <FieldLabel htmlFor="audit-action">סוג פעולה</FieldLabel>
                  <select
                    id="audit-action"
                    className="ui-field !py-2 text-sm"
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    <option value="all">הכל</option>
                    {filterOptions.map((a) => (
                      <option key={a} value={a}>
                        {ACTION_LABELS[a] ?? a}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel htmlFor="audit-actor">שם משתמש</FieldLabel>
                  <input
                    id="audit-actor"
                    type="text"
                    value={actorName}
                    onChange={(e) => setActorName(e.target.value)}
                    placeholder="למשל שי אלישע"
                    className="ui-field !py-2 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="audit-phone">טלפון</FieldLabel>
                  <input
                    id="audit-phone"
                    type="search"
                    inputMode="tel"
                    value={actorPhone}
                    onChange={(e) => setActorPhone(e.target.value)}
                    placeholder="ספרות בלבד"
                    className="ui-field !py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <FieldLabel htmlFor="audit-details">פרטים</FieldLabel>
                  <input
                    id="audit-details"
                    type="search"
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="טקסט בתוך פרטי הפעולה"
                    className="ui-field !py-2 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="audit-from">מתאריך</FieldLabel>
                  <input
                    id="audit-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="ui-field !py-2 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="audit-to">עד תאריך</FieldLabel>
                  <input
                    id="audit-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="ui-field !py-2 text-sm"
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-hard/30 bg-hard-soft px-3 py-2 text-sm text-hard">
            {error}
          </p>
        )}

        {loading && logs.length === 0 ? (
          <p className="text-sm text-ink-soft">טוען יומן…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-ink-soft">
            {logs.length === 0
              ? 'עדיין אין רשומות. פעולות כמו שמירת שיבוץ, החלפות וייצוא יופיעו כאן.'
              : 'אין תוצאות לסינון הנוכחי.'}
          </p>
        ) : (
          <>
            <ul className="space-y-2 sm:hidden">
              {pageRows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-line/70 bg-card px-3 py-2.5 shadow-sm"
                >
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                    <span className="inline-flex rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand">
                      {ACTION_LABELS[row.action] ?? row.action}
                    </span>
                    <span className="text-[11px] tabular-nums text-ink-soft">
                      {formatWhen(row.at)}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-ink">
                    {row.actor?.fullName || '—'}
                    {row.actor?.phone ? (
                      <span className="ms-1.5 text-xs font-normal text-ink-soft">
                        {row.actor.phone}
                      </span>
                    ) : null}
                  </p>
                  {row.details && (
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                      {row.details}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            <div className="hidden overflow-hidden rounded-xl border border-line/70 shadow-sm sm:block">
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-right text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-line/70 bg-surface/90">
                      <th className="px-3 py-2.5 text-[10px] font-semibold tracking-wide text-ink-soft uppercase sm:px-4 sm:text-[11px]">
                        זמן
                      </th>
                      <th className="px-3 py-2.5 text-[10px] font-semibold tracking-wide text-ink-soft uppercase sm:px-4 sm:text-[11px]">
                        משתמש
                      </th>
                      <th className="px-3 py-2.5 text-[10px] font-semibold tracking-wide text-ink-soft uppercase sm:px-4 sm:text-[11px]">
                        טלפון
                      </th>
                      <th className="px-3 py-2.5 text-[10px] font-semibold tracking-wide text-ink-soft uppercase sm:px-4 sm:text-[11px]">
                        פעולה
                      </th>
                      <th className="px-3 py-2.5 text-[10px] font-semibold tracking-wide text-ink-soft uppercase sm:px-4 sm:text-[11px]">
                        פרטים
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {pageRows.map((row) => (
                      <tr
                        key={row.id}
                        className="bg-card transition-colors hover:bg-surface/60"
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-ink-soft sm:px-4">
                          {formatWhen(row.at)}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-ink sm:px-4">
                          {row.actor?.fullName || '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-ink-soft sm:px-4">
                          {row.actor?.phone || '—'}
                        </td>
                        <td className="px-3 py-2.5 sm:px-4">
                          <span className="inline-flex rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand sm:text-xs">
                            {ACTION_LABELS[row.action] ?? row.action}
                          </span>
                        </td>
                        <td className="max-w-md px-3 py-2.5 text-ink-soft sm:px-4">
                          {row.details || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-soft sm:text-sm">
                מציג {fromIdx}–{toIdx} מתוך {filtered.length}
                {hasActiveFilters ? ` (מסונן מ־${logs.length})` : ''}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-40 sm:text-sm"
                >
                  <ChevronRight className="size-3.5" aria-hidden />
                  הקודם
                </button>
                <span className="min-w-[4.5rem] text-center text-xs font-semibold tabular-nums text-ink sm:text-sm">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-40 sm:text-sm"
                >
                  הבא
                  <ChevronLeft className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  )
}
