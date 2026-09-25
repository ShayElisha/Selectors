import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  List,
  Moon,
  MoreHorizontal,
  Search,
  Sun,
  Sunset,
  Table2,
  Trash2,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { SHIFT_TYPE_LABELS } from '../constants'
import {
  EmptyState,
  IntensityBadge,
  Ltr,
  PersonChip,
  SectionCard,
  Skeleton,
  StaffingBadge,
} from '../components/ui'
import { RangeBar, type RangePresetId } from '../components/RangeBar'
import { SelectorRoundTable } from '../components/SelectorRoundTable'
import { selectorLanes } from '../lib/selectorRounds'
import {
  formatShiftDate,
  formatShiftWindow,
  pluralizeHe,
} from '../lib/hebrew'
import {
  buildHistoryBackupJson,
  daysAgoISO,
  downloadTextFile,
  filterDayCards,
  groupHistoryDays,
  historyDayLabel,
  laneRowsForShift,
  monthKey,
  monthSeparatorLabel,
  presentAssignedHealth,
  shiftCountsLabel,
  shiftMatchesSearch,
  todayISO,
  type HistoryDayCard,
} from '../lib/historyList'
import { buildHistoryMatrix } from '../lib/historyMatrix'
import { downloadHistoryExcel } from '../lib/historyExport'
import { notify } from '../lib/notify'
import { workerMatchesSearch } from '../lib/trackingHeatmap'
import type { ShiftSchedule, ShiftType } from '../types'

type Mode = 'matrix' | 'list'
const HISTORY_PRESETS = ['14', '30', 'all', 'custom'] as const
const PAGE_SIZE = 7

const SHIFT_ICONS: Record<ShiftType, typeof Sun> = {
  morning: Sun,
  afternoon: Sunset,
  afternoonA: Sunset,
  afternoonB: Sunset,
  night: Moon,
}

