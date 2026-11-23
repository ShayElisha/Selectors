import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Download,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Users,
  BarChart3,
  AlertTriangle,
  Lock,
  ClipboardPenLine,
  Wrench,
  Map as MapIcon,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  type LucideIcon,
} from 'lucide-react'
import {
  BoardKiosk,
  type BoardKioskHandle,
} from '../components/BoardKiosk'
import { GateMapKiosk } from '../components/GateMapKiosk'
import { audienceForModule, MODULE_LABELS } from '../auth'
import { useApp } from '../context/AppContext'
import {
  formatInspectorShiftWindow,
} from '../lib/inspectorShifts'
import {
  currentShiftModel,
  formatShiftModelWindow,
  resolveShiftModels,
  shiftModelLabel,
} from '../lib/shiftModels'
import { fetchAuditLogs, fetchSystemMessagesRemote, postAuditEvent } from '../api'
import { fetchShiftHandoffs } from '../api'
import type { SystemMessage } from '../api'
import { WorkerNoticeComposer } from '../components/WorkerNoticeComposer'
import { downloadBoardImage, type ExportLaneLine } from '../lib/export'
import {
  daysBetweenLocal,
  computeWorkerLaneStats,
} from '../algorithm'
import {
  formatShiftDate,
  formatShiftWindow,
  pluralizeHe,
} from '../lib/hebrew'
import { notify } from '../lib/notify'
import { formatShiftShare } from '../lib/trackingHeatmap'
import { avatarColor } from '../lib/avatarColor'
import {
  effectiveStaffingStandard,
  shiftHeadcountSnapshot,
} from '../lib/shiftStaffing'
import {
  EmptyState,
  Ltr,
  MetricIconBadge,
  SectionCard,
  Skeleton,
} from '../components/ui'
import type { Intensity, ShiftHandoffNote, ShiftSchedule, View } from '../types'
import { SelectorRoundTable } from '../components/SelectorRoundTable'
import { usesRounds } from '../lib/assignmentMode'
import { selectorLanes } from '../lib/selectorRounds'
import { workerWindowById } from '../lib/shiftCatalog'
import { laneLiveStatus } from '../lib/laneLiveStatus'
import { liveShiftHeadcountSnapshot } from '../lib/workerShiftStatus'
import { pathForView } from '../routes'

/** Optional health snapshot if/when persisted on ShiftSchedule. */
export interface ShiftHealthSnapshot {
  warnings: string[]
  understaffedLaneIds: string[]
}

const lanePlural = {
  one: 'נתיב אחד',
  two: 'שני נתיבים',
  many: 'נתיבים',
} as const

const workerPlural = {
  one: 'בודק אחד',
  two: 'שני בודקים',
  many: 'בודקים',
} as const

const warningPlural = {
  one: 'אזהרה אחת',
  two: 'שתי אזהרות',
  many: 'אזהרות',
} as const

type ShiftTabOption = {
  id: ShiftSchedule['shiftType']
  label: string
  saved: boolean
  hasException: boolean
}

type ShiftExceptionSource = Pick<
  ShiftSchedule,
  'presentWorkerIds' | 'headcountStandard' | 'assignments' | 'rounds'
>

type HomeLanePerson = {
  id: string
  name: string
  trainingRole?: 'trainee' | 'mentor'
  windowLabel: string
}

type HomeLaneRow = {
  laneId: string
  laneName: string
  intensity: Intensity
  staffingStandard: number
  assigned: number
  workers: HomeLanePerson[]
  endedWorkers: { id: string; name: string }[]
  autoClosed: boolean
  manuallyReopened: boolean
}

function hasShiftException(shift: ShiftExceptionSource | undefined): boolean {
  if (!shift) return false
  const headcount = shiftHeadcountSnapshot(shift)
  const assignmentRows = shift.rounds?.length
    ? shift.rounds.flatMap((round) => round.assignments)
    : shift.assignments
  const assigned = new Set(
    assignmentRows.flatMap((row) => row.workerIds.filter(Boolean)),
  )
  const unassignedPresent = shift.presentWorkerIds.some(
    (workerId) => !assigned.has(workerId),
  )
  return Boolean(headcount.tracked && headcount.deficit > 0) || unassignedPresent
}

function DayNavigator({
  date,
  isToday,
  previousDate,
  nextDate,
  onPrevious,
  onNext,
  onToday,
}: {
  date: string
  isToday: boolean
  previousDate?: string
  nextDate?: string
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}) {
  return (
    <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
      <button
        type="button"
        disabled={!previousDate}
        aria-disabled={!previousDate}
        onClick={onPrevious}
        aria-label="מעבר ליום הקודם עם שיבוץ"
        className="ui-btn ui-btn-secondary inline-flex min-w-0 justify-self-start gap-1.5 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight className="size-4 shrink-0" aria-hidden />
        <span className="hidden sm:inline">יום קודם</span>
        <span className="sm:hidden">קודם</span>
      </button>

      <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
        <Ltr className="text-sm font-semibold text-ink">{date}</Ltr>
        {isToday ? (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
            היום
          </span>
        ) : (
          <button
            type="button"
            onClick={onToday}
            className="text-xs font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            חזרה להיום
          </button>
        )}
      </div>

      <button
        type="button"
        disabled={!nextDate}
        aria-disabled={!nextDate}
        onClick={onNext}
        aria-label="מעבר ליום הבא עם שיבוץ"
        className="ui-btn ui-btn-secondary inline-flex min-w-0 justify-self-end gap-1.5 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="hidden sm:inline">יום הבא</span>
        <span className="sm:hidden">הבא</span>
        <ChevronLeft className="size-4 shrink-0" aria-hidden />
      </button>
    </div>
  )
}

