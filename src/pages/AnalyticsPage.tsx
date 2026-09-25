import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Download,
  Info,
  Loader2,
  Minus,
  Moon,
  RefreshCw,
  Table2,
} from 'lucide-react'
import {
  computeTeamAnalytics,
  fairnessGapStatus,
  filterLaneRepeats,
  formatLoadOneDecimal,
  loadDeviationFromMean,
  loadPerShift,
  type FairnessGapStatus,
  type HardAfterNightEvent,
  type LoadDeviation,
  type WorkerAnalyticsRow,
} from '../lib/analytics'
import { computeShortReturnRate } from '../lib/assignmentQuality'
import { downloadAnalyticsExcel } from '../lib/analyticsExport'
import { notify } from '../lib/notify'
import { IntensityBadge, Ltr, SectionCard, Skeleton } from '../components/ui'
import { RangeBar, type RangePresetId } from '../components/RangeBar'
import { useApp } from '../context/AppContext'
import { formatShiftDate, pluralizeHe } from '../lib/hebrew'
import { SHIFT_TYPE_LABELS } from '../constants'
import type { ShiftType } from '../types'

const ANALYTICS_PRESETS = ['7', '14', '30', 'all', 'custom'] as const

function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function InfoTip({ label, children }: { label: string; children: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="rounded-full p-0.5 text-ink-soft transition hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
        aria-label={label}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute end-0 top-full z-30 mt-1.5 hidden w-60 rounded-lg border border-line bg-card px-2.5 py-2 text-start text-[13px] font-normal leading-relaxed text-ink shadow-[var(--shadow-panel-hover)] group-focus-within:block group-hover:block"
      >
        {children}
      </span>
    </span>
  )
}

function MeanLoadBar({
  value,
  max,
  mean,
  deviation,
}: {
  value: number
  max: number
  mean: number
  deviation: LoadDeviation
}) {
  const span = Math.max(max, mean, 1)
  const pct = Math.min(100, (value / span) * 100)
  const meanPct = Math.min(100, (mean / span) * 100)
  const fill =
    deviation === 'above'
      ? 'bg-hard/70'
      : deviation === 'below'
        ? 'bg-easy/70'
        : 'bg-brand/70'
  const Icon =
    deviation === 'above' ? ArrowUp : deviation === 'below' ? ArrowDown : Minus
  const tip =
    deviation === 'above'
      ? 'מעל הממוצע'
      : deviation === 'below'
        ? 'מתחת לממוצע'
        : 'קרוב לממוצע'
  return (
    <div className="flex items-center gap-2">
      <Ltr className="w-9 shrink-0 text-start text-[13px] font-bold tabular-nums text-ink">
        {formatLoadOneDecimal(value)}
      </Ltr>
      <div
        className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface ring-1 ring-line/70"
        role="img"
        aria-label={`עומס ${formatLoadOneDecimal(value)}, ממוצע ${formatLoadOneDecimal(mean)}, ${tip}`}
      >
        <div
          className={`absolute inset-y-0 start-0 rounded-full ${fill}`}
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-accent"
          style={{ insetInlineStart: `${meanPct}%` }}
          title="ממוצע צוות"
        />
      </div>
      <span className="inline-flex size-5 shrink-0 items-center justify-center" title={tip}>
        <Icon
          className={`size-3.5 ${
            deviation === 'above'
              ? 'text-hard'
              : deviation === 'below'
                ? 'text-easy'
                : 'text-ink-soft'
          }`}
          aria-hidden
        />
        <span className="sr-only">{tip}</span>
      </span>
    </div>
  )
}

