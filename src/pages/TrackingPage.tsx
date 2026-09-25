import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Download,
  Info,
  MinusCircle,
  Search,
  X,
} from 'lucide-react'
import { computeWorkerLaneStats } from '../algorithm'
import type { WorkerLaneStats } from '../algorithm'
import { Ltr, SectionCard } from '../components/ui'
import { RangeBar, type RangePresetId } from '../components/RangeBar'
import { INTENSITY_LABELS, SHIFT_TYPE_LABELS } from '../constants'
import { useApp } from '../context/AppContext'
import { formatShiftDate } from '../lib/hebrew'
import { downloadTrackingExcel } from '../lib/trackingExport'
import {
  compareTrackingRows,
  filterLanesByIntensity,
  formatLoadOneDecimal,
  formatVisitRecency,
  heatCellClass,
  heatLevel,
  inclusiveRangeDays,
  listWorkerLaneVisits,
  maxLaneCount,
  teamAverageLoad,
  workerMatchesSearch,
  type HeatLevel,
  type LaneVisit,
  type SortDir,
  type TrackingSortKey,
} from '../lib/trackingHeatmap'
import type { Intensity } from '../types'

type IntensityFilter = Intensity | 'all'

const TRACKING_PRESETS = ['14', '30', 'all', 'custom'] as const

interface CellKey {
  workerId: string
  laneId: string
}

function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function CountCell({ value }: { value: number }) {
  if (value <= 0) {
    return (
      <>
        <span className="text-line" aria-hidden>
          ·
        </span>
        <span className="sr-only">0</span>
      </>
    )
  }
  return <Ltr>{String(value)}</Ltr>
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return <ArrowUpDown className="size-3 opacity-40" aria-hidden />
  }
  return dir === 'asc' ? (
    <ArrowUp className="size-3" aria-hidden />
  ) : (
    <ArrowDown className="size-3" aria-hidden />
  )
}

function SortButton({
  label,
  active,
  dir,
  onClick,
  icon,
  center,
  compact,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  icon?: React.ReactNode
  center?: boolean
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`inline-flex max-w-full items-center gap-0.5 rounded px-0.5 py-0.5 transition hover:bg-white/10 ${
        center ? 'justify-center' : ''
      } ${compact ? 'text-[10px] leading-tight' : ''}`}
    >
      {icon}
      <span className={compact ? 'truncate' : ''}>{label}</span>
      <SortIcon active={active} dir={dir} />
    </button>
  )
}

function LoadBar({
  value,
  max,
  average,
}: {
  value: number
  max: number
  average: number
}) {
  const span = Math.max(max, average, 1)
  const pct = Math.min(100, (value / span) * 100)
  const avgPct = Math.min(100, (average / span) * 100)
  return (
    <div className="inline-flex items-center justify-center gap-1">
      <div
        className="relative h-1 w-8 overflow-hidden rounded-full bg-surface ring-1 ring-line/80"
        role="img"
        aria-label={`עומס ${formatLoadOneDecimal(value)}, ממוצע צוות ${formatLoadOneDecimal(average)}`}
      >
        <div
          className="absolute inset-y-0 start-0 rounded-full bg-brand/70"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-accent"
          style={{ insetInlineStart: `${avgPct}%` }}
          title="ממוצע צוות"
        />
      </div>
      <Ltr className="text-[10px] font-medium text-ink">
        {formatLoadOneDecimal(value)}
      </Ltr>
    </div>
  )
}

