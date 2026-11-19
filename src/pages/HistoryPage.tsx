import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  History,
  Loader2,
  List,
  Moon,
  MoreHorizontal,
  Search,
  Sun,
  Sunset,
  Table2,
  Trash2,
  Clock,
  RotateCcw,
} from 'lucide-react'
import { fetchShiftVersionsRemote } from '../api'
import { useApp } from '../context/AppContext'
import {
  EmptyState,
  Ltr,
  PersonChip,
  SectionCard,
  Skeleton,
} from '../components/ui'
import { RangeBar, type RangePresetId } from '../components/RangeBar'
import { SelectorRoundTable } from '../components/SelectorRoundTable'
import {
  AssignmentExplainDialog,
  groupExplanations,
  visibleExplanationReasons,
} from '../components/AssignmentExplainDialog'
import { explainSavedBoard } from '../algorithm'
import { isGateManagerLane } from '../lib/gateManager'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import { usesRounds } from '../lib/assignmentMode'
import { selectorLanes } from '../lib/selectorRounds'
import { workerShiftEnd } from '../lib/workerShiftStatus'
import {
  filterMidShiftOperationEvents,
  formatOperationTime,
} from '../lib/shiftOperationTime'
import {
  formatShiftDate,
  formatShiftWindow,
  pluralizeHe,
} from '../lib/hebrew'
import {
  formatInspectorShiftWindow,
} from '../lib/inspectorShifts'
import {
  formatShiftModelWindow,
  formatMinutes,
  currentShiftModel,
  resolveShiftModels,
  shiftModelLabel,
} from '../lib/shiftModels'
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
  countPlaced,
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
import { shiftBoardStability } from '../lib/boardStability'
import type { ShiftSchedule, ShiftType, ShiftVersionSummary } from '../types'

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

function ShiftVersionsDialog({
  shift,
  onClose,
}: {
  shift: ShiftSchedule
  onClose: () => void
}) {
  const { data, module, restoreHistoryVersion, syncing } = useApp()
  const [versions, setVersions] = useState<ShiftVersionSummary[]>([])
  const [loadingVersions, setLoadingVersions] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<ShiftVersionSummary | null>(null)
  const [restoring, setRestoring] = useState(false)
  const models = resolveShiftModels(data.shiftModels, module)
  const signedOff = Boolean(data.history.find((item) => item.id === shift.id)?.signOff?.signedAt)

  useEffect(() => {
    let cancelled = false
    setLoadingVersions(true)
    setLoadError(null)
    void fetchShiftVersionsRemote(shift.id)
      .then((items) => {
        if (!cancelled) setVersions(items)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'לא ניתן לטעון גרסאות')
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false)
      })
    return () => {
      cancelled = true
    }
  }, [shift.id])

  const confirmRestore = async () => {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      await restoreHistoryVersion(shift.id, restoreTarget.id)
      notify.success('הגרסה שוחזרה', 'השחזור נשמר כגרסה חדשה ביומן.')
      setRestoreTarget(null)
      onClose()
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'שחזור הגרסה נכשל')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4 no-print"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-versions-title"
          className="w-full max-w-xl rounded-2xl border border-line bg-card p-4 sm:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="shift-versions-title" className="font-display text-lg font-bold text-ink">גרסאות שיבוץ</h2>
              <p className="mt-1 text-[13px] text-ink-soft">{shiftModelLabel(models, shift.shiftType)} · <Ltr>{formatShiftDate(shift.date)}</Ltr></p>
            </div>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>סגירה</button>
          </div>
          <p className="mt-3 text-[13px] text-ink-soft">נשמרת גרסה בכל שמירה. מוצגות עד 100 הגרסאות האחרונות.</p>
          <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto">
            {loadingVersions ? (
              <div className="flex items-center gap-2 py-5 text-sm text-ink-soft"><Loader2 className="size-4 animate-spin" aria-hidden />טוען גרסאות…</div>
            ) : loadError ? (
              <p role="alert" className="rounded-lg bg-hard-soft px-3 py-2 text-sm text-hard">{loadError}</p>
            ) : versions.length === 0 ? (
              <p className="py-5 text-sm text-ink-soft">לא נמצאו גרסאות לשיבוץ הזה.</p>
            ) : versions.map((version, index) => (
              <article key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{index === 0 ? 'הגרסה האחרונה' : `גרסה ${versions.length - index}`} · {shiftModelLabel(models, version.shiftType)}</p>
                  <p className="mt-0.5 text-[13px] text-ink-soft"><Ltr>{new Date(version.createdAt).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}</Ltr> · {version.actorName}</p>
                  {version.date !== shift.date ? <p className="mt-0.5 text-[12px] text-ink-soft">תאריך השיבוץ בגרסה: <Ltr>{formatShiftDate(version.date)}</Ltr></p> : null}
                </div>
                <button
                  type="button"
                  disabled={signedOff || restoring || syncing}
                  title={signedOff ? 'משמרת סגורה ונעולה' : undefined}
                  onClick={() => setRestoreTarget(version)}
                  className="ui-btn ui-btn-secondary inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="size-3.5" aria-hidden />שחזור
                </button>
              </article>
            ))}
          </div>
          {signedOff ? <p className="mt-3 text-[13px] text-ink-soft">המשמרת נסגרה וננעלה, לכן אי אפשר לשחזר אליה גרסה.</p> : null}
        </section>
      </div>
      <ConfirmDialog
        open={Boolean(restoreTarget)}
        title="שחזור גרסת שיבוץ"
        confirmLabel={restoring ? 'משחזר…' : 'שחזור'}
        confirmDisabled={restoring || syncing}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => void confirmRestore()}
      >
        <p>הגרסה הנוכחית תישמר, והלוח יחזור לתוכן הגרסה שנבחרה.</p>
        {restoreTarget ? <p>{new Date(restoreTarget.createdAt).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })} · {restoreTarget.actorName}</p> : null}
      </ConfirmDialog>
    </>
  )
}