function ShiftTabs({
  options,
  selectedId,
  onSelect,
}: {
  options: ShiftTabOption[]
  selectedId: ShiftSchedule['shiftType']
  onSelect: (id: ShiftSchedule['shiftType']) => void
}) {
  return (
    <div
      className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-line bg-surface p-1"
      role="group"
      aria-label="בחירת משמרת ליום"
    >
      {options.map((option) => {
        const selected = selectedId === option.id
        const accessibleLabel = [
          option.label,
          option.saved ? '' : 'אין שיבוץ שמור',
          option.hasException ? 'יש חוסר בכוח אדם או בודקים לא משובצים' : '',
        ].filter(Boolean).join(' · ')
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            aria-label={accessibleLabel}
            title={accessibleLabel}
            onClick={() => onSelect(option.id)}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              selected
                ? 'bg-brand text-white shadow-sm'
                : 'text-ink-soft hover:bg-card hover:text-ink'
            }`}
          >
            {option.hasException ? (
              <span
                role="img"
                aria-label="חריגה בשיבוץ"
                className="size-2 shrink-0 rounded-full bg-warn ring-2 ring-warn-soft"
              />
            ) : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function DifficultyBadge({ intensity }: { intensity: Intensity }) {
  const difficulty = {
    easy: { label: 'קל', dot: 'bg-ink-soft', text: 'text-ink-soft' },
    medium: { label: 'בינוני', dot: 'bg-warn', text: 'text-ink' },
    hard: { label: 'קשה', dot: 'bg-hard', text: 'text-hard font-semibold' },
  }[intensity]
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${difficulty.text}`}
      title={`עומס נתיב: ${difficulty.label}`}
      aria-label={`עומס נתיב ${difficulty.label}`}
    >
      <span className={`size-2 shrink-0 rounded-full ${difficulty.dot}`} aria-hidden />
      {difficulty.label}
    </span>
  )
}

function initialsForWorker(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`
}

function uniqueWorkerInitials(workers: { id: string; name: string }[]) {
  const byBase = new Map<string, number>()
  for (const worker of workers) {
    const base = initialsForWorker(worker.name)
    byBase.set(base, (byBase.get(base) ?? 0) + 1)
  }
  const used = new Set<string>()
  const result = new Map<string, string>()
  for (const worker of workers) {
    const base = initialsForWorker(worker.name)
    const parts = worker.name.trim().split(/\s+/).filter(Boolean)
    let candidate = base
    if ((byBase.get(base) ?? 0) > 1) {
      const givenName = parts[0] ?? base
      candidate = givenName.length <= 3
        ? givenName
        : `${givenName.slice(0, 2)}${parts[1]?.[0] ?? ''}`
    }
    if (used.has(candidate)) {
      const prefix = candidate.slice(0, 2) || base
      let suffix = 2
      candidate = `${prefix}${suffix}`
      while (used.has(candidate)) {
        suffix += 1
        candidate = `${prefix}${suffix}`
      }
    }
    used.add(candidate)
    result.set(worker.id, candidate)
  }
  return result
}

function InspectorAvatar({
  id,
  name,
  initials,
  trainingRole,
}: {
  id: string
  name: string
  initials: string
  trainingRole?: 'trainee' | 'mentor'
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line/80 bg-surface/80 py-0.5 pe-2.5 ps-0.5 text-xs font-medium text-ink"
      title={name}
    >
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(id)}`}
        aria-hidden
      >
        {initials}
      </span>
      <span className="truncate">{name}</span>
      {trainingRole === 'trainee' ? (
        <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-bold text-accent ring-1 ring-accent/25">
          מתלמד
        </span>
      ) : null}
    </span>
  )
}