function IntensityMark({ intensity }: { intensity: Intensity }) {
  const Icon =
    intensity === 'hard'
      ? AlertTriangle
      : intensity === 'medium'
        ? MinusCircle
        : CheckCircle2
  const tone =
    intensity === 'hard'
      ? 'bg-hard-soft text-hard ring-hard/25'
      : intensity === 'medium'
        ? 'bg-mid-soft text-mid ring-mid/25'
        : 'bg-easy-soft text-easy ring-easy/25'
  return (
    <span
      className={`inline-flex max-w-full items-center gap-0.5 rounded px-1 py-px text-[9px] font-semibold leading-tight ring-1 ${tone}`}
      title={INTENSITY_LABELS[intensity]}
    >
      <Icon className="size-2.5 shrink-0" aria-hidden />
      <span className="truncate">{INTENSITY_LABELS[intensity]}</span>
    </span>
  )
}

function HeatLegend() {
  const levels: { level: HeatLevel; label: string }[] = [
    { level: 1, label: 'מעט' },
    { level: 2, label: 'בינוני' },
    { level: 3, label: 'הרבה' },
    { level: 4, label: 'ריכוז' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-soft sm:text-xs">
      <span className="font-medium text-ink">מפת חום</span>
      <span aria-hidden>פחות</span>
      <div
        className="flex items-center gap-1"
        role="list"
        aria-label="סולם ביקורים בנתיב"
      >
        {levels.map(({ level, label }) => (
          <span
            key={level}
            role="listitem"
            className={`inline-flex size-5 items-center justify-center rounded-md text-[10px] font-semibold ring-1 ring-line/70 ${heatCellClass(level)}`}
            title={label}
          >
            {level}
          </span>
        ))}
      </div>
      <span aria-hidden>יותר ביקורים בנתיב</span>
      <span className="text-ink-soft/90">
        · חזרות לאותו נתיב = פחות רוטציה
      </span>
    </div>
  )
}

function DayEasyTip() {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="rounded-full p-0.5 text-white/80 transition hover:bg-white/10 hover:text-white"
        aria-label="הסבר על קל יום"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute end-0 top-full z-[70] mt-1.5 hidden w-56 rounded-lg border border-line bg-card px-2.5 py-2 text-start text-[11px] font-normal leading-relaxed text-ink shadow-[var(--shadow-panel-hover)] group-focus-within:block group-hover:block"
      >
        קל יום = מנוחה אמיתית (בוקר/צהריים) — מוסיף פחות לעומס ומוריד קצת
        מהמצטבר. יום שכולו קל מוריד עוד (×0.9). יום ללא עבודה מוריד חזק יותר
        (×0.75). קל בלילה לא נספר כמנוחה ונכנס לעומס כמו בינוני.
      </span>
    </span>
  )
}