function StatGrid({ shift }: { shift: ShiftSchedule }) {
  const stats = [
    { label: 'נתיבים', value: shift.activeLaneIds.length },
    { label: 'משובצים', value: countPlaced(shift) },
    { label: 'נוכחים', value: shift.presentWorkerIds.length },
    { label: 'תקן', value: shift.headcountStandard ?? '—' },
  ]
  const missing =
    shift.headcountStandard == null
      ? 0
      : Math.max(0, shift.headcountStandard - shift.presentWorkerIds.length)

  return (
    <div className="min-w-0 flex-1">
      <div className="grid min-w-0 grid-cols-4 gap-1 text-center">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0 px-0.5">
            <p className="whitespace-nowrap text-[13px] font-semibold leading-tight tabular-nums text-ink sm:text-base">
              {stat.value}
            </p>
            <p className="mt-0.5 whitespace-nowrap text-[10px] leading-tight text-ink-soft sm:text-[11px]">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
      {missing > 0 ? (
        <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn ring-1 ring-warn/20">
          <AlertTriangle className="size-3 shrink-0" aria-hidden />
          חסרים <Ltr>{String(missing)}</Ltr>
        </span>
      ) : null}
    </div>
  )
}

function StatusBadge({
  shift,
  now,
  models,
}: {
  shift: ShiftSchedule
  now: number
  models: ReturnType<typeof resolveShiftModels>
}) {
  const health = presentAssignedHealth(shift)
  const nowDate = new Date(now)
  const today = shift.date === todayISO(nowDate)
  const current = currentShiftModel(models, nowDate)
  const minuteOfDay = nowDate.getHours() * 60 + nowDate.getMinutes()
  const overnight = current.model.endMinutes <= current.model.startMinutes
  const insideShiftWindow = overnight
    ? minuteOfDay >= current.model.startMinutes || minuteOfDay < current.model.endMinutes
    : minuteOfDay >= current.model.startMinutes && minuteOfDay < current.model.endMinutes
  const inProgress =
    current.date === shift.date &&
    current.model.id === shift.shiftType &&
    insideShiftWindow

  return (
    <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {health.kind === 'ok' ? (
        <span
          className="inline-flex items-center text-ok"
          role="img"
          aria-label="כל הנוכחים משובצים"
          title="כל הנוכחים משובצים"
        >
          <CheckCircle2 className="size-4" aria-hidden />
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn ring-1 ring-warn/20 sm:text-xs">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          <Ltr>{String(health.count)}</Ltr> לא משובצים
        </span>
      )}
      {shift.signOff?.signedAt ? (
        <span className="text-[11px] font-medium text-ink-soft sm:text-xs">
          נסגרה
        </span>
      ) : today ? (
        <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft sm:text-xs">
          {inProgress ? 'בעיצומה' : 'פתוחה'}
        </span>
      ) : null}
    </div>
  )
}