function LaneTable({
  rows,
  workerInitials,
  onAssign,
}: {
  rows: HomeLaneRow[]
  workerInitials: Map<string, string>
  onAssign: () => void
}) {
  return (
    <div className="w-full overflow-x-auto rounded-lg">
      <table
        className="w-full table-fixed border-collapse text-center text-[13px]"
        aria-label="שיבוץ המשמרת לפי נתיב"
      >
        <colgroup>
          <col className="w-[26%] sm:w-[18%]" />
          <col className="w-[18%] sm:w-[14%]" />
          <col className="w-[56%] sm:w-[40%]" />
          <col className="w-0 sm:w-[28%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-brand/[0.045]">
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold tracking-wide text-ink-soft uppercase">
              נתיב
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold tracking-wide text-ink-soft uppercase">
              עצימות
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold tracking-wide text-ink-soft uppercase">
              בודקים
            </th>
            <th
              scope="col"
              title="חלון השעות האישי שבו כל בודק משובץ."
              className="hidden whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold tracking-wide text-ink-soft uppercase sm:table-cell"
            >
              משמרת
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const missing = Math.max(0, row.staffingStandard - row.assigned)
            const staffingOff = row.assigned !== row.staffingStandard
            return (
              <tr
                key={row.laneId}
                className={`h-12 border-b border-line/50 transition-colors last:border-b-0 hover:bg-brand/[0.04] ${
                  index % 2 === 1 ? 'bg-surface/50' : 'bg-card'
                }`}
              >
                <td className="px-3 py-2 align-middle text-center">
                  <span className="font-semibold text-ink">{row.laneName}</span>
                  {row.autoClosed ? (
                    <span className="mt-1 block text-xs font-bold text-hard">
                      סגור אוטומטית · אין מספיק כוח אדם
                    </span>
                  ) : row.manuallyReopened ? (
                    <span className="mt-1 block text-xs font-bold text-ok">נפתח ידנית</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 align-middle text-center">
                  <div className="flex justify-center">
                    <DifficultyBadge intensity={row.intensity} />
                  </div>
                </td>
                <td className="px-3 py-2 align-middle text-center">
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {row.workers.length === 0 && row.endedWorkers.length === 0 ? (
                      <button
                        type="button"
                        onClick={onAssign}
                        className="inline-flex items-center rounded-full border border-dashed border-line bg-surface/80 px-2.5 py-1 text-xs font-semibold text-ink-soft transition hover:border-brand/40 hover:bg-brand/[0.06] hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        aria-label={`שיבוץ לנתיב ${row.laneName}`}
                      >
                        לא משובץ
                      </button>
                    ) : row.workers.length === 0 ? (
                      <span className="text-xs font-medium text-ink-soft">אין עובדים פעילים</span>
                    ) : (
                      row.workers.map((person) => (
                        <div key={person.id} className="flex max-w-full flex-col items-center gap-1">
                          <InspectorAvatar
                            id={person.id}
                            name={person.name}
                            initials={workerInitials.get(person.id) ?? initialsForWorker(person.name)}
                            trainingRole={person.trainingRole}
                          />
                          <span
                            className="text-xs text-ink-soft sm:hidden"
                            title={`${person.name}: ${person.windowLabel}`}
                          >
                            <Ltr>{person.windowLabel}</Ltr>
                          </span>
                        </div>
                      ))
                    )}
                    {row.endedWorkers.length > 0 ? (
                      <span className="w-full text-xs text-ink-soft">
                        הסתיימו שעות: {row.endedWorkers.map((person) => person.name).join(' · ')}
                      </span>
                    ) : null}
                    {staffingOff ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ${
                          missing > 0
                            ? 'bg-hard-soft text-hard ring-hard/20'
                            : 'bg-warn-soft text-warn ring-warn/20'
                        }`}
                        title={`תקן ${row.staffingStandard}`}
                      >
                        {missing > 0 ? `חסר ${missing}` : `${row.assigned}/${row.staffingStandard}`}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="hidden px-3 py-2 align-middle text-center sm:table-cell">
                  {row.workers.length === 0 ? (
                    <span className="text-xs text-ink-soft">—</span>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1">
                      {row.workers.map((person) => (
                        <span
                          key={person.id}
                          className="inline-flex max-w-full items-center text-xs font-medium tabular-nums text-ink-soft"
                          title={`${person.name}: ${person.windowLabel}`}
                        >
                          <Ltr>{person.windowLabel}</Ltr>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  subtitle,
  view,
  tooltip,
  onNavigate,
}: {
  icon: LucideIcon
  tone: 'brand' | 'ok' | 'accent' | 'mid' | 'warn' | 'hard'
  label: string
  value: ReactNode
  subtitle?: ReactNode
  view: View
  tooltip?: string
  onNavigate: (view: View) => void
}) {
  const descriptionId = `home-kpi-${view}-${label.replace(/\s+/g, '-')}`
  return (
    <a
      href={pathForView(view)}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        event.preventDefault()
        onNavigate(view)
      }}
      title={tooltip}
      aria-describedby={tooltip ? descriptionId : undefined}
      className="group relative flex h-full min-w-0 flex-col rounded-2xl border border-line/80 bg-card p-4 text-start shadow-[var(--shadow-panel)] transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[var(--shadow-panel-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-5"
    >
      <span className="flex items-center justify-between">
        <MetricIconBadge tone={tone}>
          <Icon className="size-[18px]" aria-hidden />
        </MetricIconBadge>
        <ArrowUpRight className="size-4 text-ink-soft transition group-hover:text-brand" aria-hidden />
      </span>
      <span className="mt-3 text-sm font-semibold text-ink">{label}</span>
      <span className="mt-1 font-display text-3xl font-bold tracking-tight text-ink tabular-nums">
        {value}
      </span>
      <span className="mt-auto min-h-10 pt-1 text-[13px] text-ink-soft">
        {subtitle ?? <span aria-hidden>&nbsp;</span>}
      </span>
      {tooltip ? <span id={descriptionId} className="sr-only">{tooltip}</span> : null}
    </a>
  )
}

function HeadcountBanner({
  snapshot,
  live,
  onReschedule,
}: {
  snapshot: ReturnType<typeof shiftHeadcountSnapshot>
  live: boolean
  onReschedule: () => void
}) {
  if (!snapshot.tracked) return null
  const hasDeficit = snapshot.deficit > 0
  return (
    <div
      className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border px-3 py-2.5 text-[13px] ${
        hasDeficit
          ? 'border-hard/25 bg-hard-soft/70'
          : 'border-ok/25 bg-ok-soft/70'
      }`}
      role="status"
      aria-live="polite"
    >
      {hasDeficit ? (
        <AlertTriangle className="size-4 shrink-0 text-hard" aria-hidden />
      ) : (
        <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
      )}
      {hasDeficit ? (
        <span className="font-semibold text-hard">
          חוסר בכוח אדם: חסרים <strong className="font-extrabold tabular-nums">{snapshot.deficit}</strong>
        </span>
      ) : (
        <span className="font-semibold text-ok">כוח אדם מלא לפי תקן המשמרת</span>
      )}
      <span className="text-ink-soft tabular-nums">
        {live ? 'פעילים כעת' : 'נוכחים'} {snapshot.present} · תקן{' '}
        {snapshot.standard}
      </span>
      {hasDeficit ? (
        <button
          type="button"
          onClick={onReschedule}
          className="ms-auto text-xs font-semibold text-hard underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          שיבוץ מחדש
        </button>
      ) : null}
    </div>
  )
}

function countAssigned(shift: ShiftSchedule): number {
  const sources = shift.rounds?.length
    ? shift.rounds.flatMap((round) => round.assignments)
    : shift.assignments
  return new Set(sources.flatMap((a) => a.workerIds.filter(Boolean))).size
}

function ShiftWindowLabel({
  shiftType,
  inspectors,
}: {
  shiftType: ShiftSchedule['shiftType']
  inspectors?: boolean
}) {
  const label =
    inspectors &&
    (shiftType === 'morning' || shiftType === 'afternoon' || shiftType === 'night')
      ? formatInspectorShiftWindow(shiftType)
      : formatShiftWindow(shiftType)
  return (
    <span className="text-[13px] text-ink-soft">
      <Ltr>{label}</Ltr>
    </span>
  )
}

export function HomePage() {
  const {
    data,
    draft,
    draftDirty,
    loading,
    startShift,
    discardDraft,
    setView,
    setShiftStep,
    loadShiftFromHistory,
    user,
    module,
    assignmentModes,
  } = useApp()
  const inspectorModule = module === 'inspectors'
  const moduleAudience = audienceForModule(module)
  const showSelectorEntry =
    module === 'selectors' && assignmentModes.selectors === 'rounds'

  const activeWorkers = data.workers.filter(
    (w) => w.status === 'active' && w.isInspector,
  ).length
  const [savedBy, setSavedBy] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [systemMessages, setSystemMessages] = useState<SystemMessage[]>([])
  const [handoffNotes, setHandoffNotes] = useState<ShiftHandoffNote[]>([])
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [selectedSlot, setSelectedSlot] = useState<{
    date: string
    shiftType: ShiftSchedule['shiftType']
  } | null>(null)
  /** Reserved for when health is persisted on ShiftSchedule — not filled today. */
  const [shiftHealth] = useState<ShiftHealthSnapshot | null>(null)
  const [healthOpen, setHealthOpen] = useState(false)
  const boardKioskRef = useRef<BoardKioskHandle>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (user?.role !== 'org_manager') return
    let stop = false
    void fetchSystemMessagesRemote()
      .then((list) => {
        if (!stop) setSystemMessages(list.slice(0, 5))
      })
      .catch(() => {
        if (!stop) setSystemMessages([])
      })
    return () => {
      stop = true
    }
  }, [user?.role])

  useEffect(() => {
    let stop = false
    void fetchShiftHandoffs()
      .then((notes) => {
        if (!stop) setHandoffNotes(notes)
      })
      .catch(() => {
        if (!stop) setHandoffNotes([])
      })
    return () => { stop = true }
  }, [])

  const openIncidents = useMemo(
    () => (data.incidents ?? [])
      .filter(
        (item) =>
          item.status !== 'resolved' &&
          item.status !== 'rejected' &&
          item.status !== 'pending_approval',
      )
      .sort((a, b) => {
        const severityRank = { critical: 0, high: 1, medium: 2, low: 3 }
        return severityRank[a.severity] - severityRank[b.severity] || b.updatedAt.localeCompare(a.updatedAt)
      }),
    [data.incidents],
  )
  const pendingFaultApprovals = useMemo(
    () =>
      (data.incidents ?? []).filter(
        (item) => item.kind === 'fault' && item.status === 'pending_approval',
      ).length,
    [data.incidents],
  )
  const activeHandoffs = useMemo(() => {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    return handoffNotes
      .filter((note) => note.status === 'open')
      .map((note) => ({ ...note, overdue: Boolean(note.dueDate && note.dueDate < today) }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
  }, [handoffNotes])

  const shiftModels = useMemo(
    () => resolveShiftModels(data.shiftModels, module),
    [data.shiftModels, module],
  )
  const currentCtx = useMemo(() => {
    const found = currentShiftModel(shiftModels, new Date(nowTick))
    return {
      date: found.date,
      shiftType: found.model.id as ShiftSchedule['shiftType'],
      windowLabel: formatShiftModelWindow(found.model),
    }
  }, [shiftModels, nowTick])

  const currentSlotRef = useRef(currentCtx)
  useEffect(() => {
    const previousSlot = currentSlotRef.current
    if (
      previousSlot.date !== currentCtx.date ||
      previousSlot.shiftType !== currentCtx.shiftType
    ) {
      setSelectedSlot((selected) =>
        !selected ||
        (selected.date === previousSlot.date &&
          selected.shiftType === previousSlot.shiftType)
          ? currentCtx
          : selected,
      )
      currentSlotRef.current = currentCtx
    }
  }, [currentCtx])

  const scopedHistory = useMemo(
    () =>
      data.history.filter((shift) => {
        if (moduleAudience === 'selector') return shift.audience === 'selector'
        if (moduleAudience === 'security') return shift.audience === 'security'
        return shift.audience !== 'selector' && shift.audience !== 'security'
      }),
    [data.history, moduleAudience],
  )

  const shownSlot = selectedSlot ?? currentCtx
  const shownIsCurrent =
    shownSlot.date === currentCtx.date &&
    shownSlot.shiftType === currentCtx.shiftType

  const datesWithShifts = useMemo(
    () =>
      [...new Set([...scopedHistory.map((shift) => shift.date), currentCtx.date])]
        .filter(Boolean)
        .sort(),
    [scopedHistory, currentCtx.date],
  )

  const previousDate = [...datesWithShifts]
    .reverse()
    .find((date) => date < shownSlot.date)
  const nextDate = datesWithShifts.find((date) => date > shownSlot.date)

  const shiftsForShownDay = useMemo(
    () =>
      shiftModels.map((model) => {
        const shift = scopedHistory
          .filter(
            (item) =>
              item.date === shownSlot.date && item.shiftType === model.id,
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
        return { model, shift }
      }),
    [shiftModels, scopedHistory, shownSlot.date],
  )

  const selectDate = (date: string, preferLast: boolean) => {
    const available = shiftModels.map((model) => ({
      model,
      shift: scopedHistory
        .filter((item) => item.date === date && item.shiftType === model.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0],
    }))
    const modelsWithShifts = available.filter((item) => item.shift)
    const target =
      (preferLast
        ? modelsWithShifts[modelsWithShifts.length - 1]
        : modelsWithShifts[0]) ??
      (preferLast ? available[available.length - 1] : available[0])
    if (target) {
      setSelectedSlot({
        date,
        shiftType: target.model.id as ShiftSchedule['shiftType'],
      })
    }
  }

  const currentShift: ShiftSchedule | null = useMemo(() => {
    const matches = scopedHistory.filter(
      (h) => h.date === currentCtx.date && h.shiftType === currentCtx.shiftType,
    )
    if (matches.length === 0) return null
    return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  }, [scopedHistory, currentCtx.date, currentCtx.shiftType])

  const selectedShift = useMemo(() => {
    const matches = scopedHistory
      .filter(
        (shift) =>
          shift.date === shownSlot.date && shift.shiftType === shownSlot.shiftType,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return matches[0] ?? null
  }, [scopedHistory, shownSlot.date, shownSlot.shiftType])

  const displayedShift =
    draft && selectedShift && draft.id === selectedShift.id ? draft : selectedShift

  const previousShifts = useMemo(() => {
    const hidden = new Set([currentShift?.id].filter(Boolean))
    return [...scopedHistory]
      .filter((h) => !hidden.has(h.id))
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date)
        return b.updatedAt.localeCompare(a.updatedAt)
      })
      .slice(0, 3)
  }, [scopedHistory, currentShift?.id])

  const personalWindowLabel = useCallback(
    (workerId: string) => {
      const activeShift = draft && currentShift && draft.id === currentShift.id ? draft : currentShift
      if (!activeShift) return 'כל המשמרת'
      const preset = workerWindowById(
        activeShift.workerWindows?.[workerId],
        data.workerWindowPresets,
      )
      return preset?.label ?? 'כל המשמרת'
    },
    [currentShift, draft, data.workerWindowPresets],
  )

  const currentTableRows = useMemo(() => {
    // Use draft if editing, otherwise show saved shift
    const activeShift = draft && currentShift && draft.id === currentShift.id ? draft : currentShift
    if (!activeShift) return []
    const rows = activeShift.activeLaneIds
      .map((laneId) => {
        const lane = data.lanes.find((l) => l.id === laneId)
        if (!lane) return null
        // The home board shows only the shift selected for the current clock time.
        const status = laneLiveStatus({
          shift: activeShift,
          history: [],
          lane,
          models: shiftModels,
          presets: data.workerWindowPresets ?? [],
          now: nowTick,
        })
        const schedulesById = new Map([[activeShift.id, activeShift]])
        const workers = status.activeWorkerSources.map(({ workerId, shiftId }) => {
          const worker = data.workers.find((w) => w.id === workerId)
          const sourceShift = schedulesById.get(shiftId)
          const preset = workerWindowById(
            sourceShift?.workerWindows?.[workerId],
            data.workerWindowPresets,
          )
          return {
            id: workerId,
            name: worker?.fullName ?? workerId,
            trainingRole: worker?.trainingRole,
            windowLabel: preset?.label ?? personalWindowLabel(workerId),
          }
        })
        const endedWorkers = status.currentShiftEndedWorkerIds
          .map((id) => ({
            id,
            name: data.workers.find((worker) => worker.id === id)?.fullName ?? id,
          }))
        return {
          laneId,
          laneName: lane.name,
          intensity: lane.intensity as Intensity,
          staffingStandard: status.required,
          assigned: workers.length,
          workers,
          endedWorkers,
          autoClosed: status.autoClosed,
          manuallyReopened: status.manuallyReopened,
        }
      })
      .filter(Boolean) as {
      laneId: string
      laneName: string
      intensity: Intensity
      staffingStandard: number
      assigned: number
      workers: {
        id: string
        name: string
        trainingRole?: 'trainee' | 'mentor'
        windowLabel: string
      }[]
      endedWorkers: { id: string; name: string }[]
      autoClosed: boolean
      manuallyReopened: boolean
    }[]
    const order = new Map(data.lanes.map((lane, index) => [lane.id, index]))
    return rows.sort(
      (a, b) =>
      (order.get(a.laneId) ?? 0) - (order.get(b.laneId) ?? 0) ||
      a.laneName.localeCompare(b.laneName, 'he'),
    )
  }, [
    currentShift,
    draft,
    data.lanes,
    data.workers,
    data.workerWindowPresets,
    nowTick,
    personalWindowLabel,
    shiftModels,
  ])

  const currentUnassigned = useMemo(() => {
    if (!currentShift) return []
    const assigned = new Set(
      currentShift.assignments.flatMap((a) => a.workerIds.filter(Boolean)),
    )
    return currentShift.presentWorkerIds
      .filter((id) => !assigned.has(id))
      .map((id) => {
        const worker = data.workers.find((w) => w.id === id)
        return {
          id,
          name: worker?.fullName ?? id,
          trainingRole: worker?.trainingRole,
          windowLabel: personalWindowLabel(id),
        }
      })
  }, [currentShift, data.workers, personalWindowLabel])

  const displayedTableRows = useMemo(() => {
    if (!displayedShift) return []
    if (shownIsCurrent) return currentTableRows

    return displayedShift.activeLaneIds.flatMap((laneId) => {
      const lane = data.lanes.find((item) => item.id === laneId)
      if (!lane) return []
      const assignment = displayedShift.assignments.find(
        (item) => item.laneId === laneId,
      )
      const workers = (assignment?.workerIds ?? [])
        .filter(Boolean)
        .map((workerId) => {
          const worker = data.workers.find((item) => item.id === workerId)
          const preset = workerWindowById(
            displayedShift.workerWindows?.[workerId],
            data.workerWindowPresets,
          )
          return {
            id: workerId,
            name: worker?.fullName ?? workerId,
            trainingRole: worker?.trainingRole,
            windowLabel: preset?.label ?? 'כל המשמרת',
          }
        })
      return [{
        laneId,
        laneName: lane.name,
        intensity: lane.intensity as Intensity,
        staffingStandard: effectiveStaffingStandard(
          lane,
          displayedShift.staffingOverrides,
        ),
        assigned: workers.length,
        workers,
        endedWorkers: [],
        autoClosed: false,
        manuallyReopened: false,
      }]
    })
  }, [
    displayedShift,
    shownIsCurrent,
    currentTableRows,
    data.lanes,
    data.workers,
    data.workerWindowPresets,
  ])

  const displayedUnassigned = useMemo(() => {
    if (!displayedShift) return []
    if (shownIsCurrent) return currentUnassigned
    const assigned = new Set(
      displayedShift.assignments.flatMap((row) => row.workerIds.filter(Boolean)),
    )
    return displayedShift.presentWorkerIds
      .filter((workerId) => !assigned.has(workerId))
      .map((workerId) => {
        const worker = data.workers.find((item) => item.id === workerId)
        const preset = workerWindowById(
          displayedShift.workerWindows?.[workerId],
          data.workerWindowPresets,
        )
        return {
          id: workerId,
          name: worker?.fullName ?? workerId,
          trainingRole: worker?.trainingRole,
          windowLabel: preset?.label ?? 'כל המשמרת',
        }
      })
  }, [displayedShift, shownIsCurrent, currentUnassigned, data.workers, data.workerWindowPresets])

  const workerInitials = useMemo(() => {
    const workersById = new Map<string, { id: string; name: string }>()
    for (const person of displayedTableRows.flatMap((row) => row.workers)) {
      workersById.set(person.id, { id: person.id, name: person.name })
    }
    for (const person of displayedUnassigned) {
      workersById.set(person.id, { id: person.id, name: person.name })
    }
    return uniqueWorkerInitials([...workersById.values()])
  }, [displayedTableRows, displayedUnassigned])

  const resumeShift = () => {
    if (!draft) return
    if (draft.assignments.some((a) => a.workerIds.some(Boolean))) {
      setShiftStep('board')
    } else if (draft.presentWorkerIds.length > 0) {
      setShiftStep('attendance')
    } else {
      setShiftStep('lanes')
    }
    setView('shift')
  }

  const draftSummary = useMemo(() => {
    if (!draft) return null
    const assigned = new Set(
      draft.assignments.flatMap((a) => a.workerIds.filter(Boolean)),
    ).size
    return {
      dateLabel: formatShiftDate(draft.date),
      shiftLabel: shiftModelLabel(shiftModels, draft.shiftType),
      lanes: draft.activeLaneIds.length,
      present: draft.presentWorkerIds.length,
      assigned,
    }
  }, [draft, shiftModels])

  /** Short same-lane returns within 2 calendar days (from history). */
  const currentHeadcount = useMemo(
    () => {
      const activeShift =
        draft && currentShift && draft.id === currentShift.id
          ? draft
          : currentShift
      return activeShift
        ? liveShiftHeadcountSnapshot(
            activeShift,
            shiftModels,
            data.workerWindowPresets ?? [],
            nowTick,
          )
        : {
            tracked: false,
            standard: undefined as number | undefined,
            present: 0,
            deficit: 0,
            surplus: 0,
            live: false,
          }
    },
    [currentShift, draft, shiftModels, data.workerWindowPresets, nowTick],
  )

  const recentShiftCount = useMemo(
    () =>
      scopedHistory.filter((shift) => {
        const daysAgo = daysBetweenLocal(shift.date, currentCtx.date)
        return daysAgo >= 0 && daysAgo <= 7
      }).length,
    [scopedHistory, currentCtx.date],
  )

  const shortReturns = useMemo(() => {
    const recent = data.history
      .filter((h) => daysBetweenLocal(h.date, currentCtx.date) <= 2)
      .sort((a, b) => b.date.localeCompare(a.date))
    let count = 0
    const lastLane = new Map<string, { date: string; laneId: string }>()
    for (const shift of [...recent].reverse()) {
      for (const a of shift.assignments) {
        for (const wid of a.workerIds.filter(Boolean)) {
          const prev = lastLane.get(wid)
          if (
            prev &&
            prev.laneId === a.laneId &&
            daysBetweenLocal(prev.date, shift.date) <= 2 &&
            daysBetweenLocal(prev.date, shift.date) > 0
          ) {
            count += 1
          }
          lastLane.set(wid, { date: shift.date, laneId: a.laneId })
        }
      }
    }
    return count
  }, [data.history, currentCtx.date])

  const hardGapInfo = useMemo(() => {
    const active = data.workers.filter(
      (w) => w.status === 'active' && w.isInspector,
    )
    if (active.length === 0) {
      return {
        gap: 0,
        max: [] as { name: string; hardCount: number }[],
        min: [] as { name: string; hardCount: number }[],
        why: 'אין בודקים פעילים לחישוב.',
      }
    }
    const stats = computeWorkerLaneStats(active, data.lanes, data.history)
    const byId = new Map(active.map((w) => [w.id, w]))
    const rows = stats.map((s) => ({
      name: byId.get(s.workerId)?.fullName ?? s.workerId,
      hardCount: s.hardCount,
    }))
    const maxVal = Math.max(...rows.map((r) => r.hardCount))
    const minVal = Math.min(...rows.map((r) => r.hardCount))
    const max = rows
      .filter((r) => r.hardCount === maxVal)
      .sort((a, b) => a.name.localeCompare(b.name, 'he'))
    const min = rows
      .filter((r) => r.hardCount === minVal)
      .sort((a, b) => a.name.localeCompare(b.name, 'he'))
    const gap = maxVal - minVal
    const names = (list: { name: string }[]) =>
      list.map((r) => r.name).join(', ')
    const maxLabel = formatShiftShare(maxVal)
    const minLabel = formatShiftShare(minVal)
    const why =
      gap === 0
        ? 'היקף השיבוצים השקולים בעמדות קשות זהה לכל הבודקים הפעילים בהיסטוריה.'
        : `הפער הוא בין היקף השיבוצים השקולים הגבוה ביותר בעמדות קשות (${maxLabel}) לבין הנמוך ביותר (${minLabel}).`
    return { gap, max, min, why, namesMax: names(max), namesMin: names(min) }
  }, [data.workers, data.lanes, data.history])

  useEffect(() => {
    if (!previousShifts[0]) {
      setSavedBy(null)
      return
    }
    const target = previousShifts[0]
    let cancelled = false
    let idleId: number | undefined
    let timeoutId: number | undefined

    const run = () => {
      void (async () => {
        try {
          const logs = await fetchAuditLogs(80)
          if (cancelled) return
          const match = logs.find(
            (l) =>
              (l.action === 'shift_save' ||
                l.action === 'shift_update' ||
                l.action === 'shift_signoff') &&
              l.details.includes(target.date) &&
              l.details.includes(target.shiftType),
          )
          setSavedBy(match?.actor?.fullName || null)
        } catch {
          if (!cancelled) setSavedBy(null)
        }
      })()
    }

    const ric = window.requestIdleCallback
    if (typeof ric === 'function') {
      idleId = ric(run, { timeout: 2500 })
    } else {
      timeoutId = window.setTimeout(run, 800)
    }

    return () => {
      cancelled = true
      if (idleId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [previousShifts])

  const exportShift = async (shift: ShiftSchedule) => {
    setExportBusy(true)
    try {
      const laneOrder = new Map(
        data.lanes.map((lane, index) => [lane.id, index]),
      )
      const orderedLaneIds = [...shift.activeLaneIds].sort(
        (a, b) =>
          (laneOrder.get(a) ?? 0) - (laneOrder.get(b) ?? 0),
      )
      const lines: ExportLaneLine[] = orderedLaneIds.flatMap((laneId) => {
        const lane = data.lanes.find((l) => l.id === laneId)
        if (!lane) return []
        const assignment = shift.assignments.find((a) => a.laneId === laneId)
        const workers = (assignment?.workerIds ?? [])
          .filter(Boolean)
          .map((id) => data.workers.find((w) => w.id === id)?.fullName ?? id)
        return [
          {
            laneName: lane.name,
            intensity: lane.intensity,
            workers,
            staffingStandard: effectiveStaffingStandard(
              lane,
              shift.staffingOverrides,
            ),
            notes: assignment?.notes?.trim() || undefined,
          },
        ]
      })
      const assignedIds = new Set(
        shift.assignments.flatMap((a) => a.workerIds.filter(Boolean)),
      )
      const gateId = shift.gateManagerWorkerId?.trim() || ''
      const unassigned = shift.presentWorkerIds
        .filter((id) => id && id !== gateId && !assignedIds.has(id))
        .map((id) => data.workers.find((w) => w.id === id)?.fullName ?? id)
      const gateManagerName = gateId
        ? data.workers.find((w) => w.id === gateId)?.fullName ?? gateId
        : undefined

      await downloadBoardImage(
        shift.date,
        shift.shiftType,
        lines,
        unassigned,
        undefined,
        {
          preparedBy: savedBy || user?.fullName,
          organizationName: user?.orgName || undefined,
          ...(gateManagerName ? { gateManagerName } : {}),
        },
      )
      void postAuditEvent(
        'export_board',
        `${shift.date} · ${shiftModelLabel(shiftModels, shift.shiftType)} · ייצוא מהדף הראשי · ${lines.length} נתיבים`,
      )
      notify.success('המסמך יוצא בהצלחה')
    } catch (e) {
      console.error(e)
      notify.error('ייצוא נכשל. נסו שוב.')
    } finally {
      setExportBusy(false)
    }
  }

  const primaryEdit = () => {
    if (draft) {
      // Keep existing draft (lanes + assignments) — don't open an empty wizard.
      resumeShift()
      return
    }
    if (currentShift) {
      loadShiftFromHistory(currentShift.id)
      return
    }
    startShift()
  }

  const editDisplayedShift = () => {
    if (shownIsCurrent) {
      primaryEdit()
      return
    }
    if (!displayedShift) return
    loadShiftFromHistory(displayedShift.id)
  }

  const beginSelectorShift = () => {
    if (
      draftDirty &&
      !confirm('להתחיל שיבוץ סלקטורים? הטיוטה הנוכחית תוחלף.')
    ) {
      return
    }
    startShift('selector')
  }

  const activeDraftSummary = draft && draftDirty && shownIsCurrent ? draftSummary : null
  const headerShift = activeDraftSummary ? draft : displayedShift
  const headerStatus = activeDraftSummary
    ? 'טיוטה פעילה'
    : headerShift?.signOff?.signedAt
      ? 'נסגרה'
      : headerShift
        ? 'משובץ'
        : 'ממתין לשיבוץ'
  const headerStatusClass = activeDraftSummary
    ? 'bg-warn-soft text-warn ring-warn/20'
    : headerStatus === 'משובץ'
      ? 'bg-ok-soft text-ok ring-ok/20'
      : 'bg-surface text-ink-soft ring-line'
  const actionShift = shownIsCurrent ? currentShift : displayedShift
  const actionShiftType = shownIsCurrent ? currentCtx.shiftType : shownSlot.shiftType
  const actionDate = shownIsCurrent ? currentCtx.date : shownSlot.date
  const actionDescription = activeDraftSummary ? (
    <>
      {shiftModelLabel(shiftModels, actionShiftType)} · <Ltr>{formatShiftDate(actionDate)}</Ltr> ·{' '}
      {pluralizeHe(activeDraftSummary.lanes, lanePlural)} ·{' '}
      {pluralizeHe(activeDraftSummary.present, workerPlural)} נוכחים
      {activeDraftSummary.assigned > 0
        ? ` · ${pluralizeHe(activeDraftSummary.assigned, workerPlural)} משובצים`
        : ''}
      . אפשר להמשיך את הטיוטה או לבטל אותה.
    </>
  ) : actionShift ? (
    <>
      משמרת {shiftModelLabel(shiftModels, actionShiftType)} ·{' '}
      <Ltr>{formatShiftDate(actionDate)}</Ltr> ·{' '}
      <ShiftWindowLabel shiftType={actionShiftType} inspectors={inspectorModule} />.{' '}
      {actionShift.signOff?.signedAt
        ? 'השיבוץ נסגר ואפשר לצפות בו.'
        : 'השיבוץ שמור וניתן לעריכה.'}
    </>
  ) : (
    <>
      אין עדיין שיבוץ שמור למשמרת {shiftModelLabel(shiftModels, actionShiftType)} ·{' '}
      <Ltr>{formatShiftDate(actionDate)}</Ltr> ·{' '}
      <ShiftWindowLabel shiftType={actionShiftType} inspectors={inspectorModule} />. אפשר להתחיל משמרת חדשה.
    </>
  )
  const shiftTabOptions: ShiftTabOption[] = shiftsForShownDay.map(({ model, shift }) => {
    const draftForTab =
      draft && draft.date === shownSlot.date && draft.shiftType === model.id
        ? draft
        : undefined
    return {
      id: model.id as ShiftSchedule['shiftType'],
      label: model.name,
      saved: Boolean(shift),
      hasException: hasShiftException(draftForTab ?? shift),
    }
  })

  return (
    <div className="space-y-6 sm:space-y-7">
      {systemMessages.length > 0 ? (
        <section className="rounded-xl border border-line/70 bg-card px-4 py-3">
          <h2 className="font-display text-base font-bold text-ink">הודעות מערכת</h2>
          <ul className="mt-2 space-y-2">
            {systemMessages.map((message) => (
              <li key={message.id} className="rounded-lg bg-surface px-3 py-2">
                <p className="text-sm font-semibold text-ink">{message.title}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink-soft">{message.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {shownIsCurrent || displayedShift ? (
        <section
          className="flex flex-col gap-3 rounded-2xl border border-brand/15 bg-gradient-to-l from-brand/[0.07] via-card to-card px-4 py-4 shadow-[var(--shadow-panel)] sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-6 sm:py-5"
          aria-label="פעולות ליצירה ועריכת משמרת"
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand ring-1 ring-brand/15">
              <ClipboardPenLine className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-ink sm:text-lg">
                יצירה ועריכת משמרת
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                {actionDescription}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            {activeDraftSummary ? (
              <>
                <button
                  type="button"
                  onClick={resumeShift}
                  className="ui-btn ui-btn-primary gap-2"
                >
                  <RefreshCw className="size-4" aria-hidden />
                  המשך שיבוץ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('להתחיל משמרת חדשה? הטיוטה הנוכחית תוחלף.')) {
                      startShift()
                    }
                  }}
                  className="ui-btn ui-btn-secondary gap-2"
                >
                  <Plus className="size-4" aria-hidden />
                  משמרת חדשה
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('לבטל את טיוטת השיבוץ? הפעולה לא ניתנת לשחזור.')) {
                      discardDraft()
                    }
                  }}
                  className="ui-btn ui-btn-ghost"
                >
                  בטל טיוטה
                </button>
              </>
            ) : shownIsCurrent && currentShift ? (
              <>
                <button
                  type="button"
                  onClick={editDisplayedShift}
                  className="ui-btn ui-btn-primary gap-2"
                >
                  <Pencil className="size-4" aria-hidden />
                  {currentShift.signOff?.signedAt ? 'צפייה בשיבוץ' : 'עריכת שיבוץ'}
                </button>
                <button
                  type="button"
                  onClick={() => startShift()}
                  className="ui-btn ui-btn-secondary gap-2"
                  title="לא ניתן לשמור פעמיים לאותו תאריך וסוג משמרת אם כבר קיים שיבוץ"
                >
                  <Plus className="size-4" aria-hidden />
                  משמרת חדשה
                </button>
              </>
            ) : shownIsCurrent ? (
              <button
                type="button"
                onClick={() => startShift()}
                className="ui-btn ui-btn-primary gap-2"
              >
                <Plus className="size-4" aria-hidden />
                התחלת משמרת
              </button>
            ) : displayedShift ? (
              <button
                type="button"
                onClick={editDisplayedShift}
                className="ui-btn ui-btn-primary gap-2"
              >
                <Pencil className="size-4" aria-hidden />
                {displayedShift.signOff?.signedAt ? 'צפייה בשיבוץ' : 'עריכת שיבוץ'}
              </button>
            ) : null}
            {shownIsCurrent && showSelectorEntry ? (
              <button
                type="button"
                onClick={beginSelectorShift}
                className="ui-btn ui-btn-secondary"
              >
                שיבוץ סלקטורים
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      {/* Current shift and assignment table */}
      <SectionCard
        printRoot
        className="border-brand/10 shadow-[var(--shadow-panel-hover)]"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>משמרת {shiftModelLabel(shiftModels, shownSlot.shiftType)}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${headerStatusClass}`}
            >
              {headerStatus === 'טיוטה פעילה' ? (
                <RefreshCw className="size-3.5" aria-hidden />
              ) : headerStatus === 'נסגרה' ? (
                <Lock className="size-3.5" aria-hidden />
              ) : headerStatus === 'משובץ' ? (
                <CheckCircle2 className="size-3.5" aria-hidden />
              ) : null}
              {headerStatus}
            </span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ShiftWindowLabel shiftType={shownSlot.shiftType} inspectors={inspectorModule} />
          </span>
        }
        actions={
          shownIsCurrent && currentShift ? (
            <button
              type="button"
              onClick={() => void boardKioskRef.current?.enter()}
              className="ui-btn-ghost inline-flex size-10 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              title="מסך קיוסק"
              aria-label="פתיחת מסך קיוסק"
            >
              <Maximize2 className="size-4" aria-hidden />
            </button>
          ) : null
        }
      >
        <div className="mb-4 space-y-3 no-print">
          <DayNavigator
            date={formatShiftDate(shownSlot.date)}
            isToday={shownSlot.date === currentCtx.date}
            previousDate={previousDate}
            nextDate={nextDate}
            onPrevious={() => {
              if (previousDate) selectDate(previousDate, true)
            }}
            onNext={() => {
              if (nextDate) selectDate(nextDate, false)
            }}
            onToday={() => setSelectedSlot(null)}
          />
          <ShiftTabs
            options={shiftTabOptions}
            selectedId={shownSlot.shiftType}
            onSelect={(shiftType) =>
              setSelectedSlot({ date: shownSlot.date, shiftType })
            }
          />
        </div>

        {shiftHealth && (
          <div className="mb-3 no-print">
            {shiftHealth.warnings.length === 0 &&
            shiftHealth.understaffedLaneIds.length === 0 ? (
              <p className="inline-flex items-center gap-1.5 rounded-lg bg-ok-soft px-2.5 py-1.5 text-[13px] font-semibold text-ok">
                <CheckCircle2 className="size-4" aria-hidden />
                שיבוץ תקין
              </p>
            ) : (
              <div className="rounded-lg border border-warn/25 bg-warn-soft/80 px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-warn"
                  onClick={() => setHealthOpen((o) => !o)}
                  aria-expanded={healthOpen}
                >
                  <AlertTriangle className="size-4" aria-hidden />
                  {pluralizeHe(shiftHealth.warnings.length, warningPlural)}
                </button>
                {healthOpen && (
                  <ul className="mt-2 list-inside list-disc text-[13px] text-warn">
                    {shiftHealth.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {loading && !displayedShift ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : (
          <BoardKiosk
            ref={boardKioskRef}
            title={`משמרת נוכחית · ${shiftModelLabel(shiftModels, currentCtx.shiftType)}`}
            subtitle={
              <>
                <Ltr>{formatShiftDate(currentCtx.date)}</Ltr>
                {' · '}
                <ShiftWindowLabel
                  shiftType={currentCtx.shiftType}
                  inspectors={inspectorModule}
                />
              </>
            }
            canvas={currentShift ? (
              <GateMapKiosk
                shift={currentShift}
                lanes={data.lanes}
                workers={data.workers}
              />
            ) : undefined}
          >
            {!displayedShift ? (
              <EmptyState
                title={`אין שיבוץ שמור ל${shiftModelLabel(shiftModels, shownSlot.shiftType)}`}
                text={`אין שיבוץ ל${shiftModelLabel(shiftModels, shownSlot.shiftType)} בתאריך ${formatShiftDate(shownSlot.date)}.`}
              />
            ) : usesRounds(displayedShift) ? (
              <>
                <SelectorRoundTable
                  layout={module === 'selectors' ? 'table' : 'cards'}
                  rounds={displayedShift.rounds ?? []}
                  lanes={selectorLanes(data.lanes, displayedShift.activeLaneIds)}
                  workers={data.workers.filter((worker) =>
                    displayedShift.presentWorkerIds.includes(worker.id),
                  )}
                  overrides={displayedShift.staffingOverrides}
                  ramashName={
                    displayedShift.gateManagerWorkerId
                      ? data.workers.find(
                          (worker) =>
                            worker.id === displayedShift.gateManagerWorkerId,
                        )?.fullName ?? ''
                      : ''
                  }
                />
                {shownIsCurrent ? (
                  <HeadcountBanner
                    snapshot={currentHeadcount}
                    live={currentHeadcount.live}
                    onReschedule={editDisplayedShift}
                  />
                ) : null}
              </>
            ) : (
              <>
                <LaneTable rows={displayedTableRows} workerInitials={workerInitials} onAssign={editDisplayedShift} />
                {shownIsCurrent ? (
                  <HeadcountBanner
                    snapshot={currentHeadcount}
                    live={currentHeadcount.live}
                    onReschedule={editDisplayedShift}
                  />
                ) : null}
                {displayedUnassigned.length > 0 && (
                  <p className="mt-3 text-[13px] text-ink-soft">
                    לא שובצו:{' '}
                    {displayedUnassigned.map((person) => (
                      <span
                        key={person.id}
                        className="me-1.5 inline-flex items-center gap-1"
                      >
                        <InspectorAvatar
                          id={person.id}
                          name={person.name}
                          initials={workerInitials.get(person.id) ?? initialsForWorker(person.name)}
                          trainingRole={person.trainingRole}
                        />
                        <span className="text-xs font-medium tabular-nums text-ink-soft">
                          <Ltr>{person.windowLabel}</Ltr>
                        </span>
                      </span>
                    ))}
                  </p>
                )}
              </>
            )}
          </BoardKiosk>
        )}
      </SectionCard>

      <section className="no-print">
        <h2 className="mb-3 font-display text-base font-bold text-ink">סטטוס כללי</h2>
        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            icon={BarChart3}
            tone="hard"
            label="פער עמדות קשות"
            value={formatShiftShare(hardGapInfo.gap)}
            subtitle="בין בודקים פעילים"
            view="tracking"
            tooltip={`הפער מחושב לפי היקף השיבוצים השקולים בעמדות קשות בין הבודקים הפעילים. ${hardGapInfo.why}`}
            onNavigate={setView}
          />
          <KpiCard
            icon={RefreshCw}
            tone="warn"
            label="חזרות קצרות לעמדה"
            value={shortReturns}
            subtitle="ב־יומיים האחרונים"
            view="tracking"
            onNavigate={setView}
          />
          <KpiCard
            icon={BarChart3}
            tone="accent"
            label="משמרות בשבוע האחרון"
            value={recentShiftCount}
            subtitle="במודול הנוכחי"
            view="analytics"
            onNavigate={setView}
          />
          <KpiCard
            icon={Users}
            tone="brand"
            label="בודקים פעילים"
            value={activeWorkers}
            subtitle={<>מתוך <Ltr>{String(data.workers.length)}</Ltr> עובדים במערכת</>}
            view="workers"
            onNavigate={setView}
          />
          <KpiCard
            icon={LayoutGrid}
            tone="mid"
            label="נתיבים מוגדרים"
            value={data.lanes.length}
            view="lanes"
            onNavigate={setView}
          />
        </div>
      </section>

      {/* Other saved shifts */}
      <section className="rounded-2xl border border-line/80 bg-card/95 p-4 shadow-[var(--shadow-panel)] sm:p-5 no-print">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink sm:text-sm">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-accent/15">
            <Clock className="size-4" aria-hidden />
          </span>
          שיבוצים נוספים
        </div>

        {previousShifts.length === 0 ? (
          <EmptyState
            title="אין שיבוצים נוספים"
            text="שיבוצים שמורים מימים אחרים יופיעו כאן."
          />
        ) : (
          <ul className="space-y-2">
            {previousShifts.map((shift) => {
              const assigned = countAssigned(shift)
              const present = shift.presentWorkerIds.length
              const lanes = shift.activeLaneIds.length
              return (
                <li
                  key={shift.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/60 bg-surface/40 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      <Ltr>{formatShiftDate(shift.date)}</Ltr>
                      {' · '}
                      {shiftModelLabel(shiftModels, shift.shiftType)}
                      {shift.audience === 'selector'
                        ? ` · ${MODULE_LABELS.selectors}`
                        : shift.audience === 'security'
                          ? ` · ${MODULE_LABELS.security}`
                          : ''}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-soft">
                      {pluralizeHe(lanes, lanePlural)} ·{' '}
                      {pluralizeHe(present, workerPlural)} נוכחים ·{' '}
                      {pluralizeHe(assigned, workerPlural)} שובצו
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadShiftFromHistory(shift.id)}
                      className="ui-btn ui-btn-secondary !py-1.5 text-xs"
                    >
                      פתיחה
                    </button>
                    <button
                      type="button"
                      disabled={exportBusy}
                      onClick={() => void exportShift(shift)}
                      className="ui-btn ui-btn-ghost !py-1.5 text-xs"
                      aria-label="ייצוא מסמך"
                    >
                      {exportBusy ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Download className="size-3.5" aria-hidden />
                      )}
                      ייצוא
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <SectionCard
        title="דורש תשומת לב"
        subtitle="חריגות פתוחות ונושאים שממתינים להמשך טיפול"
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ui-btn ui-btn-secondary !py-1.5 text-xs" onClick={() => setView('stationMap')}>
              <MapIcon className="size-3.5" aria-hidden /> מפת עמדות
            </button>
            <button type="button" className="ui-btn ui-btn-primary !py-1.5 text-xs" onClick={() => setView('incidents')}>
              <Plus className="size-3.5" aria-hidden /> דיווח אירוע או תקלה
            </button>
          </div>
        }
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded-xl border border-line/70 bg-surface/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="inline-flex items-center gap-2 text-sm font-bold text-ink">
                <AlertTriangle className="size-4 text-warn" aria-hidden /> אירועים ותקלות פתוחים
              </h3>
              <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => setView('incidents')}>
                כל היומן ({openIncidents.length})
              </button>
            </div>
            {pendingFaultApprovals > 0 ? (
              <button
                type="button"
                onClick={() => setView('incidents')}
                className="mb-2 flex w-full items-center justify-between gap-2 rounded-lg border border-warn/30 bg-warn-soft/40 px-3 py-2 text-start"
              >
                <span className="text-[13px] font-semibold text-warn">
                  {pendingFaultApprovals === 1
                    ? 'דיווח תקלה אחד ממתין לאישור מנהל'
                    : `${pendingFaultApprovals} דיווחי תקלה ממתינים לאישור מנהל`}
                </span>
                <span className="text-xs font-semibold text-brand">לאישור</span>
              </button>
            ) : null}
            {openIncidents.length ? (
              <ul className="space-y-1.5">
                {openIncidents.slice(0, 4).map((incident) => (
                  <li key={incident.id}>
                    <button type="button" onClick={() => setView('incidents')} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-start transition hover:bg-card">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-ink">{incident.title}</span>
                        <span className="block text-xs text-ink-soft">{incident.kind === 'fault' ? 'תקלה' : 'אירוע'} · {incident.status === 'in_progress' ? 'בטיפול' : 'פתוח'}{incident.laneId ? ` · ${data.lanes.find((lane) => lane.id === incident.laneId)?.name ?? ''}` : ''}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${incident.severity === 'critical' ? 'bg-hard-soft text-hard' : incident.severity === 'high' ? 'bg-warn-soft text-warn' : 'bg-surface text-ink-soft'}`}>
                        {{ critical: 'קריטית', high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' }[incident.severity]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-lg bg-card px-3 py-3 text-[13px] text-ink-soft">אין חריגות פתוחות כרגע.</p>}
          </section>

          <section className="rounded-xl border border-line/70 bg-surface/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="inline-flex items-center gap-2 text-sm font-bold text-ink">
                <ClipboardPenLine className="size-4 text-brand" aria-hidden /> נושאים פתוחים במסירת משמרת
              </h3>
              <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => setView('handoff')}>
                כל הנושאים ({activeHandoffs.length})
              </button>
            </div>
            {activeHandoffs.length ? (
              <ul className="space-y-1.5">
                {activeHandoffs.slice(0, 4).map((note) => (
                  <li key={note.id}>
                    <button type="button" onClick={() => setView('handoff')} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-start transition hover:bg-card">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-ink">{note.title}</span>
                        <span className="block truncate text-xs text-ink-soft">{note.ownerWorkerId ? `אחראי: ${data.workers.find((worker) => worker.id === note.ownerWorkerId)?.fullName ?? 'לא ידוע'}` : 'ללא אחראי'}{note.dueDate ? ` · יעד: ${formatShiftDate(note.dueDate)}` : ''}</span>
                      </span>
                      {note.overdue ? <span className="shrink-0 rounded-full bg-hard-soft px-2 py-0.5 text-[11px] font-semibold text-hard">באיחור</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-lg bg-card px-3 py-3 text-[13px] text-ink-soft">אין נושאים פתוחים במסירת המשמרת.</p>}
          </section>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line/60 pt-3">
          <button type="button" onClick={() => setView('stationMap')} className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold text-ink hover:border-brand/30">
            <MapIcon className="size-4 text-brand" aria-hidden /> פתיחת מפת עמדות <ArrowUpRight className="size-3.5 text-ink-soft" aria-hidden />
          </button>
          <button type="button" onClick={() => setView('incidents')} className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold text-ink hover:border-brand/30">
            <Wrench className="size-4 text-brand" aria-hidden /> דיווח אירוע או תקלה <ArrowUpRight className="size-3.5 text-ink-soft" aria-hidden />
          </button>
          <button type="button" onClick={() => setView('handoff')} className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold text-ink hover:border-brand/30">
            <ClipboardPenLine className="size-4 text-brand" aria-hidden /> פתיחת מסירת משמרת <ArrowUpRight className="size-3.5 text-ink-soft" aria-hidden />
          </button>
        </div>
      </SectionCard>

      {user?.role === 'org_manager' ? <WorkerNoticeComposer /> : null}
    </div>
  )
}