function VisitPopover({
  workerName,
  laneName,
  visits,
  onClose,
}: {
  workerName: string
  laneName: string
  visits: LaneVisit[]
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
      aria-label={`ביקורים של ${workerName} ב${laneName}`}
      className="absolute z-[80] mt-1 w-64 overflow-hidden rounded-xl border border-line/80 bg-card shadow-[var(--shadow-panel-hover)] animate-fade-up"
    >
      <div className="flex items-start justify-between gap-2 border-b border-line/70 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink">{workerName}</p>
          <p className="truncate text-[11px] text-ink-soft">{laneName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-ink-soft hover:bg-surface hover:text-ink"
          aria-label="סגור"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {visits.length === 0 ? (
        <p className="px-3 py-3 text-xs text-ink-soft">אין ביקורים בטווח</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto py-1">
          {visits.map((v) => (
            <li
              key={`${v.date}-${v.shiftType}`}
              className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]"
            >
              <span className="font-medium text-ink">
                <Ltr>{formatShiftDate(v.date)}</Ltr>
                <span className="mx-1 text-ink-soft">·</span>
                {SHIFT_TYPE_LABELS[v.shiftType]}
              </span>
              <span className="shrink-0 text-ink-soft">
                {formatVisitRecency(v.daysAgo)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function TrackingPage() {
  const { data } = useApp()
  const [range, setRange] = useState<RangePresetId>('all')
  const [customFrom, setCustomFrom] = useState(() => daysAgoISO(30))
  const [customTo, setCustomTo] = useState(() => todayISO())
  const [search, setSearch] = useState('')
  const [intensityFilter, setIntensityFilter] =
    useState<IntensityFilter>('all')
  const [sortKey, setSortKey] = useState<TrackingSortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [hoverRow, setHoverRow] = useState<string | null>(null)
  const [hoverCol, setHoverCol] = useState<string | null>(null)
  const [openCell, setOpenCell] = useState<CellKey | null>(null)

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

  const visibleLanes = useMemo(
    () => filterLanesByIntensity(lanes, intensityFilter),
    [lanes, intensityFilter],
  )

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

  const rangeDays = useMemo(
    () => inclusiveRangeDays(fromDate, toDate),
    [fromDate, toDate],
  )

  const stats = useMemo(
    () =>
      computeWorkerLaneStats(activeWorkers, lanes, data.history, {
        fromDate,
        toDate,
      }),
    [activeWorkers, lanes, data.history, fromDate, toDate],
  )

  const statsByWorker = useMemo(() => {
    const map = new Map<string, WorkerLaneStats>(
      stats.map((s) => [s.workerId, s]),
    )
    return map
  }, [stats])

  const filteredWorkers = useMemo(() => {
    const matched = activeWorkers.filter((w) =>
      workerMatchesSearch(w.fullName, search),
    )
    return matched
      .slice()
      .sort((a, b) =>
        compareTrackingRows(a, b, sortKey, sortDir, statsByWorker),
      )
  }, [activeWorkers, search, sortKey, sortDir, statsByWorker])

  const shiftsInRange = useMemo(() => {
    return data.history.filter((h) => {
      if (fromDate && h.date < fromDate) return false
      if (toDate && h.date > toDate) return false
      return true
    }).length
  }, [data.history, fromDate, toDate])

  const maxCell = useMemo(() => maxLaneCount(stats), [stats])
  const avgLoad = useMemo(() => teamAverageLoad(stats), [stats])
  const maxLoad = useMemo(
    () => Math.max(...stats.map((s) => s.effectiveLoad), avgLoad, 1),
    [stats, avgLoad],
  )

  const openVisits = useMemo(() => {
    if (!openCell) return [] as LaneVisit[]
    return listWorkerLaneVisits(
      data.history,
      openCell.workerId,
      openCell.laneId,
      { fromDate, toDate },
    )
  }, [openCell, data.history, fromDate, toDate])

  const openWorker = openCell
    ? activeWorkers.find((w) => w.id === openCell.workerId)
    : undefined
  const openLane = openCell
    ? lanes.find((l) => l.id === openCell.laneId)
    : undefined

  const handleExport = () => {
    downloadTrackingExcel(activeWorkers, lanes, statsByWorker, {
      fromDate,
      toDate,
    })
  }

  const selectPreset = (id: RangePresetId) => {
    setRange(id)
    if (id === 'custom') {
      setCustomFrom(daysAgoISO(30))
      setCustomTo(todayISO())
    }
  }

  const toggleSort = (key: TrackingSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const ariaSortFor = (
    key: TrackingSortKey,
  ): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none'
    return sortDir === 'asc' ? 'ascending' : 'descending'
  }

  const cellHeat = (n: number) =>
    heatCellClass(heatLevel(n, { maxInData: maxCell, rangeDays }))

  const isCross = (workerId: string, colId: string) =>
    hoverRow === workerId || hoverCol === colId

  return (
    <div className="space-y-4">
      <SectionCard
        title="מעקב נתיבים"
        subtitle="כמה פעמים כל בודק שובץ בכל עמדה — לפי היסטוריית השיבוצים השמורים"
        actions={
          <button
            type="button"
            onClick={handleExport}
            disabled={activeWorkers.length === 0 || lanes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-deep disabled:opacity-40 sm:text-sm"
          >
            <Download className="size-3.5 sm:size-4" />
            ייצוא לאקסל
          </button>
        }
      >
        <div className="mb-4 flex flex-col gap-3">
          <RangeBar
            value={range}
            onChange={selectPreset}
            presets={TRACKING_PRESETS}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
            shiftsInRange={shiftsInRange}
            fromDate={fromDate}
            toDate={toDate}
          />

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
              className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-surface p-1 text-xs"
              role="group"
              aria-label="סינון לפי עצימות נתיב"
            >
              {(
                [
                  { id: 'all' as const, label: 'הכל' },
                  { id: 'easy' as const, label: 'קל' },
                  { id: 'medium' as const, label: 'בינוני' },
                  { id: 'hard' as const, label: 'קשה' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setIntensityFilter(opt.id)}
                  className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
                    intensityFilter === opt.id
                      ? 'bg-brand text-white shadow-sm'
                      : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {data.history.length === 0 ? (
          <div className="ui-empty">
            <p className="ui-empty-title">אין שיבוצים שמורים</p>
            <p className="ui-empty-text">
              אחרי שמירת משמרות תופיע כאן טבלת המעקב.
            </p>
          </div>
        ) : activeWorkers.length === 0 || lanes.length === 0 ? (
          <div className="ui-empty">
            <p className="ui-empty-title">אין מספיק נתונים להצגה</p>
            <p className="ui-empty-text">חסרים בודקים פעילים או נתיבים.</p>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <HeatLegend />
            </div>

            <ul className="space-y-2 lg:hidden">
              {filteredWorkers.map((w) => {
                const s = statsByWorker.get(w.id)!
                const topLanes = visibleLanes
                  .map((lane) => ({
                    lane,
                    n: s.byLane[lane.id] ?? 0,
                  }))
                  .filter((x) => x.n > 0)
                  .sort((a, b) => b.n - a.n)
                  .slice(0, 3)
                return (
                  <li
                    key={w.id}
                    className="rounded-xl border border-line bg-surface px-3 py-2.5"
                  >
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <p className="text-sm font-bold text-ink">{w.fullName}</p>
                      <p className="text-xs font-bold tabular-nums text-ink">
                        <Ltr>{String(s.totalAssignments || 0)}</Ltr> סה״כ
                      </p>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
                      <span className="inline-flex items-center gap-1 rounded-md bg-hard-soft px-1.5 py-0.5 font-semibold text-ink ring-1 ring-hard/15">
                        <AlertTriangle
                          className="size-3 text-hard"
                          aria-hidden
                        />
                        קשה <Ltr>{String(s.hardCount || 0)}</Ltr>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-mid-soft px-1.5 py-0.5 font-semibold text-ink ring-1 ring-mid/15">
                        <MinusCircle className="size-3 text-mid" aria-hidden />
                        בינוני <Ltr>{String(s.mediumCount || 0)}</Ltr>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-easy-soft px-1.5 py-0.5 font-semibold text-ink ring-1 ring-easy/15">
                        <CheckCircle2 className="size-3 text-easy" aria-hidden />
                        קל יום <Ltr>{String(s.dayEasyCount || 0)}</Ltr>
                      </span>
                      <span className="rounded-md bg-card px-1.5 py-0.5 font-semibold text-ink ring-1 ring-line">
                        עומס <Ltr>{formatLoadOneDecimal(s.effectiveLoad)}</Ltr>
                      </span>
                    </div>
                    {topLanes.length > 0 ? (
                      <ul className="space-y-1 text-[11px] text-ink-soft">
                        {topLanes.map(({ lane, n }) => (
                          <li
                            key={lane.id}
                            className="flex justify-between gap-2"
                          >
                            <span>{lane.name}</span>
                            <Ltr className="font-semibold text-ink">
                              {String(n)}
                            </Ltr>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-ink-soft">
                        אין שיבוצים בטווח
                      </p>
                    )}
                  </li>
                )
              })}
              {filteredWorkers.length === 0 && (
                <li className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-ink-soft">
                  אין בודקים שתואמים לחיפוש
                </li>
              )}
            </ul>

            <div className="tracking-scroll relative hidden rounded-xl border border-line lg:block">
              <table className="tracking-matrix text-end text-[12px]">
                <thead className="sticky top-0 z-20">
                  <tr className="tracking-sticky-head bg-brand-deep text-white">
                    <th
                      scope="col"
                      aria-sort={ariaSortFor('name')}
                      className="tracking-sticky-name px-2.5 py-2 text-end font-semibold"
                    >
                      <SortButton
                        label="בודק"
                        active={sortKey === 'name'}
                        dir={sortDir}
                        onClick={() => toggleSort('name')}
                      />
                    </th>
                    {visibleLanes.map((lane) => {
                      const key: TrackingSortKey = `lane:${lane.id}`
                      return (
                        <th
                          key={lane.id}
                          scope="col"
                          aria-sort={ariaSortFor(key)}
                          className={`tracking-lane-col py-2 font-medium ${
                            hoverCol === lane.id ? 'tracking-crosshair' : ''
                          }`}
                          onMouseEnter={() => setHoverCol(lane.id)}
                          onMouseLeave={() => setHoverCol(null)}
                        >
                          <div className="mx-auto flex flex-col items-center gap-1">
                            <SortButton
                              label={lane.name}
                              active={sortKey === key}
                              dir={sortDir}
                              onClick={() => toggleSort(key)}
                              center
                            />
                            <IntensityMark intensity={lane.intensity} />
                          </div>
                        </th>
                      )
                    })}
                    <th
                      scope="col"
                      aria-sort={ariaSortFor('hard')}
                      className="tracking-sum-col border-s border-white/20 bg-brand-deep py-2 font-semibold"
                    >
                      <SortButton
                        label="קשה"
                        active={sortKey === 'hard'}
                        dir={sortDir}
                        onClick={() => toggleSort('hard')}
                        icon={
                          <AlertTriangle
                            className="size-3 text-hard-soft"
                            aria-hidden
                          />
                        }
                      />
                    </th>
                    <th
                      scope="col"
                      aria-sort={ariaSortFor('medium')}
                      className="tracking-sum-col bg-brand-deep py-2 font-semibold"
                    >
                      <SortButton
                        label="בינוני"
                        active={sortKey === 'medium'}
                        dir={sortDir}
                        onClick={() => toggleSort('medium')}
                        icon={
                          <MinusCircle
                            className="size-3 text-mid-soft"
                            aria-hidden
                          />
                        }
                      />
                    </th>
                    <th
                      scope="col"
                      aria-sort={ariaSortFor('dayEasy')}
                      className="tracking-sum-col bg-brand-deep py-2 font-semibold"
                    >
                      <span className="inline-flex items-center justify-center gap-1">
                        <SortButton
                          label="קל יום"
                          active={sortKey === 'dayEasy'}
                          dir={sortDir}
                          onClick={() => toggleSort('dayEasy')}
                          icon={
                            <CheckCircle2
                              className="size-3 text-easy-soft"
                              aria-hidden
                            />
                          }
                        />
                        <DayEasyTip />
                      </span>
                    </th>
                    <th
                      scope="col"
                      aria-sort={ariaSortFor('load')}
                      className="tracking-load-col bg-brand-deep py-2 font-semibold"
                    >
                      <SortButton
                        label="עומס"
                        active={sortKey === 'load'}
                        dir={sortDir}
                        onClick={() => toggleSort('load')}
                      />
                    </th>
                    <th
                      scope="col"
                      aria-sort={ariaSortFor('total')}
                      className="tracking-sum-col bg-brand-deep py-2 font-semibold"
                    >
                      <SortButton
                        label="סה״כ"
                        active={sortKey === 'total'}
                        dir={sortDir}
                        onClick={() => toggleSort('total')}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkers.map((w) => {
                    const s = statsByWorker.get(w.id)!
                    const rowHot = hoverRow === w.id
                    return (
                      <tr
                        key={w.id}
                        onMouseEnter={() => setHoverRow(w.id)}
                        onMouseLeave={() => setHoverRow(null)}
                      >
                        <td
                          className={`tracking-sticky-name border-b border-line px-2.5 py-2 font-semibold text-ink ${
                            rowHot ? 'tracking-crosshair' : ''
                          }`}
                          title={w.fullName}
                        >
                          <span className="block truncate">{w.fullName}</span>
                        </td>
                        {visibleLanes.map((lane) => {
                          const n = s.byLane[lane.id] ?? 0
                          const open =
                            openCell?.workerId === w.id &&
                            openCell?.laneId === lane.id
                          return (
                            <td
                              key={lane.id}
                              className={`tracking-lane-col relative border-b border-line py-2 text-center tabular-nums ${cellHeat(n)} ${
                                isCross(w.id, lane.id)
                                  ? 'tracking-crosshair'
                                  : ''
                              }`}
                              onMouseEnter={() => {
                                setHoverRow(w.id)
                                setHoverCol(lane.id)
                              }}
                              onMouseLeave={() => setHoverCol(null)}
                            >
                              <button
                                type="button"
                                className="mx-auto block min-h-7 min-w-7 rounded-md px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                                aria-label={`${w.fullName}, ${lane.name}: ${n}`}
                                onClick={() =>
                                  setOpenCell(
                                    open
                                      ? null
                                      : { workerId: w.id, laneId: lane.id },
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    setOpenCell(
                                      open
                                        ? null
                                        : { workerId: w.id, laneId: lane.id },
                                    )
                                  }
                                }}
                                onFocus={() => {
                                  setHoverRow(w.id)
                                  setHoverCol(lane.id)
                                }}
                              >
                                <CountCell value={n} />
                              </button>
                              {open && openWorker && openLane ? (
                                <VisitPopover
                                  workerName={openWorker.fullName}
                                  laneName={openLane.name}
                                  visits={openVisits}
                                  onClose={() => setOpenCell(null)}
                                />
                              ) : null}
                            </td>
                          )
                        })}
                        <td
                          className={`tracking-sum-col border-b border-s border-line py-2 text-center tabular-nums text-ink ${
                            rowHot ? 'tracking-crosshair' : ''
                          }`}
                        >
                          <CountCell value={s.hardCount} />
                        </td>
                        <td
                          className={`tracking-sum-col border-b border-line py-2 text-center tabular-nums text-ink ${
                            rowHot ? 'tracking-crosshair' : ''
                          }`}
                        >
                          <CountCell value={s.mediumCount} />
                        </td>
                        <td
                          className={`tracking-sum-col border-b border-line py-2 text-center tabular-nums text-ink ${
                            rowHot ? 'tracking-crosshair' : ''
                          }`}
                        >
                          <CountCell value={s.dayEasyCount} />
                        </td>
                        <td
                          className={`tracking-load-col border-b border-line py-2 text-center ${
                            rowHot ? 'tracking-crosshair' : ''
                          }`}
                        >
                          <LoadBar
                            value={s.effectiveLoad}
                            max={maxLoad}
                            average={avgLoad}
                          />
                        </td>
                        <td
                          className={`tracking-sum-col border-b border-line py-2 text-center font-bold tabular-nums text-ink ${
                            rowHot ? 'tracking-crosshair' : ''
                          }`}
                        >
                          <CountCell value={s.totalAssignments} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredWorkers.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-ink-soft">
                  אין בודקים שתואמים לחיפוש
                </p>
              ) : null}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-ink-soft sm:text-xs">
              הייצוא כולל את הטווח הנבחר (CSV לאקסל). לחצו על תא בטבלה לרשימת
              הביקורים.
            </p>
          </>
        )}
      </SectionCard>
    </div>
  )
}