function ShiftMiniStack({
  byType,
}: {
  byType: Record<ShiftType, number>
}) {
  const total = byType.morning + byType.afternoon + byType.night || 1
  const parts: { key: ShiftType; className: string }[] = [
    { key: 'morning', className: 'bg-brand/70' },
    { key: 'afternoon', className: 'bg-accent/70' },
    { key: 'night', className: 'bg-ink-soft/50' },
  ]
  return (
    <div
      className="flex h-1.5 w-12 overflow-hidden rounded-full ring-1 ring-line/70"
      role="img"
      aria-label={`בוקר ${byType.morning}, צהריים ${byType.afternoon}, לילה ${byType.night}`}
    >
      {parts.map((p) => {
        const w = (byType[p.key] / total) * 100
        if (w <= 0) return null
        return (
          <div key={p.key} className={p.className} style={{ width: `${w}%` }} />
        )
      })}
    </div>
  )
}

/** Compact load overview: axis + dots (no SVG name labels) + extremes as HTML. */
function LoadOverview({
  workers,
  avgLoad,
}: {
  workers: WorkerAnalyticsRow[]
  avgLoad: number
}) {
  const [focusId, setFocusId] = useState<string | null>(null)
  const max = Math.max(...workers.map((w) => w.effectiveLoad), avgLoad, 1)
  const sorted = useMemo(
    () => [...workers].sort((a, b) => b.effectiveLoad - a.effectiveLoad),
    [workers],
  )
  const highest = sorted[0]
  const lowest = sorted[sorted.length - 1]
  const focused = focusId
    ? workers.find((w) => w.workerId === focusId)
    : null

  // Simple vertical lanes to reduce overlap when loads collide
  const laneOf = (i: number) => (i % 3) - 1

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center text-[13px]">
        <div className="rounded-lg bg-surface px-2 py-2 ring-1 ring-line/70">
          <p className="text-ink-soft">נמוך</p>
          <p className="font-bold tabular-nums text-ink">
            <Ltr>{formatLoadOneDecimal(lowest?.effectiveLoad ?? 0)}</Ltr>
          </p>
          <p className="truncate text-[12px] text-ink-soft">
            {lowest?.fullName ?? '—'}
          </p>
        </div>
        <div className="rounded-lg bg-accent-soft/60 px-2 py-2 ring-1 ring-accent/20">
          <p className="text-ink-soft">ממוצע</p>
          <p className="font-bold tabular-nums text-ink">
            <Ltr>{formatLoadOneDecimal(avgLoad)}</Ltr>
          </p>
          <p className="text-[12px] text-ink-soft">
            <Ltr>{String(workers.length)}</Ltr> בודקים
          </p>
        </div>
        <div className="rounded-lg bg-surface px-2 py-2 ring-1 ring-line/70">
          <p className="text-ink-soft">גבוה</p>
          <p className="font-bold tabular-nums text-ink">
            <Ltr>{formatLoadOneDecimal(highest?.effectiveLoad ?? 0)}</Ltr>
          </p>
          <p className="truncate text-[12px] text-ink-soft">
            {highest?.fullName ?? '—'}
          </p>
        </div>
      </div>

      <div
        dir="ltr"
        className="relative h-16 rounded-xl bg-surface/80 px-3 ring-1 ring-line/70"
        role="img"
        aria-label={`התפלגות עומס מ־0 עד ${formatLoadOneDecimal(max)}, ממוצע ${formatLoadOneDecimal(avgLoad)}`}
      >
        {/* mean band */}
        <div
          className="pointer-events-none absolute inset-y-3 rounded bg-brand/10"
          style={{
            left: `calc(${(avgLoad / max) * 100}% - 6%)`,
            width: '12%',
          }}
        />
        <div
          className="pointer-events-none absolute inset-y-2 w-px bg-accent"
          style={{ left: `${(avgLoad / max) * 100}%` }}
          title={`ממוצע ${formatLoadOneDecimal(avgLoad)}`}
        />
        {/* baseline */}
        <div className="pointer-events-none absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-line" />
        {sorted.map((w, i) => {
          const left = (w.effectiveLoad / max) * 100
          const lane = laneOf(i)
          const active = focusId === w.workerId
          return (
            <button
              key={w.workerId}
              type="button"
              title={`${w.fullName}: ${formatLoadOneDecimal(w.effectiveLoad)}`}
              aria-label={`${w.fullName}, עומס ${formatLoadOneDecimal(w.effectiveLoad)}, קשה ${w.hardCount}`}
              onFocus={() => setFocusId(w.workerId)}
              onBlur={() => setFocusId(null)}
              onMouseEnter={() => setFocusId(w.workerId)}
              onMouseLeave={() => setFocusId(null)}
              className={`absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                active ? 'z-10 scale-125 bg-accent' : 'bg-brand'
              }`}
              style={{
                left: `${left}%`,
                top: `calc(50% + ${lane * 10}px)`,
              }}
            />
          )
        })}
        <span className="pointer-events-none absolute bottom-1 left-3 text-[11px] tabular-nums text-ink-soft">
          0
        </span>
        <span className="pointer-events-none absolute bottom-1 right-3 text-[11px] tabular-nums text-ink-soft">
          {formatLoadOneDecimal(max)}
        </span>
      </div>

      {focused ? (
        <p className="rounded-lg bg-card px-3 py-2 text-[13px] text-ink ring-1 ring-line" aria-live="polite">
          <span className="font-semibold">{focused.fullName}</span>
          {' · עומס '}
          <Ltr className="font-bold">{formatLoadOneDecimal(focused.effectiveLoad)}</Ltr>
          {' · קשה '}
          <Ltr>{String(focused.hardCount)}</Ltr>
          {' · קל יום '}
          <Ltr>{String(focused.dayEasyCount)}</Ltr>
        </p>
      ) : (
        <p className="text-[13px] text-ink-soft">
          העבירו מעל נקודה או התמקדו בה כדי לראות שם ועומס
        </p>
      )}
    </div>
  )
}