function buildExplanationGroups(
  shift: ShiftSchedule,
  lanes: ReturnType<typeof useApp>['data']['lanes'],
  workers: ReturnType<typeof useApp>['data']['workers'],
  history: ReturnType<typeof useApp>['data']['history'],
) {
  const saved = shift.explanations ?? []
  const source =
    saved.length > 0
      ? saved
      : explainSavedBoard({
          assignments: shift.assignments,
          activeLanes: lanes
            .filter(
              (lane) =>
                shift.activeLaneIds.includes(lane.id) && !isGateManagerLane(lane),
            )
            .map((lane) => ({
              ...lane,
              staffingStandard: effectiveStaffingStandard(
                lane,
                shift.staffingOverrides,
              ),
            })),
          presentWorkers: workers.filter(
            (worker) =>
              shift.presentWorkerIds.includes(worker.id) &&
              worker.id !== shift.gateManagerWorkerId,
          ),
          history: history.filter((item) => item.id !== shift.id),
          allLanes: lanes,
          date: shift.date,
          shiftType: shift.shiftType,
        })
  return groupExplanations(source, lanes, workers)
}

function ShiftExplanation({
  shift,
  groups,
}: {
  shift: ShiftSchedule
  groups: ReturnType<typeof groupExplanations>
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hasPlacements =
    !usesRounds(shift) &&
    shift.assignments.some((row) => row.workerIds.some(Boolean))
  const canExplain = (shift.explanations?.length ?? 0) > 0 || hasPlacements

  if (!canExplain) return null

  return (
    <div className="mb-3">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        className="text-[13px] font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        פירוט סיבות
      </button>
      <AssignmentExplainDialog
        open={open}
        onClose={() => setOpen(false)}
        date={shift.date}
        shiftType={shift.shiftType}
        groups={groups}
        returnFocusRef={buttonRef}
      />
    </div>
  )
}

type WorkerEndRow = {
  workerId: string
  name: string
  trainingRole?: 'trainee' | 'mentor'
  end: NonNullable<ReturnType<typeof workerShiftEnd>>
  earlyLeaveAt?: number
}

function EndTimeGroups({ rows }: { rows: WorkerEndRow[] }) {
  const grouped = new Map<string, { end: WorkerEndRow['end']; workers: WorkerEndRow[] }>()
  for (const row of rows) {
    const key = `${row.end.dayOffset}:${row.end.minutes}`
    const group = grouped.get(key) ?? { end: row.end, workers: [] }
    group.workers.push(row)
    grouped.set(key, group)
  }
  const groups = [...grouped.values()].sort(
    (a, b) => a.end.dayOffset - b.end.dayOffset || a.end.minutes - b.end.minutes,
  )

  return (
    <section className="min-w-0 rounded-xl border border-line/70 bg-surface/40 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">סיום שעות לפי עובד</h3>
        <span className="text-[11px] text-ink-soft">סיום מתוכנן</span>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-ink-soft">אין שעות סיום לעובדים במשמרת הזו.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {groups.map((group) => (
            <li
              key={`${group.end.dayOffset}:${group.end.minutes}`}
              className="flex min-w-0 items-start gap-2 py-2 first:pt-0 last:pb-0"
            >
              <div className="flex w-[4.5rem] shrink-0 items-center justify-center gap-1 whitespace-nowrap pt-0.5 text-sm font-semibold tabular-nums text-ink">
                <Ltr>{formatMinutes(group.end.minutes)}</Ltr>
                {group.end.dayOffset > 0 ? (
                  <span className="text-[10px] font-medium text-ink-soft">למחרת</span>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {group.workers.map((worker) => (
                  <span
                    key={worker.workerId}
                    title={worker.earlyLeaveAt != null ? 'יציאה מוקדמת' : undefined}
                    className={worker.earlyLeaveAt != null ? 'rounded-full ring-1 ring-warn/40' : undefined}
                  >
                    <PersonChip name={worker.name} trainingRole={worker.trainingRole} />
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type HistoryLaneRow = ReturnType<typeof laneRowsForShift>[number]

function LaneTable({
  rows,
  groups,
  workersById,
  search,
}: {
  rows: HistoryLaneRow[]
  groups: ReturnType<typeof groupExplanations>
  workersById: Map<string, ReturnType<typeof useApp>['data']['workers'][number]>
  search: string
}) {
  const groupByLane = new Map(groups.map((group) => [group.laneId, group]))
  return (
    <div className="max-h-[26rem] min-w-0 overflow-auto rounded-lg border border-line/70">
      <table className="w-full min-w-0 table-fixed border-collapse text-[12px]">
        <colgroup>
          <col className="w-[25%]" />
          <col className="w-[55%]" />
          <col className="w-[20%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface text-ink-soft">
          <tr className="border-b border-line text-start">
            <th scope="col" className="px-2 py-2 font-semibold">נתיב</th>
            <th scope="col" className="px-2 py-2 font-semibold">עובד</th>
            <th scope="col" className="px-2 py-2 font-semibold">קושי</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const group = groupByLane.get(row.laneId)
            const placements = new Map(
              (group?.placements ?? []).map((placement) => [placement.workerId, placement]),
            )
            const difficulty =
              row.intensity === 'hard'
                ? { label: 'קשה', dot: 'bg-hard' }
                : row.intensity === 'medium'
                  ? { label: 'בינוני', dot: 'bg-mid' }
                  : row.intensity === 'easy'
                    ? { label: 'קל', dot: 'bg-easy' }
                    : { label: 'לא ידוע', dot: 'bg-ink-soft' }
            const hasStaffingException =
              row.staffingStandard != null &&
              row.workerIds.length !== row.staffingStandard
            return (
              <tr
                key={row.laneId}
                className={`${index % 2 ? 'bg-surface/50' : 'bg-card'} border-b border-line/60 last:border-b-0`}
              >
                <td
                  className="px-2 py-1.5 font-semibold text-ink"
                  title={group?.laneSummary}
                >
                  <span className="line-clamp-1">{row.name}</span>
                  {hasStaffingException ? (
                    <span
                      className={`mt-0.5 inline-flex rounded px-1 text-[10px] font-semibold tabular-nums ${
                        row.workerIds.length > (row.staffingStandard ?? 0)
                          ? 'bg-hard-soft text-hard'
                          : 'bg-warn-soft text-warn'
                      }`}
                      title="משובצים / נדרשים"
                      aria-label={`${row.workerIds.length} משובצים מתוך ${row.staffingStandard} נדרשים`}
                    >
                      <Ltr>{row.workerIds.length}/{row.staffingStandard}</Ltr>
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">
                  {row.workerIds.length > 0 ? (
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {row.workerIds.map((workerId) => {
                        const worker = workersById.get(workerId)
                        const name = worker?.fullName ?? workerId
                        const placement = placements.get(workerId)
                        const reason = visibleExplanationReasons(
                          placement?.reasons ?? [],
                        ).join(' · ')
                        const hit = search.trim() ? workerMatchesSearch(name, search) : false
                        return (
                          <span
                            key={workerId}
                            title={reason ? `${name} · ${reason}` : name}
                            className={hit ? 'rounded-full ring-2 ring-accent ring-offset-1' : undefined}
                          >
                            <PersonChip name={name} trainingRole={worker?.trainingRole} />
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="text-ink-soft">לא שובץ</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-ink">
                    <span className={`size-2 shrink-0 rounded-full ${difficulty.dot}`} aria-hidden />
                    {difficulty.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ShiftDetails({
  shift,
  search,
  onOpen,
}: {
  shift: ShiftSchedule
  search: string
  onOpen: () => void
}) {
  const { data, module } = useApp()
  const lanesById = useMemo(
    () => new Map(data.lanes.map((lane) => [lane.id, lane])),
    [data.lanes],
  )
  const workersById = useMemo(
    () => new Map(data.workers.map((worker) => [worker.id, worker])),
    [data.workers],
  )
  const rows = useMemo(
    () => laneRowsForShift(shift, lanesById),
    [shift, lanesById],
  )
  const explanationGroups = useMemo(
    () => buildExplanationGroups(shift, data.lanes, data.workers, data.history),
    [shift, data.lanes, data.workers, data.history],
  )
  const models = resolveShiftModels(data.shiftModels, module)
  const visibleOperationEvents = filterMidShiftOperationEvents(
    shift.shiftOperationEvents,
    shift.date,
    shift.shiftType,
    models,
  )

  const workerEndRows = shift.presentWorkerIds.flatMap((workerId) => {
    const end = workerShiftEnd(
      shift,
      workerId,
      models,
      data.workerWindowPresets ?? [],
    )
    return end
      ? [
          {
            workerId,
            name: workersById.get(workerId)?.fullName ?? workerId,
            trainingRole: workersById.get(workerId)?.trainingRole,
            end,
            earlyLeaveAt: shift.earlyLeaveAt?.[workerId],
          },
        ]
      : []
  })

  return (
    <div className="min-w-0 space-y-3">
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <EndTimeGroups rows={workerEndRows} />

        <section className="min-w-0 rounded-xl border border-line/70 bg-surface/40 p-3">
          <h3 className="mb-2 text-sm font-semibold text-ink">הסבר השיבוץ</h3>
          <ShiftExplanation shift={shift} groups={explanationGroups} />
          {usesRounds(shift) ? (
            <SelectorRoundTable
              rounds={shift.rounds ?? []}
              lanes={selectorLanes(data.lanes, shift.activeLaneIds)}
              workers={data.workers.filter((worker) =>
                shift.presentWorkerIds.includes(worker.id),
              )}
              overrides={shift.staffingOverrides}
              ramashName={
                shift.gateManagerWorkerId
                  ? workersById.get(shift.gateManagerWorkerId)?.fullName ?? ''
                  : ''
              }
            />
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-ink-soft">אין שיבוצים בנתיבים</p>
          ) : (
            <LaneTable
              rows={rows}
              groups={explanationGroups}
              workersById={workersById}
              search={search}
            />
          )}
        </section>
      </div>

      {shift.shiftEvents?.length ? (
        <ul className="space-y-1">
          {shift.shiftEvents.map((event) => (
            <li key={event.id} className="rounded-xl bg-ok-soft/70 px-3 py-2 text-[13px] text-ink">
              <p className="font-semibold">שיקום לוח · {event.summary}</p>
              {event.lines.map((line) => (
                <p key={line} className="mt-0.5 text-ink-soft">{line}</p>
              ))}
            </li>
          ))}
        </ul>
      ) : null}

      {visibleOperationEvents.length ? (
        <section className="rounded-xl border border-line/70 bg-surface/40 p-3">
          <h3 className="mb-2 text-sm font-semibold text-ink">תיעוד שינויים בשיבוץ</h3>
          <ol className="space-y-2">
            {[...visibleOperationEvents]
              .sort(
                (a, b) =>
                  new Date(a.effectiveAt ?? a.recordedAt).getTime() -
                  new Date(b.effectiveAt ?? b.recordedAt).getTime(),
              )
              .map((event) => {
                const action =
                  event.kind === 'worker_moved'
                    ? `הועבר/ה מ${event.fromLaneName ?? 'נתיב לא ידוע'} ל${event.toLaneName ?? 'נתיב לא ידוע'}`
                    : event.kind === 'worker_assigned'
                      ? `שובץ/ה ל${event.toLaneName ?? 'נתיב לא ידוע'}`
                      : `הוסר/ה מ${event.fromLaneName ?? 'הנתיב'}`
                return (
                  <li key={event.id} className="rounded-lg bg-card px-3 py-2 text-[13px]">
                    <p className="font-semibold text-ink">{event.workerName} {action}</p>
                    <p className="mt-0.5 text-ink-soft">
                      בתוקף: {event.effectiveAt ? formatOperationTime(event.effectiveAt) : 'לא צוין (ייתכן מתחילת המשמרת)'}
                      {' · '}נרשם: {formatOperationTime(event.recordedAt)}
                      {' · '}{event.actorName || 'מנהל'}
                    </p>
                  </li>
                )
              })}
          </ol>
        </section>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        className="text-[13px] font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {shift.signOff?.signedAt ? 'צפייה' : 'עריכה'}
      </button>
    </div>
  )
}

function ShiftCard({
  shift,
  onOpen,
  onRequestDelete,
  open,
  onToggle,
}: {
  shift: ShiftSchedule
  onOpen: () => void
  onRequestDelete: () => void
  open: boolean
  onToggle: () => void
}) {
  const { data, module } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const menuRef = useRef<HTMLDivElement>(null)
  const Icon = SHIFT_ICONS[shift.shiftType]
  const models = resolveShiftModels(data.shiftModels, module)
  const shiftName = shiftModelLabel(models, shift.shiftType)
  const model = models.find((item) => item.id === shift.shiftType)
  const windowLabel = model
    ? formatShiftModelWindow(model)
    : module === 'inspectors' &&
        (shift.shiftType === 'morning' ||
          shift.shiftType === 'afternoon' ||
          shift.shiftType === 'night')
      ? formatInspectorShiftWindow(shift.shiftType)
      : formatShiftWindow(shift.shiftType)
  const deleteLabel = `מחיקת משמרת ${shiftName} ${formatShiftDate(shift.date)}`
  const stability = shiftBoardStability(shift)
  const detailsId = `history-shift-details-${shift.id}`

  useEffect(() => {
    if (shift.date !== todayISO()) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [shift.date])

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <article
      className={`min-w-0 max-w-full rounded-xl border bg-card/95 transition-colors ${
        open
          ? 'border-brand/50 shadow-[var(--shadow-panel)] ring-1 ring-brand/15'
          : 'border-line hover:border-brand/25'
      }`}
    >
      <div className="flex items-start gap-1">
        <div className="relative flex shrink-0 items-start pt-1" ref={menuRef}>
          <button
            type="button"
            aria-label={`פעולות — ${deleteLabel.replace('מחיקת ', '')}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((value) => !value)}
            className="inline-flex size-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <MoreHorizontal className="size-5" aria-hidden />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute start-0 top-full z-40 mt-1 min-w-[9rem] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[var(--shadow-panel-hover)]"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] font-medium text-ink hover:bg-surface focus-visible:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                onClick={() => {
                  setMenuOpen(false)
                  setVersionsOpen(true)
                }}
              >
                <History className="size-3.5" aria-hidden />גרסאות שיבוץ
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-start text-[13px] font-medium text-ink hover:bg-surface focus-visible:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                onClick={() => {
                  setMenuOpen(false)
                  onOpen()
                }}
              >
                פתיחה{shift.signOff?.signedAt ? '' : ' / עריכה'}
              </button>
              {shift.signOff?.signedAt ? null : (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={deleteLabel}
                  className="ui-btn-danger-ghost flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                  onClick={() => {
                    setMenuOpen(false)
                    onRequestDelete()
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  מחיקה
                </button>
              )}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          role="button"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${open ? 'סגירת' : 'פתיחת'} פירוט ${shiftName} ${formatShiftDate(shift.date)}`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2.5 text-start transition hover:bg-surface/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
        >
          <Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-ink">{shiftName}</span>
              {shift.audience === 'selector' || shift.audience === 'security' ? (
                <span
                  className="rounded-md bg-surface px-1.5 py-0.5 text-[12px] font-semibold text-ink ring-1 ring-line/70"
                  title={
                    shift.audience === 'selector'
                      ? 'משמרת המיועדת לסלקטורים'
                      : 'משמרת המיועדת למאבטחים'
                  }
                >
                  {shift.audience === 'selector' ? 'סלקטורים' : 'מאבטחים'}
                </span>
              ) : null}
              <ChevronDown
                className={`size-4 shrink-0 text-ink-soft transition ${open ? 'rotate-180' : ''}`}
                aria-hidden
              />
              <StatusBadge shift={shift} now={now} models={models} />
              <span
                className="rounded-md bg-surface px-1.5 py-0.5 text-[12px] font-semibold text-ink ring-1 ring-line/70"
                title="מדד היציבות מבוסס על מספר העריכות לאחר השמירה הראשונה."
              >
                יציבות · {stability.label}
              </span>
              <Ltr className="text-[13px] text-ink-soft">{windowLabel}</Ltr>
            </div>
            <div className="mt-2">
              <StatGrid shift={shift} />
            </div>
          </div>
        </button>
      </div>
      {versionsOpen ? (
        <ShiftVersionsDialog shift={shift} onClose={() => setVersionsOpen(false)} />
      ) : null}
    </article>
  )
}

function EmptySlot({ label }: { label: string }) {
  const Icon = Clock
  return (
    <div className="flex h-full min-h-[4.5rem] flex-col justify-center rounded-xl border border-dashed border-line/80 bg-surface/40 px-3 py-2 opacity-70">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-soft">
        <Icon className="size-3.5" aria-hidden />
        {label}
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
    module,
  } = useApp()
  const inspectors = module === 'inspectors'
  const shiftModels = useMemo(
    () => resolveShiftModels(data.shiftModels, module),
    [data.shiftModels, module],
  )
  const [mode, setMode] = useState<Mode>('list')
  const [range, setRange] = useState<RangePresetId>('all')
  const [customFrom, setCustomFrom] = useState(() => daysAgoISO(30))
  const [customTo, setCustomTo] = useState(() => todayISO())
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ShiftType | 'all'>('all')
  const [visibleDays, setVisibleDays] = useState(PAGE_SIZE)
  const [matrixPage, setMatrixPage] = useState(0)
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
    () =>
      groupHistoryDays(data.history, {
        fromDate,
        toDate,
        slotOrder: shiftModels.map((model) => model.id) as ShiftType[],
      }),
    [data.history, fromDate, toDate, shiftModels],
  )

  const filteredDays = useMemo(
    () =>
      filterDayCards(allDays, {
        search,
        shiftTypes:
          typeFilter === 'all'
            ? 'all'
            : new Set<ShiftType>([typeFilter]),
        workersById,
      }),
    [allDays, search, typeFilter, workersById, inspectors],
  )

  const shownDays = filteredDays.slice(0, visibleDays)
  const MATRIX_PAGE = 20
  const matrixPages = Math.max(1, Math.ceil(matrixView.rows.length / MATRIX_PAGE))
  const safeMatrixPage = Math.min(matrixPage, matrixPages - 1)
  const matrixRows = matrixView.rows.slice(
    safeMatrixPage * MATRIX_PAGE,
    safeMatrixPage * MATRIX_PAGE + MATRIX_PAGE,
  )

  const shiftsInRange = useMemo(() => {
    return data.history.filter((h) => {
      if (fromDate && h.date < fromDate) return false
      if (toDate && h.date > toDate) return false
      return true
    })
  }, [data.history, fromDate, toDate])

  const historySummaryParts = [
    `${shiftsInRange.length} ${pluralizeHe(shiftsInRange.length, {
      one: 'שיבוץ בטווח',
      two: 'שיבוצים בטווח',
      many: 'שיבוצים בטווח',
    })}`,
    range === 'all'
      ? 'כל ההיסטוריה'
      : range === 'custom'
        ? 'טווח מותאם'
        : `${range} ימים אחרונים`,
    ...shiftModels.map((model) => {
      const count = shiftsInRange.filter((shift) => shift.shiftType === model.id).length
      return `${count} ${model.name}`
    }),
  ]

  const shiftsForExport = useMemo(() => {
    return shiftsInRange.filter((h) => {
      if (
        typeFilter !== 'all' &&
        h.shiftType !== typeFilter
      ) {
        return false
      }
      if (search.trim() && !shiftMatchesSearch(h, search, workersById)) {
        return false
      }
      return true
    })
  }, [shiftsInRange, typeFilter, search, workersById, inspectors])

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
      shiftModels,
      fromDate,
      toDate,
    })
    notify.success('היסטוריית השיבוצים יוצאה לאקסל')
  }

  let lastMonth = ''

  return (
    <div className="history-print-root min-w-0 space-y-4">
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
              className="ui-btn ui-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-[13px] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
            fromDate={fromDate}
            toDate={toDate}
          />
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-soft">
            {historySummaryParts.map((part, index) => (
              <span key={`${index}-${part}`} className="inline-flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden>·</span> : null}
                <span>{part}</span>
              </span>
            ))}
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
                    ...shiftModels.map((model) => ({ id: model.id as ShiftType, label: model.name })),
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={typeFilter === opt.id}
                    onClick={() => setTypeFilter(opt.id)}
                    className={`rounded-lg px-2.5 py-1.5 font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                      typeFilter === opt.id
                        ? 'bg-brand text-white shadow-sm ring-1 ring-brand/30'
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
              <div className="-mx-1 min-w-0 overflow-x-auto overscroll-x-contain rounded-2xl border border-line/80 shadow-[var(--shadow-panel)] sm:mx-0">
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
                            title={
                              data.history.find((item) => item.id === col.shiftId)?.signOff
                                ? 'צפייה'
                                : 'פתיחה לעריכה'
                            }
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
                    {matrixRows.map((row, i) => {
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
              {matrixPages > 1 ? (
                <div className="mt-3 flex items-center justify-between gap-2 text-[13px]">
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary"
                    disabled={safeMatrixPage === 0}
                    onClick={() => setMatrixPage((page) => Math.max(0, page - 1))}
                  >
                    הקודם
                  </button>
                  <span className="text-ink-soft">
                    עמוד <Ltr>{String(safeMatrixPage + 1)}</Ltr> מתוך{' '}
                    <Ltr>{String(matrixPages)}</Ltr>
                  </span>
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary"
                    disabled={matrixPage + 1 >= matrixPages}
                    onClick={() =>
                      setMatrixPage((page) => Math.min(matrixPages - 1, page + 1))
                    }
                  >
                    הבא
                  </button>
                </div>
              ) : null}
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
                  className="ui-btn-danger-ghost block w-full px-3 py-2 text-start text-[13px] font-semibold"
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
              למחוק את משמרת {shiftModelLabel(shiftModels, deleteTarget.shiftType)} מיום{' '}
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

type DayGridItem =
  | { kind: 'empty'; key: string; shiftType: ShiftType }
  | { kind: 'shift'; key: string; shift: ShiftSchedule }

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
  const { data, module } = useApp()
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null)
  const [panelShift, setPanelShift] = useState<ShiftSchedule | null>(null)
  const models = resolveShiftModels(data.shiftModels, module)
  const dayItems = day.slots.flatMap<DayGridItem>((slot) => {
    const shifts = [slot.shift, slot.selectorShift].filter(
      (shift): shift is ShiftSchedule => Boolean(shift),
    )
    return shifts.length === 0
      ? [{ kind: 'empty' as const, key: slot.shiftType, shiftType: slot.shiftType }]
      : shifts.map((shift) => ({ kind: 'shift' as const, key: shift.id, shift }))
  })
  const panelItemIndex = dayItems.findIndex(
    (item) => item.kind === 'shift' && item.shift.id === panelShift?.id,
  )
  const panelItem = panelItemIndex >= 0 ? dayItems[panelItemIndex] : undefined
  const visiblePanelShift = panelItem?.kind === 'shift' ? panelItem.shift : null

  return (
    <section className="min-w-0 max-w-full">
      <header className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line/80 pb-2">
        <h3 className="font-display text-sm font-bold text-ink sm:text-base">
          {label.weekday}
        </h3>
        <Ltr className="text-[13px] text-ink-soft">{label.dateText}</Ltr>
        {label.relative === 'היום' ? (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand">
            היום
          </span>
        ) : label.relative === 'אתמול' ? (
          <span className="text-[12px] font-medium text-ink-soft">אתמול</span>
        ) : null}
      </header>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        {dayItems.map((item, index) => {
          const desktopGridPosition = {
            '--history-grid-column': String((index % 3) + 1),
            '--history-grid-row': String(Math.floor(index / 3) + 1),
          } as CSSProperties

          if (item.kind === 'empty') {
            return (
              <div
                key={item.key}
                className="min-w-0 md:[grid-column-start:var(--history-grid-column)] md:[grid-row-start:var(--history-grid-row)]"
                style={desktopGridPosition}
              >
                <EmptySlot label={shiftModelLabel(models, item.shiftType)} />
              </div>
            )
          }

          const shift = item.shift
          const isPanelShift = visiblePanelShift?.id === shift.id
          const panelIsOpen = expandedShiftId === shift.id

          return (
            <Fragment key={item.key}>
              <div
                className="min-w-0 md:[grid-column-start:var(--history-grid-column)] md:[grid-row-start:var(--history-grid-row)]"
                style={desktopGridPosition}
              >
                <ShiftCard
                  shift={shift}
                  onOpen={() => onOpen(shift.id)}
                  onRequestDelete={() => onRequestDelete(shift)}
                  open={panelIsOpen}
                  onToggle={() => {
                    if (panelIsOpen) {
                      setExpandedShiftId(null)
                    } else {
                      setPanelShift(shift)
                      setExpandedShiftId(shift.id)
                    }
                  }}
                />
              </div>
              {isPanelShift ? (
                <div
                  className="relative min-w-0 md:col-span-3 md:col-start-1 md:[grid-row-start:var(--history-panel-row)]"
                  style={{
                    '--history-panel-row': String(Math.ceil(dayItems.length / 3) + 1),
                    '--connector-inline-start': `${((index % 3) + 0.5) * (100 / 3)}%`,
                  } as CSSProperties}
                >
                  <span
                    className="absolute -top-1 start-1/2 z-10 size-3 -translate-x-1/2 rotate-45 border-s border-t border-brand/35 bg-card md:[inset-inline-start:var(--connector-inline-start)]"
                    aria-hidden
                  />
                  <div
                    id={`history-shift-details-${shift.id}`}
                    aria-hidden={!panelIsOpen}
                    onTransitionEnd={(event) => {
                      if (event.target === event.currentTarget && !expandedShiftId) {
                        setPanelShift(null)
                      }
                    }}
                    className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                      panelIsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className={panelIsOpen ? 'visible' : 'invisible'}>
                        <div className="rounded-xl border border-brand/30 bg-card p-3 shadow-[var(--shadow-panel)] sm:p-4">
                          <ShiftDetails
                            shift={shift}
                            search={search}
                            onOpen={() => onOpen(shift.id)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