function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  confirmDisabled,
  danger,
  onConfirm,
  onCancel,
  initialFocusCancel = true,
}: {
  open: boolean
  title: string
  children: React.ReactNode
  confirmLabel: string
  confirmDisabled?: boolean
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  initialFocusCancel?: boolean
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const t = window.setTimeout(() => {
      ;(initialFocusCancel ? cancelRef : confirmRef).current?.focus()
    }, 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      previouslyFocused.current?.focus?.()
    }
  }, [open, onCancel, initialFocusCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4 no-print"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="history-confirm-title"
        className="w-full max-w-md rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-panel-hover)] animate-fade-up sm:p-5"
      >
        <h3
          id="history-confirm-title"
          className="font-display text-base font-bold text-ink sm:text-lg"
        >
          {title}
        </h3>
        <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-ink-soft">
          {children}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="ui-btn ui-btn-secondary min-h-10 px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            ביטול
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirm}
            className={`ui-btn min-h-10 px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 ${
              danger
                ? 'border border-hard bg-hard text-white hover:bg-hard/90'
                : 'ui-btn-primary'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function HealthChip({ shift }: { shift: ShiftSchedule }) {
  const health = presentAssignedHealth(shift)
  if (health.kind === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-easy-soft px-1.5 py-0.5 text-[12px] font-semibold text-easy ring-1 ring-easy/20">
        <CheckCircle2 className="size-3.5" aria-hidden />
        כל הנוכחים משובצים
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[12px] font-semibold text-warn ring-1 ring-warn/20">
      <AlertTriangle className="size-3.5" aria-hidden />
      {pluralizeHe(health.count, {
        one: 'נוכח אחד לא משובץ',
        two: 'שני נוכחים לא משובצים',
        many: 'נוכחים לא משובצים',
      })}
    </span>
  )
}

function ShiftAccordion({
  shift,
  search,
  onOpen,
  onRequestDelete,
}: {
  shift: ShiftSchedule
  search: string
  onOpen: () => void
  onRequestDelete: () => void
}) {
  const { data } = useApp()
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const Icon = SHIFT_ICONS[shift.shiftType]
  const lanesById = useMemo(
    () => new Map(data.lanes.map((l) => [l.id, l])),
    [data.lanes],
  )
  const workersById = useMemo(
    () => new Map(data.workers.map((w) => [w.id, w])),
    [data.workers],
  )
  const rows = useMemo(
    () => laneRowsForShift(shift, lanesById),
    [shift, lanesById],
  )

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const deleteLabel = `מחיקת משמרת ${SHIFT_TYPE_LABELS[shift.shiftType]} ${formatShiftDate(shift.date)}`

  return (
    <div className="rounded-xl border border-line bg-surface/80">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-start transition hover:bg-card/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
        >
          <Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-ink">
                {SHIFT_TYPE_LABELS[shift.shiftType]}
                {shift.audience === 'selector' ? ' · סלקטורים' : ''}
              </span>
              <Ltr className="text-[13px] text-ink-soft">
                {formatShiftWindow(shift.shiftType)}
              </Ltr>
              <ChevronDown
                className={`size-4 text-ink-soft transition ${open ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </div>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              {shiftCountsLabel(shift)}
            </p>
            <div className="mt-1.5">
              <HealthChip shift={shift} />
            </div>
          </div>
        </button>
        <div className="relative flex items-center pe-1" ref={menuRef}>
          <button
            type="button"
            aria-label={`פעולות — ${deleteLabel.replace('מחיקת ', '')}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex size-10 items-center justify-center rounded-lg text-ink-soft transition hover:bg-card hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <MoreHorizontal className="size-5" aria-hidden />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute end-0 top-full z-40 mt-1 min-w-[9rem] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[var(--shadow-panel-hover)]"
            >
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-start text-[13px] font-medium text-ink hover:bg-surface"
                onClick={() => {
                  setMenuOpen(false)
                  onOpen()
                }}
              >
                פתיחה / עריכה
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label={deleteLabel}
                className="flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] font-medium text-hard hover:bg-hard-soft"
                onClick={() => {
                  setMenuOpen(false)
                  onRequestDelete()
                }}
              >
                <Trash2 className="size-3.5" aria-hidden />
                מחיקה
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="border-t border-line px-3 py-3">
          {shift.audience === 'selector' ? (
            <SelectorRoundTable
              rounds={shift.rounds ?? []}
              lanes={selectorLanes(
                data.lanes,
                shift.activeLaneIds,
              )}
              workers={data.workers.filter((w) =>
                shift.presentWorkerIds.includes(w.id),
              )}
              overrides={shift.staffingOverrides}
            />
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-ink-soft">אין שיבוצים בנתיבים</p>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((row) => (
                <li key={row.laneId}>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {row.intensity ? (
                      <IntensityBadge intensity={row.intensity} />
                    ) : (
                      <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-soft ring-1 ring-line">
                        לא ידוע
                      </span>
                    )}
                    <span className="text-sm font-semibold text-ink">
                      {row.name}
                    </span>
                    {row.staffingStandard != null ? (
                      <StaffingBadge
                        assigned={row.workerIds.length}
                        standard={row.staffingStandard}
                      />
                    ) : (
                      <Ltr className="text-[12px] text-ink-soft">
                        {row.workerIds.length}/—
                      </Ltr>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {row.workerIds.map((id) => {
                      const name = workersById.get(id)?.fullName ?? id
                      const hit = search.trim()
                        ? workerMatchesSearch(name, search)
                        : false
                      return (
                        <span
                          key={id}
                          className={
                            hit
                              ? 'rounded-full ring-2 ring-accent ring-offset-1'
                              : undefined
                          }
                        >
                          <PersonChip name={name} />
                        </span>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="mt-3 text-[13px] font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            עריכה
          </button>
        </div>
      ) : null}
    </div>
  )
}

function EmptySlot({ shiftType }: { shiftType: ShiftType }) {
  const Icon = SHIFT_ICONS[shiftType]
  return (
    <div className="flex h-full min-h-[4.5rem] flex-col justify-center rounded-xl border border-dashed border-line/80 bg-surface/40 px-3 py-2 opacity-70">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-soft">
        <Icon className="size-3.5" aria-hidden />
        {SHIFT_TYPE_LABELS[shiftType]}
      </div>
      <p className="mt-1 text-[13px] text-ink-soft">לא נשמר</p>
    </div>
  )
}

export function HistoryPage() {
  const {
    data,
    loadShiftFromHistory,
    deleteHistoryItem,
    resetToSeed,
    loading,
    error,
  } = useApp()
  const [mode, setMode] = useState<Mode>('list')
  const [range, setRange] = useState<RangePresetId>('all')
  const [customFrom, setCustomFrom] = useState(() => daysAgoISO(30))
  const [customTo, setCustomTo] = useState(() => todayISO())
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ShiftType | 'all'>('all')
  const [visibleDays, setVisibleDays] = useState(PAGE_SIZE)
  const [hideNights, setHideNights] = useState(false)
  const [highlightRepeats, setHighlightRepeats] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<ShiftSchedule | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetTyped, setResetTyped] = useState('')
  const [dangerMenuOpen, setDangerMenuOpen] = useState(false)
  const dangerRef = useRef<HTMLDivElement>(null)

  const { fromDate, toDate } = useMemo(() => {
    if (range === '14') return { fromDate: daysAgoISO(14), toDate: todayISO() }
    if (range === '30') return { fromDate: daysAgoISO(30), toDate: todayISO() }
    if (range === 'custom') {
      const from = customFrom || undefined
      const to = customTo || undefined
      if (from && to && from > to) return { fromDate: to, toDate: from }
      return { fromDate: from, toDate: to }
    }
    return {
      fromDate: undefined as string | undefined,
      toDate: undefined as string | undefined,
    }
  }, [range, customFrom, customTo])

  const workersById = useMemo(
    () => new Map(data.workers.map((w) => [w.id, w])),
    [data.workers],
  )

  const matrix = useMemo(
    () =>
      buildHistoryMatrix(data.workers, data.lanes, data.history, {
        fromDate,
        toDate,
      }),
    [data.workers, data.lanes, data.history, fromDate, toDate],
  )

  const matrixView = useMemo(() => {
    const columns = hideNights
      ? matrix.columns.filter((c) => c.shiftType !== 'night')
      : matrix.columns
    const rows = matrix.rows.map((row) => {
      const laneCounts = new Map<string, number>()
      for (const col of columns) {
        const cell = row.cells[col.key]
        if (!cell || cell.presentOnly) continue
        for (const name of cell.laneNames) {
          laneCounts.set(name, (laneCounts.get(name) ?? 0) + 1)
        }
      }
      const repeatLanes = new Set(
        [...laneCounts.entries()]
          .filter(([, n]) => n >= 2)
          .map(([name]) => name),
      )
      return { ...row, repeatLanes }
    })
    return { columns, rows }
  }, [matrix, hideNights])

  const allDays = useMemo(
    () => groupHistoryDays(data.history, { fromDate, toDate }),
    [data.history, fromDate, toDate],
  )

  const filteredDays = useMemo(
    () =>
      filterDayCards(allDays, {
        search,
        shiftTypes: typeFilter === 'all' ? 'all' : new Set([typeFilter]),
        workersById,
      }),
    [allDays, search, typeFilter, workersById],
  )

  const shownDays = filteredDays.slice(0, visibleDays)

  const shiftsInRange = useMemo(() => {
    return data.history.filter((h) => {
      if (fromDate && h.date < fromDate) return false
      if (toDate && h.date > toDate) return false
      return true
    })
  }, [data.history, fromDate, toDate])

  const shiftsForExport = useMemo(() => {
    return shiftsInRange.filter((h) => {
      if (typeFilter !== 'all' && h.shiftType !== typeFilter) return false
      if (search.trim() && !shiftMatchesSearch(h, search, workersById)) {
        return false
      }
      return true
    })
  }, [shiftsInRange, typeFilter, search, workersById])

  const shiftMix = useMemo(() => {
    const mix: Record<ShiftType, number> = {
      morning: 0,
      afternoon: 0,
      afternoonA: 0,
      afternoonB: 0,
      night: 0,
    }
    for (const h of shiftsInRange) mix[h.shiftType] += 1
    return mix
  }, [shiftsInRange])

  useEffect(() => {
    setVisibleDays(PAGE_SIZE)
  }, [range, fromDate, toDate, search, typeFilter])

  useEffect(() => {
    if (!dangerMenuOpen) return
    const onPointer = (e: MouseEvent) => {
      if (dangerRef.current && !dangerRef.current.contains(e.target as Node)) {
        setDangerMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [dangerMenuOpen])

  const selectPreset = (id: RangePresetId) => {
    setRange(id)
    if (id === 'custom') {
      setCustomFrom(daysAgoISO(30))
      setCustomTo(todayISO())
    }
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    void deleteHistoryItem(id)
  }

  const confirmReset = async () => {
    if (resetTyped.trim() !== 'איפוס') return
    setResetOpen(false)
    setResetTyped('')
    await resetToSeed()
  }

  const exportBeforeReset = () => {
    downloadTextFile(
      buildHistoryBackupJson(data),
      `shibutzon-backup-${todayISO()}.json`,
      'application/json;charset=utf-8',
    )
    notify.success('גיבוי ההיסטוריה הורד')
  }

  const handleExportExcel = () => {
    downloadHistoryExcel(shiftsForExport, {
      workers: data.workers,
      lanes: data.lanes,
      fromDate,
      toDate,
    })
    notify.success('היסטוריית השיבוצים יוצאה לאקסל')
  }

  let lastMonth = ''

  return (
    <div className="history-print-root space-y-4">
      <SectionCard
        title="היסטוריית שיבוצים"
        subtitle="משמרות שמורות, מהחדש לישן"
        actions={
          <div className="flex flex-wrap items-center gap-2 no-print">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={shiftsForExport.length === 0 || loading}
              title={
                shiftsForExport.length === 0
                  ? 'אין משמרות לייצוא בטווח'
                  : `ייצוא ${shiftsForExport.length} משמרות לאקסל (CSV)`
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-brand-deep disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Download className="size-3.5" aria-hidden />
              ייצוא לאקסל
            </button>
            <div
              className="flex rounded-xl border border-line bg-surface p-0.5 text-[13px]"
              role="tablist"
              aria-label="תצוגת היסטוריה"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'list'}
                onClick={() => setMode('list')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  mode === 'list'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                <List className="size-3.5" aria-hidden />
                רשימה
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'matrix'}
                onClick={() => setMode('matrix')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  mode === 'matrix'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                <Table2 className="size-3.5" aria-hidden />
                לוח שיבוצים
              </button>
            </div>
          </div>
        }
      >
        <div className="mb-4 space-y-3">
          <RangeBar
            value={range}
            onChange={selectPreset}
            presets={HISTORY_PRESETS}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
            shiftsInRange={shiftsInRange.length}
            fromDate={fromDate}
            toDate={toDate}
          />
          <p className="text-[13px] text-ink-soft">
            {pluralizeHe(shiftsInRange.length, {
              one: 'משמרת אחת',
              two: 'שתי משמרות',
              many: 'משמרות',
            })}
            {' · '}
            {shiftMix.morning} בוקר · {shiftMix.afternoon} צהריים ·{' '}
            {shiftMix.night} לילה
          </p>

          {mode === 'list' ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">חיפוש בודק</span>
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
                  aria-hidden
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="חיפוש בודק…"
                  className="ui-field w-full py-2 pe-3 ps-10 text-sm"
                />
              </label>
              <div
                className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 text-[13px]"
                role="group"
                aria-label="סינון סוג משמרת"
              >
                {(
                  [
                    { id: 'all' as const, label: 'הכל' },
                    { id: 'morning' as const, label: 'בוקר' },
                    { id: 'afternoon' as const, label: 'צהריים' },
                    { id: 'night' as const, label: 'לילה' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTypeFilter(opt.id)}
                    className={`rounded-lg px-2.5 py-1.5 font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                      typeFilter === opt.id
                        ? 'bg-brand text-white shadow-sm'
                        : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <p
            className="rounded-xl border border-hard/30 bg-hard-soft px-3 py-3 text-[13px] text-hard"
            role="alert"
          >
            שגיאה: {error}
          </p>
        ) : data.history.length === 0 ? (
          <EmptyState
            title="אין משמרות שמורות בטווח שנבחר"
            text="אחרי שמירת משמרת יופיעו כאן כל המשמרות."
          />
        ) : mode === 'matrix' ? (
          matrixView.columns.length === 0 || matrixView.rows.length === 0 ? (
            <EmptyState
              title="אין משמרות בטווח"
              text="נסו להרחיב את טווח התאריכים."
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 no-print">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-ink">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--color-brand)]"
                    checked={hideNights}
                    onChange={(e) => setHideNights(e.target.checked)}
                  />
                  הסתר משמרות לילה
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-ink">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--color-brand)]"
                    checked={highlightRepeats}
                    onChange={(e) => setHighlightRepeats(e.target.checked)}
                  />
                  הדגש חזרות לאותו נתיב
                </label>
              </div>
              <div className="-mx-1 overflow-x-auto overscroll-x-contain rounded-xl border border-line sm:mx-0">
                <table className="w-max min-w-full border-collapse text-end text-xs">
                  <thead>
                    <tr className="bg-brand-deep text-white">
                      <th className="sticky start-0 z-30 min-w-[8rem] bg-brand-deep px-3 py-2.5 text-end font-semibold">
                        בודק
                      </th>
                      {matrixView.columns.map((col) => (
                        <th
                          key={col.key}
                          className="min-w-[6rem] whitespace-nowrap px-2 py-2 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => loadShiftFromHistory(col.shiftId)}
                            className="flex w-full flex-col items-center gap-0.5 rounded-lg px-1 py-0.5 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                            title="פתיחה לעריכה"
                          >
                            <Ltr className="leading-tight">{col.dateLabel}</Ltr>
                            <span className="text-[10px] font-normal text-white/75">
                              {col.shiftLabel}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixView.rows.map((row, i) => {
                      const rowBg = i % 2 === 0 ? 'bg-card' : 'bg-surface'
                      return (
                        <tr key={row.workerId} className={rowBg}>
                          <td
                            className={`sticky start-0 z-20 border-b border-line px-3 py-2 font-semibold whitespace-nowrap text-ink ${rowBg}`}
                          >
                            {row.fullName}
                          </td>
                          {matrixView.columns.map((col) => {
                            const cell = row.cells[col.key]
                            return (
                              <td
                                key={col.key}
                                className="border-b border-line px-2 py-2 text-center align-middle"
                              >
                                {!cell ? (
                                  <span className="text-ink-soft/50">·</span>
                                ) : cell.presentOnly ? (
                                  <span className="text-[10px] font-medium text-ink-soft">
                                    נוכח
                                  </span>
                                ) : (
                                  <span className="inline-flex flex-col gap-0.5">
                                    {cell.laneNames.map((name) => {
                                      const isRepeat =
                                        highlightRepeats &&
                                        row.repeatLanes.has(name)
                                      return (
                                        <span
                                          key={name}
                                          className={
                                            isRepeat
                                              ? 'rounded-md border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent sm:text-[11px]'
                                              : 'rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand sm:text-[11px]'
                                          }
                                          title={
                                            isRepeat
                                              ? 'חזרה לאותו נתיב בטווח המוצג'
                                              : undefined
                                          }
                                        >
                                          {name}
                                        </span>
                                      )
                                    })}
                                  </span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                גלילה אופקית · עמודת השמות קבועה · לחיצה על כותרת פותחת משמרת
                {highlightRepeats
                  ? ' · רקע כתום = חזרה לאותו נתיב בטווח (בלי לילות אם הוסתרו)'
                  : ''}
                .
              </p>
            </>
          )
        ) : filteredDays.length === 0 ? (
          <EmptyState
            title="אין משמרות בטווח שנבחר"
            text="נסו להרחיב את הטווח או לנקות חיפוש/סינון."
          />
        ) : (
          <div className="space-y-4">
            {shownDays.map((day) => {
              const mk = monthKey(day.date)
              const showMonth = mk !== lastMonth
              lastMonth = mk
              const label = historyDayLabel(day.date)
              return (
                <div key={day.date}>
                  {showMonth ? (
                    <p className="sticky top-0 z-[5] mb-2 bg-surface/95 py-1 text-[13px] font-bold text-brand backdrop-blur-sm">
                      {monthSeparatorLabel(mk)}
                    </p>
                  ) : null}
                  <DayCard
                    day={day}
                    label={label}
                    search={search}
                    onOpen={(id) => loadShiftFromHistory(id)}
                    onRequestDelete={setDeleteTarget}
                  />
                </div>
              )
            })}
            {visibleDays < filteredDays.length ? (
              <button
                type="button"
                onClick={() => setVisibleDays((n) => n + PAGE_SIZE)}
                className="w-full rounded-xl border border-line bg-card py-2.5 text-[13px] font-semibold text-brand transition hover:border-brand/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand no-print"
              >
                הצג עוד (
                <Ltr>{String(filteredDays.length - visibleDays)}</Ltr>)
              </button>
            ) : null}
          </div>
        )}
      </SectionCard>

      <section className="rounded-xl border border-hard/25 bg-hard-soft/40 p-4 no-print">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-hard">אזור מסוכן</h3>
            <p className="mt-1 text-[13px] text-ink-soft">
              איפוס מחזיר את כל המערכת לנתוני דוגמה ומוחק את כל המשמרות השמורות,
              הבודקים והנתיבים הנוכחיים.
            </p>
          </div>
          <div className="relative" ref={dangerRef}>
            <button
              type="button"
              aria-expanded={dangerMenuOpen}
              aria-haspopup="menu"
              onClick={() => setDangerMenuOpen((o) => !o)}
              className="inline-flex size-10 items-center justify-center rounded-lg border border-hard/30 bg-card text-hard transition hover:bg-hard-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hard"
              aria-label="תפריט פעולות מסוכנות"
            >
              <MoreHorizontal className="size-5" aria-hidden />
            </button>
            {dangerMenuOpen ? (
              <div
                role="menu"
                className="absolute end-0 top-full z-40 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[var(--shadow-panel-hover)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-start text-[13px] font-semibold text-hard hover:bg-hard-soft"
                  onClick={() => {
                    setDangerMenuOpen(false)
                    setResetTyped('')
                    setResetOpen(true)
                  }}
                >
                  איפוס נתונים…
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="מחיקת משמרת"
        confirmLabel="מחיקה"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      >
        {deleteTarget ? (
          <>
            <p>
              למחוק את משמרת {SHIFT_TYPE_LABELS[deleteTarget.shiftType]} מיום{' '}
              <Ltr>{formatShiftDate(deleteTarget.date)}</Ltr>?
            </p>
            <p>{shiftCountsLabel(deleteTarget)}</p>
            <p>
              המחיקה תשפיע על חישובי הרוטציה והעומס בשיבוצים הבאים ולא ניתן
              לשחזר אותה.
            </p>
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={resetOpen}
        title="איפוס כל הנתונים"
        confirmLabel="איפוס"
        danger
        confirmDisabled={resetTyped.trim() !== 'איפוס'}
        onCancel={() => {
          setResetOpen(false)
          setResetTyped('')
        }}
        onConfirm={() => void confirmReset()}
      >
        <p>
          יימחקו ויידרסו:{' '}
          {pluralizeHe(data.history.length, {
            one: 'משמרת אחת שמורה',
            two: 'שתי משמרות שמורות',
            many: 'משמרות שמורות',
          })}
          ,{' '}
          {pluralizeHe(data.workers.length, {
            one: 'בודק אחד',
            two: 'שני בודקים',
            many: 'בודקים',
          })}
          ,{' '}
          {pluralizeHe(data.lanes.length, {
            one: 'נתיב אחד',
            two: 'שני נתיבים',
            many: 'נתיבים',
          })}{' '}
          והסמכות — ויוחלפו בנתוני דוגמה ריקים מהיסטוריה.
        </p>
        <p>לא ניתן לשחזר אחרי האיפוס.</p>
        <button
          type="button"
          onClick={exportBeforeReset}
          className="text-[13px] font-semibold text-brand underline-offset-2 hover:underline"
        >
          ייצוא לפני איפוס (JSON)
        </button>
        <label className="mt-2 block text-[13px] font-medium text-ink">
          הקלידו <span className="font-bold">איפוס</span> לאישור
          <input
            className="ui-field mt-1.5"
            value={resetTyped}
            onChange={(e) => setResetTyped(e.target.value)}
            autoComplete="off"
          />
        </label>
      </ConfirmDialog>
    </div>
  )
}

function DayCard({
  day,
  label,
  search,
  onOpen,
  onRequestDelete,
}: {
  day: HistoryDayCard
  label: ReturnType<typeof historyDayLabel>
  search: string
  onOpen: (id: string) => void
  onRequestDelete: (s: ShiftSchedule) => void
}) {
  return (
    <section className="rounded-xl border border-line bg-card/95 p-3 shadow-sm sm:p-4">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {label.relative ? (
          <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[12px] font-bold text-brand">
            {label.relative}
          </span>
        ) : null}
        <h3 className="font-display text-sm font-bold text-ink sm:text-base">
          {label.weekday}
        </h3>
        <Ltr className="text-[13px] text-ink-soft">{label.dateText}</Ltr>
      </header>
      <div className="grid gap-2 md:grid-cols-3">
        {day.slots.map((slot) => {
          const shifts = [slot.shift, slot.selectorShift].filter(
            (s): s is NonNullable<typeof slot.shift> => Boolean(s),
          )
          if (shifts.length === 0) {
            return <EmptySlot key={slot.shiftType} shiftType={slot.shiftType} />
          }
          return shifts.map((shift) => (
            <ShiftAccordion
              key={shift.id}
              shift={shift}
              search={search}
              onOpen={() => onOpen(shift.id)}
              onRequestDelete={() => onRequestDelete(shift)}
            />
          ))
        })}
      </div>
    </section>
  )
}