type DetailSortKey = 'name' | 'load' | 'hard' | 'dayEasy'

function fairnessLabel(status: FairnessGapStatus): {
  text: string
  Icon: typeof CheckCircle2
  tone: string
} {
  if (status === 'good') {
    return {
      text: 'תקין',
      Icon: CheckCircle2,
      tone: 'text-easy bg-easy-soft ring-easy/20',
    }
  }
  if (status === 'attention') {
    return {
      text: 'לשים לב',
      Icon: AlertTriangle,
      tone: 'text-warn bg-warn-soft ring-warn/20',
    }
  }
  return {
    text: 'פער גבוה',
    Icon: AlertTriangle,
    tone: 'text-hard bg-hard-soft ring-hard/20',
  }
}

function HardAfterNightPopover({
  events,
  onClose,
}: {
  events: HardAfterNightEvent[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="פירוט קשה אחרי לילה"
      className="absolute start-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-xl border border-line bg-card shadow-[var(--shadow-panel-hover)] animate-fade-up"
    >
      <div className="border-b border-line px-3 py-2 text-[13px] font-semibold text-ink">
        קשה אחרי לילה
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {events.map((ev) => (
          <li
            key={`${ev.workerId}-${ev.date}-${ev.laneId}`}
            className="flex flex-col gap-0.5 px-3 py-2 text-[13px]"
          >
            <span className="font-semibold text-ink">{ev.fullName}</span>
            <span className="text-ink-soft">
              לילה <Ltr>{formatShiftDate(ev.nightDate)}</Ltr>
              {' → '}
              {SHIFT_TYPE_LABELS[ev.shiftType]}{' '}
              <Ltr>{formatShiftDate(ev.date)}</Ltr>
              {' · '}
              {ev.laneName}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AnalyticsPage() {
  const { data, setView, loading, error, refreshFromServer, refreshing } =
    useApp()
  const [range, setRange] = useState<RangePresetId>('14')
  const [customFrom, setCustomFrom] = useState(() => daysAgoISO(30))
  const [customTo, setCustomTo] = useState(() => todayISO())
  const [showAllRelief, setShowAllRelief] = useState(false)
  const [showAllRest, setShowAllRest] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailSort, setDetailSort] = useState<DetailSortKey>('load')
  const [detailDir, setDetailDir] = useState<'asc' | 'desc'>('desc')
  const [hardOpen, setHardOpen] = useState(false)
  const [recalcEpoch, setRecalcEpoch] = useState(0)
  const [recalcBusy, setRecalcBusy] = useState(false)

  const activeWorkers = useMemo(
    () =>
      data.workers
        .filter((w) => w.status === 'active' && w.isInspector)
        .slice()
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'he')),
    [data.workers],
  )

  const lanes = useMemo(
    () => data.lanes.slice().sort((a, b) => a.name.localeCompare(b.name, 'he')),
    [data.lanes],
  )

  const { fromDate, toDate } = useMemo(() => {
    if (range === '7') return { fromDate: daysAgoISO(7), toDate: todayISO() }
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

  const analytics = useMemo(
    () =>
      computeTeamAnalytics(activeWorkers, lanes, data.history, {
        fromDate,
        toDate,
      }),
    [activeWorkers, lanes, data.history, fromDate, toDate, recalcEpoch],
  )

  const shortReturnQuality = useMemo(
    () =>
      computeShortReturnRate(data.history, activeWorkers, lanes, {
        fromDate,
        toDate,
      }),
    [data.history, activeWorkers, lanes, fromDate, toDate, recalcEpoch],
  )

  const laneRepeats = useMemo(
    () => filterLaneRepeats(analytics.lanes),
    [analytics.lanes],
  )

  const gapStatus = fairnessGapStatus(analytics.loadGap)
  const gapMeta = fairnessLabel(gapStatus)

  const reliefList = showAllRelief
    ? analytics.needRelief
    : analytics.needRelief.slice(0, 5)
  const restList = showAllRest
    ? analytics.gotRest
    : analytics.gotRest.slice(0, 5)

  const detailRows = useMemo(() => {
    const rows = [...analytics.workers]
    rows.sort((a, b) => {
      let cmp = 0
      if (detailSort === 'name') cmp = a.fullName.localeCompare(b.fullName, 'he')
      else if (detailSort === 'load') cmp = a.effectiveLoad - b.effectiveLoad
      else if (detailSort === 'hard') cmp = a.hardCount - b.hardCount
      else cmp = a.dayEasyCount - b.dayEasyCount
      return detailDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [analytics.workers, detailSort, detailDir])

  const selectPreset = (id: RangePresetId) => {
    setRange(id)
    if (id === 'custom') {
      setCustomFrom(daysAgoISO(30))
      setCustomTo(todayISO())
    }
  }

  const toggleDetailSort = (key: DetailSortKey) => {
    if (detailSort === key) {
      setDetailDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setDetailSort(key)
      setDetailDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const shiftMixSubtitle = [
    `${analytics.shiftMix.morning} בוקר`,
    `${analytics.shiftMix.afternoon} צהריים`,
    `${analytics.shiftMix.night} לילה`,
  ].join(' · ')

  const emptyHistory = data.history.length === 0
  const emptyRange = !emptyHistory && analytics.workersWithData === 0

  const handleExport = () => {
    downloadAnalyticsExcel(analytics, {
      fromDate,
      toDate,
      shortReturn: shortReturnQuality,
    })
    notify.success('קובץ האנליזה יוצא')
  }

  const handleRecalcLoads = useCallback(async () => {
    if (recalcBusy) return
    setRecalcBusy(true)
    try {
      await refreshFromServer()
      setRecalcEpoch((n) => n + 1)
      notify.success('העומסים חושבו מחדש לפי ההיסטוריה העדכנית')
    } finally {
      setRecalcBusy(false)
    }
  }, [recalcBusy, refreshFromServer])

  const recalcDisabled = loading || recalcBusy || refreshing

  return (
    <div className="analytics-print-root space-y-4">
      <SectionCard
        title="סטטיסטיקות ואנליזה"
        subtitle="תובנות הוגנות לפי עומס אפקטיבי — מנוחה / קל־יום מורידים עומס · קל לילה לא נספר כמנוחה"
        actions={
          <div className="flex flex-wrap items-center gap-1.5 no-print">
            <button
              type="button"
              onClick={() => void handleRecalcLoads()}
              disabled={recalcDisabled}
              title="רענון מהשרת וחישוב עומסים מחדש (כולל מנוחה וקל־יום)"
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] font-semibold text-ink transition hover:border-brand/40 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {recalcBusy || refreshing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden />
              )}
              חשב עומסים מחדש
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={emptyHistory || emptyRange || loading}
              title={
                emptyHistory || emptyRange
                  ? 'אין נתונים לייצוא בטווח'
                  : 'ייצוא הסטטיסטיקות של הטווח לאקסל (CSV)'
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-brand-deep disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Download className="size-3.5" aria-hidden />
              ייצוא לאקסל
            </button>
            <button
              type="button"
              onClick={() => setView('tracking')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] font-semibold text-ink transition hover:border-brand/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Table2 className="size-3.5" aria-hidden />
              פתיחה במעקב נתיבים
            </button>
          </div>
        }
      >
        <div className="mb-4">
          <RangeBar
            value={range}
            onChange={selectPreset}
            presets={ANALYTICS_PRESETS}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
            shiftsInRange={analytics.shiftsInRange}
            fromDate={fromDate}
            toDate={toDate}
          />
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <p className="rounded-xl border border-hard/30 bg-hard-soft px-3 py-3 text-[13px] text-hard" role="alert">
            שגיאה בטעינת הנתונים: {error}
          </p>
        ) : emptyHistory || emptyRange ? (
          <div className="ui-empty">
            <p className="ui-empty-title">אין שיבוצים שמורים בטווח שנבחר</p>
            <p className="ui-empty-text">
              אחרי שמירת משמרות יופיעו כאן התובנות לטווח זה.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <div className="rounded-xl border border-line bg-surface/80 px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1 text-ink-soft">
                <span className="text-[13px] font-medium">משמרות בטווח</span>
                <InfoTip label="הסבר משמרות בטווח">
                  מספר שיבוצים שמורים בטווח התאריכים שנבחר (כל סוג משמרת נספר
                  בנפרד).
                </InfoTip>
              </div>
              <p className="font-display text-xl font-bold tabular-nums text-brand-deep sm:text-2xl">
                <Ltr>{String(analytics.shiftsInRange)}</Ltr>
              </p>
              <p className="mt-1 text-[13px] text-ink-soft">{shiftMixSubtitle}</p>
            </div>

            <div className="rounded-xl border border-line bg-surface/80 px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1 text-ink-soft">
                <span className="text-[13px] font-medium">עומס ממוצע</span>
                <InfoTip label="הסבר עומס ממוצע">
                  ממוצע העומס האפקטיבי בין בודקים עם לפחות שיבוץ אחד בטווח.
                  יום ללא עבודה מוריד עומס (×0.75); עמדה קלה ביום מוסיפה פחות
                  ומורידה קצת מהמצטבר; יום שכולו קל מוריד עוד (×0.9). בודקים
                  ללא היסטוריה בטווח לא נכללים.
                </InfoTip>
              </div>
              <p className="font-display text-xl font-bold tabular-nums text-brand-deep sm:text-2xl">
                <Ltr>{formatLoadOneDecimal(analytics.avgLoad)}</Ltr>
              </p>
              <p className="mt-1 text-[13px] text-ink-soft">נקודות עומס</p>
            </div>

            <div className="rounded-xl border border-line bg-surface/80 px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1 text-ink-soft">
                <span className="text-[13px] font-medium">פער הוגנות</span>
                <InfoTip label="הסבר פער הוגנות">
                  העומס הגבוה ביותר פחות העומס הנמוך ביותר בקרב בודקים עם שיבוצים
                  בטווח. סף תצוגה (הנחה): תקין מתחת ל־3, לשים לב מ־3, פער גבוה
                  מ־6.
                </InfoTip>
              </div>
              <p className="font-display text-xl font-bold tabular-nums text-brand-deep sm:text-2xl">
                <Ltr>{formatLoadOneDecimal(analytics.loadGap)}</Ltr>
              </p>
              <span
                className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold ring-1 ${gapMeta.tone}`}
              >
                <gapMeta.Icon className="size-3.5" aria-hidden />
                {gapMeta.text}
              </span>
            </div>

            <div className="relative rounded-xl border border-line bg-surface/80 px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1 text-ink-soft">
                <Moon className="size-3.5" aria-hidden />
                <span className="text-[13px] font-medium">קשה אחרי לילה</span>
                <InfoTip label="הסבר קשה אחרי לילה">
                  לילה בתאריך מסוים (21:30 עד 06:00 למחרת) ואז שיבוץ לנתיב
                  קשה ביום למחרת — למשל לילה ב־19.9 ואז צהריים קשה ב־20.9. לא
                  נספר יום לפני הלילה, ולא לילה ואז קשה אחרי כמה ימים.
                </InfoTip>
              </div>
              {analytics.hardAfterNightTotal > 0 ? (
                <button
                  type="button"
                  onClick={() => setHardOpen((o) => !o)}
                  className="w-full text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  aria-expanded={hardOpen}
                >
                  <p className="font-display text-xl font-bold tabular-nums text-hard sm:text-2xl">
                    <Ltr>{String(analytics.hardAfterNightTotal)}</Ltr>
                  </p>
                  <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-hard-soft px-1.5 py-0.5 text-[12px] font-semibold text-hard ring-1 ring-hard/20">
                    <AlertTriangle className="size-3.5" aria-hidden />
                    חריגות — לחצו לפירוט
                  </span>
                </button>
              ) : (
                <>
                  <p className="font-display text-xl font-bold tabular-nums text-easy sm:text-2xl">
                    <Ltr>0</Ltr>
                  </p>
                  <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-easy-soft px-1.5 py-0.5 text-[12px] font-semibold text-easy ring-1 ring-easy/20">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    אין חריגות
                  </span>
                </>
              )}
              {hardOpen && analytics.hardAfterNightEvents.length > 0 ? (
                <HardAfterNightPopover
                  events={analytics.hardAfterNightEvents}
                  onClose={() => setHardOpen(false)}
                />
              ) : null}
            </div>
          </div>
        )}
        {!loading && !error && !emptyHistory && !emptyRange ? (
          <p className="mt-3 rounded-xl border border-line bg-surface/60 px-3 py-2 text-[12px] text-ink-soft sm:text-[13px]">
            חזרה קצרה לאותו נתיב (≤{shortReturnQuality.maxDays} ימים, בלי
            לילות):{' '}
            <span className="font-semibold tabular-nums text-ink">
              <Ltr>
                {String(shortReturnQuality.shortReturnPlacements)}/
                {String(shortReturnQuality.totalDayPlacements)}
              </Ltr>
            </span>
            {shortReturnQuality.totalDayPlacements > 0 ? (
              <>
                {' '}
                ·{' '}
                <span className="font-semibold tabular-nums text-ink">
                  <Ltr>
                    {`${Math.round(shortReturnQuality.rate * 100)}%`}
                  </Ltr>
                </span>
              </>
            ) : null}
          </p>
        ) : null}
      </SectionCard>

      {!loading && !error && analytics.workersWithData > 0 ? (
        <>
          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            <SectionCard
              title="מי צריך הקלה"
              subtitle={
                <span className="inline-flex flex-wrap items-center gap-1">
                  עומס גבוה יחסית — צריך הקלה
                  <InfoTip label="מקרא הקלה">
                    דירוג לפי ציון הקלה: עומס×2 + קשה − קל־יום×1.5. העמודה
                    מציגה את העומס האפקטיבי.
                  </InfoTip>
                </span>
              }
            >
              <WorkerRankList
                rows={reliefList}
                avgLoad={analytics.avgLoad}
                maxLoad={analytics.maxLoad}
                tone="hard"
                onOpenTracking={() => setView('tracking')}
              />
              {analytics.needRelief.length > 5 ? (
                <button
                  type="button"
                  className="mt-2 text-[13px] font-semibold text-brand underline-offset-2 hover:underline no-print"
                  onClick={() => setShowAllRelief((v) => !v)}
                >
                  {showAllRelief ? 'הצג פחות' : 'הצג הכל'}
                </button>
              ) : null}
            </SectionCard>

            <SectionCard
              title="מי קיבל יותר מנוחה"
              subtitle={
                <span className="inline-flex flex-wrap items-center gap-1">
                  עומס נמוך יחסית · ללא בודקים בלי שיבוצים בטווח
                  <InfoTip label="מקרא מנוחה">
                    אותם בודקים עם שיבוצים בטווח, מהציון הנמוך לגבוה.
                  </InfoTip>
                </span>
              }
            >
              <WorkerRankList
                rows={restList}
                avgLoad={analytics.avgLoad}
                maxLoad={analytics.maxLoad}
                tone="easy"
                onOpenTracking={() => setView('tracking')}
              />
              {analytics.gotRest.length > 5 ? (
                <button
                  type="button"
                  className="mt-2 text-[13px] font-semibold text-brand underline-offset-2 hover:underline no-print"
                  onClick={() => setShowAllRest((v) => !v)}
                >
                  {showAllRest ? 'הצג פחות' : 'הצג הכל'}
                </button>
              ) : null}
            </SectionCard>
          </div>

          <SectionCard
            title="התפלגות עומס"
            subtitle="נקודה = בודק · קו כתום = ממוצע הצוות"
          >
            <LoadOverview
              workers={analytics.workers}
              avgLoad={analytics.avgLoad}
            />
            {analytics.workersWithoutData > 0 ? (
              <p className="mt-2 text-[13px] text-ink-soft">
                {pluralizeHe(analytics.workersWithoutData, {
                  one: 'בודק אחד ללא נתונים בטווח',
                  two: 'שני בודקים ללא נתונים בטווח',
                  many: 'בודקים ללא נתונים בטווח',
                })}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
              <button
                type="button"
                onClick={() => setDetailOpen((o) => !o)}
                aria-expanded={detailOpen}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold text-ink transition hover:border-brand/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <ChevronDown
                  className={`size-4 transition ${detailOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
                {detailOpen ? 'הסתר פירוט' : 'פירוט לכל הבודקים'}
              </button>
              <button
                type="button"
                onClick={() => setView('tracking')}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <Table2 className="size-3.5" aria-hidden />
                מעקב נתיבים
              </button>
            </div>

            {detailOpen ? (
              <div className="mt-3 max-h-[min(50vh,28rem)] overflow-auto rounded-xl border border-line">
                <table className="min-w-full border-collapse text-end text-[13px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-brand-deep text-white">
                      {(
                        [
                          { key: 'name' as const, label: 'בודק' },
                          { key: 'load' as const, label: 'עומס' },
                          { key: 'hard' as const, label: 'קשה' },
                          { key: 'dayEasy' as const, label: 'קל יום' },
                        ] as const
                      ).map((col) => (
                        <th
                          key={col.key}
                          scope="col"
                          aria-sort={
                            detailSort === col.key
                              ? detailDir === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                          }
                          className={`px-2 py-2 font-semibold ${
                            col.key === 'name'
                              ? 'sticky start-0 bg-brand-deep'
                              : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleDetailSort(col.key)}
                            className="inline-flex items-center gap-1 rounded px-1 hover:bg-white/10"
                          >
                            {col.label}
                          </button>
                        </th>
                      ))}
                      <th className="px-2 py-2 font-semibold">משמרות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((w, i) => {
                      const rowBg = i % 2 === 0 ? 'bg-card' : 'bg-surface'
                      const dev = loadDeviationFromMean(
                        w.effectiveLoad,
                        analytics.avgLoad,
                      )
                      return (
                        <tr key={w.workerId} className={rowBg}>
                          <td
                            className={`sticky start-0 border-b border-line px-2 py-2 font-semibold ${rowBg}`}
                          >
                            {w.fullName}
                          </td>
                          <td className="border-b border-line px-2 py-2">
                            <MeanLoadBar
                              value={w.effectiveLoad}
                              max={analytics.maxLoad}
                              mean={analytics.avgLoad}
                              deviation={dev}
                            />
                          </td>
                          <td className="border-b border-line px-2 py-2 text-center tabular-nums">
                            <Ltr>{String(w.hardCount)}</Ltr>
                          </td>
                          <td className="border-b border-line px-2 py-2 text-center tabular-nums">
                            <Ltr>{String(w.dayEasyCount)}</Ltr>
                          </td>
                          <td className="border-b border-line px-2 py-2">
                            <div className="flex justify-center">
                              <ShiftMiniStack byType={w.shiftsByType} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            title="חזרות לאותו נתיב"
            subtitle="נתיבים שבהם אותו בודק חוזר — סימן לחוסר פיזור"
          >
            {laneRepeats.length === 0 ? (
              <div className="ui-empty">
                <p className="ui-empty-title">אין חזרות לאותו נתיב בטווח</p>
                <p className="ui-empty-text">
                  אף בודק לא חזר לאותו נתיב פעמיים או יותר בטווח שנבחר.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {laneRepeats.map((lane) => (
                  <li key={lane.laneId}>
                    <button
                      type="button"
                      onClick={() => setView('tracking')}
                      className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-start transition hover:border-brand/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      title={`${Math.round(lane.concentration * 100)}% מהביקורים בנתיב`}
                    >
                      <div className="flex items-center gap-2">
                        <IntensityBadge intensity={lane.intensity} />
                        <div>
                          <p className="text-sm font-bold text-ink">
                            {lane.laneName}
                          </p>
                          <p className="text-[13px] text-ink-soft">
                            {lane.topWorkerName}
                          </p>
                        </div>
                      </div>
                      <p className="text-[13px] font-semibold text-ink">
                        <Ltr>{String(lane.topWorkerCount)}</Ltr>
                        {' מתוך '}
                        <Ltr>{String(lane.totalAssignments)}</Ltr>
                        {' ביקורים'}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  )
}

function WorkerRankList({
  rows,
  avgLoad,
  maxLoad,
  tone,
  onOpenTracking,
}: {
  rows: WorkerAnalyticsRow[]
  avgLoad: number
  maxLoad: number
  tone: 'hard' | 'easy'
  onOpenTracking: () => void
}) {
  const badge =
    tone === 'hard' ? 'bg-hard-soft text-hard' : 'bg-easy-soft text-easy'
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((w, i) => {
        const per = loadPerShift(w.effectiveLoad, w.shiftsCount)
        const dev = loadDeviationFromMean(w.effectiveLoad, avgLoad)
        return (
          <li
            key={w.workerId}
            className="rounded-xl border border-line bg-surface px-3 py-2"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${badge}`}
              >
                {i + 1}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                {w.fullName}
              </p>
              {per != null ? (
                <span className="shrink-0 text-[12px] text-ink-soft">
                  למשמרת <Ltr>{formatLoadOneDecimal(per)}</Ltr>
                </span>
              ) : null}
            </div>
            <MeanLoadBar
              value={w.effectiveLoad}
              max={maxLoad}
              mean={avgLoad}
              deviation={dev}
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-soft">
              <span>
                <Ltr>{String(w.shiftsCount)}</Ltr> משמרות
              </span>
              <span aria-hidden>·</span>
              <span>
                קשה <Ltr>{String(w.hardCount)}</Ltr>
              </span>
              <span aria-hidden>·</span>
              <span>
                קל יום <Ltr>{String(w.dayEasyCount)}</Ltr>
              </span>
              {w.topLaneName && w.topLaneCount >= 2 ? (
                <button
                  type="button"
                  onClick={onOpenTracking}
                  className="ms-auto inline-flex max-w-full items-center gap-1 rounded-md bg-card px-1.5 py-0.5 text-[12px] font-semibold text-ink ring-1 ring-line transition hover:ring-brand/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <Table2 className="size-3 shrink-0 text-brand" aria-hidden />
                  <span className="truncate">
                    {w.topLaneName} ×<Ltr>{String(w.topLaneCount)}</Ltr>
                  </span>
                </button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
