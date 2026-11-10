import { useEffect, useMemo, useRef, useState } from 'react'
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
  Table2,
  BarChart3,
  AlertTriangle,
  Lock,
  ClipboardPenLine,
  Wrench,
  Map as MapIcon,
} from 'lucide-react'
import {
  BoardKiosk,
  BoardKioskEnterButton,
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
  formatShiftDateShort,
  formatShiftWindow,
  pluralizeHe,
} from '../lib/hebrew'
import { notify } from '../lib/notify'
import { formatShiftShare } from '../lib/trackingHeatmap'
import {
  effectiveStaffingStandard,
  shiftHeadcountSnapshot,
  totalHeadcountDeficit,
} from '../lib/shiftStaffing'
import {
  EmptyState,
  IntensityBadge,
  Ltr,
  MetricIconBadge,
  PersonChip,
  SectionCard,
  Skeleton,
} from '../components/ui'
import type { Intensity, ShiftHandoffNote, ShiftSchedule } from '../types'
import { SelectorRoundTable } from '../components/SelectorRoundTable'
import { usesRounds } from '../lib/assignmentMode'
import { selectorLanes } from '../lib/selectorRounds'

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
  /** Reserved for when health is persisted on ShiftSchedule — not filled today. */
  const [shiftHealth] = useState<ShiftHealthSnapshot | null>(null)
  const [healthOpen, setHealthOpen] = useState(false)
  const boardKioskRef = useRef<BoardKioskHandle>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000)
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

  const currentShift: ShiftSchedule | null = useMemo(() => {
    const matches = data.history.filter((h) => {
      if (h.date !== currentCtx.date || h.shiftType !== currentCtx.shiftType) {
        return false
      }
      if (moduleAudience === 'selector') return h.audience === 'selector'
      if (moduleAudience === 'security') return h.audience === 'security'
      return h.audience !== 'selector' && h.audience !== 'security'
    })
    if (matches.length === 0) return null
    return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  }, [data.history, currentCtx.date, currentCtx.shiftType, moduleAudience])

  const previousShifts = useMemo(() => {
    const hidden = new Set([currentShift?.id].filter(Boolean))
    return [...data.history]
      .filter((h) => !hidden.has(h.id))
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date)
        return b.updatedAt.localeCompare(a.updatedAt)
      })
      .slice(0, 3)
  }, [data.history, currentShift?.id])

  const currentTableRows = useMemo(() => {
    if (!currentShift) return []
    const rows = currentShift.activeLaneIds
      .map((laneId) => {
        const lane = data.lanes.find((l) => l.id === laneId)
        if (!lane) return null
        const assignment = currentShift.assignments.find((a) => a.laneId === laneId)
        const workers = (assignment?.workerIds ?? [])
          .filter(Boolean)
          .map((id) => {
            const worker = data.workers.find((w) => w.id === id)
            return {
              id,
              name: worker?.fullName ?? id,
              trainingRole: worker?.trainingRole,
            }
          })
        return {
          laneId,
          laneName: lane.name,
          intensity: lane.intensity as Intensity,
          staffingStandard: effectiveStaffingStandard(
            lane,
            currentShift.staffingOverrides,
          ),
          assigned: workers.length,
          workers,
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
      }[]
    }[]
    const order = new Map(data.lanes.map((lane, index) => [lane.id, index]))
    return rows.sort(
      (a, b) =>
        (order.get(a.laneId) ?? 0) - (order.get(b.laneId) ?? 0) ||
        a.laneName.localeCompare(b.laneName, 'he'),
    )
  }, [currentShift, data.lanes, data.workers])

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
        }
      })
  }, [currentShift, data.workers])

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
  }, [draft])

  /** Short same-lane returns within 2 calendar days (from history). */
  const currentHeadcount = useMemo(
    () =>
      currentShift
        ? shiftHeadcountSnapshot(currentShift)
        : {
            tracked: false,
            standard: undefined as number | undefined,
            present: 0,
            deficit: 0,
            surplus: 0,
          },
    [currentShift],
  )

  /** Recent tracked shortages — same helper used on ביטולים וחוסרים. */
  const recentHeadcountDeficit = useMemo(() => {
    const recent = data.history.filter(
      (h) => daysBetweenLocal(h.date, currentCtx.date) <= 7,
    )
    return totalHeadcountDeficit(recent)
  }, [data.history, currentCtx.date])

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
        ? 'כל הבודקים הפעילים קיבלו אותו זמן בעמדות קשות בהיסטוריה.'
        : `הפער הוא ההפרש בין מי שבילה הכי הרבה בעמדות קשות (${maxLabel}) לבין מי שבילה הכי מעט (${minLabel}).`
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

  const statusTitle = `${shiftModelLabel(shiftModels, currentCtx.shiftType)} · ${formatShiftDateShort(currentCtx.date, new Date(nowTick))}`

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

  const beginSelectorShift = () => {
    if (
      draftDirty &&
      !confirm('להתחיל שיבוץ סלקטורים? הטיוטה הנוכחית תוחלף.')
    ) {
      return
    }
    startShift('selector')
  }

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
      {/* 1. Compact status bar */}
      <section
        className="flex flex-col gap-3 rounded-2xl border border-brand/15 bg-gradient-to-l from-brand/[0.07] via-card to-card px-4 py-4 shadow-[var(--shadow-panel)] sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-6 sm:py-5"
        style={{ minHeight: '5rem' }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          {draft && draftDirty && draftSummary ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-[11px] font-semibold text-warn ring-1 ring-warn/20 sm:text-xs">
                <RefreshCw className="size-3.5" aria-hidden />
                טיוטה פעילה
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">
                  המשך שיבוץ · {draftSummary.shiftLabel} ·{' '}
                  <Ltr>{draftSummary.dateLabel}</Ltr>
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-soft">
                  {pluralizeHe(draftSummary.lanes, lanePlural)} ·{' '}
                  {pluralizeHe(draftSummary.present, workerPlural)} נוכחים
                  {draftSummary.assigned > 0
                    ? ` · ${pluralizeHe(draftSummary.assigned, workerPlural)} משובצים`
                    : ''}
                </p>
              </div>
            </>
          ) : currentShift ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-semibold text-ok ring-1 ring-ok/20 sm:text-xs">
                {currentShift.signOff?.signedAt ? (
                  <Lock className="size-3.5" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-3.5" aria-hidden />
                )}
                {currentShift.signOff?.signedAt ? 'נסגרה' : 'משובץ'}
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">
                  משמרת {statusTitle}
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-soft">
                  <ShiftWindowLabel shiftType={currentCtx.shiftType} inspectors={inspectorModule} />
                </p>
              </div>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-soft ring-1 ring-line sm:text-xs">
                ממתין לשיבוץ
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">
                  משמרת {statusTitle}
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-soft">
                  <ShiftWindowLabel shiftType={currentCtx.shiftType} inspectors={inspectorModule} />
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          {draft && draftDirty ? (
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
                title="לא ניתן לשמור פעמיים לאותו תאריך וסוג משמרת אם כבר קיים שיבוץ"
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
              {showSelectorEntry && (
                <button
                  type="button"
                  onClick={beginSelectorShift}
                  className="ui-btn ui-btn-secondary"
                >
                  שיבוץ סלקטורים
                </button>
              )}
            </>
          ) : currentShift ? (
            <>
              <button
                type="button"
                onClick={primaryEdit}
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
              {showSelectorEntry && (
                <button
                  type="button"
                  onClick={beginSelectorShift}
                  className="ui-btn ui-btn-secondary"
                >
                  שיבוץ סלקטורים
                </button>
              )}
            </>
          ) : (
            <>
            <button
              type="button"
              onClick={() => startShift()}
              className="ui-btn ui-btn-primary gap-2"
            >
              <Plus className="size-4" aria-hidden />
              התחלת משמרת
            </button>
            {showSelectorEntry && (
              <button
                type="button"
                onClick={beginSelectorShift}
                className="ui-btn ui-btn-secondary"
              >
                שיבוץ סלקטורים
              </button>
            )}
            </>
          )}
        </div>
      </section>

      {/* Current shift card */}
      <SectionCard
        printRoot
        className="border-brand/10 shadow-[var(--shadow-panel-hover)]"
        title={`משמרת נוכחית · ${shiftModelLabel(shiftModels, currentCtx.shiftType)}`}
        subtitle={
          <>
            <Ltr>{formatShiftDate(currentCtx.date)}</Ltr>
            {' · '}
            <ShiftWindowLabel shiftType={currentCtx.shiftType} inspectors={inspectorModule} />
          </>
        }
        actions={
          currentShift ? (
            <BoardKioskEnterButton
              onClick={() => void boardKioskRef.current?.enter()}
            />
          ) : null
        }
      >
        <div
          className="mb-3 flex flex-wrap gap-1.5 no-kiosk"
          role="group"
          aria-label="חלונות משמרת"
        >
          {shiftModels.map((model) => {
            const active = model.id === currentCtx.shiftType
            return (
              <button
                key={model.id}
                type="button"
                aria-pressed={active}
                className={`inline-flex min-h-9 flex-col items-start justify-center rounded-full border px-3 py-1.5 text-start transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  active
                    ? 'border-brand/35 bg-brand/10 text-brand shadow-sm'
                    : 'border-line/80 bg-surface/60 text-ink-soft hover:border-brand/25 hover:bg-card hover:text-ink'
                }`}
              >
                <span className="text-[12px] font-semibold leading-none sm:text-[13px]">
                  {model.name}
                </span>
                <span className="mt-0.5 text-[11px] leading-none opacity-90">
                  <Ltr>
                    {formatShiftModelWindow(model).replace(' עד ', '–')}
                  </Ltr>
                </span>
              </button>
            )
          })}
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

        {loading && !currentShift ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : !currentShift ? (
          <EmptyState
            title="אין שיבוץ שמור למשמרת הנוכחית"
            text={`אין שיבוץ ל${shiftModelLabel(shiftModels, currentCtx.shiftType)} בחלון ${currentCtx.windowLabel}.`}
            action={
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startShift()}
                  className="ui-btn ui-btn-primary no-print"
                >
                  התחלת משמרת
                </button>
                {showSelectorEntry && (
                  <button
                    type="button"
                    onClick={beginSelectorShift}
                    className="ui-btn ui-btn-secondary no-print"
                  >
                    שיבוץ סלקטורים
                  </button>
                )}
              </div>
            }
          />
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
            canvas={
              <GateMapKiosk
                shift={currentShift}
                lanes={data.lanes}
                workers={data.workers}
              />
            }
          >
            {usesRounds(currentShift) ? (
              <SelectorRoundTable
                layout={module === 'selectors' ? 'table' : 'cards'}
                rounds={currentShift.rounds ?? []}
                lanes={selectorLanes(data.lanes, currentShift.activeLaneIds)}
                workers={data.workers.filter((worker) =>
                  currentShift.presentWorkerIds.includes(worker.id),
                )}
                overrides={currentShift.staffingOverrides}
                ramashName={
                  currentShift.gateManagerWorkerId
                    ? data.workers.find(
                        (worker) =>
                          worker.id === currentShift.gateManagerWorkerId,
                      )?.fullName ?? ''
                    : ''
                }
              />
            ) : (
              <>
                <div className="max-w-3xl overflow-hidden rounded-2xl border border-line shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed border-collapse text-center text-[13px]">
                      <colgroup>
                        <col className="w-[32%]" />
                        <col className="w-[22%]" />
                        <col className="w-[46%]" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-line bg-brand/[0.045]">
                          <th className="px-3 py-2.5 text-center text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
                            נתיב
                          </th>
                          <th className="px-3 py-2.5 text-center text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
                            עצימות
                          </th>
                          <th className="px-3 py-2.5 text-center text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
                            בודקים
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentTableRows.map((row, index) => {
                          const missing = Math.max(
                            0,
                            row.staffingStandard - row.assigned,
                          )
                          const staffingOff =
                            row.assigned !== row.staffingStandard
                          return (
                            <tr
                              key={row.laneId}
                              className={`h-12 border-b border-line/50 transition-colors last:border-b-0 hover:bg-brand/[0.04] ${
                                index % 2 === 1 ? 'bg-surface/50' : 'bg-card'
                              }`}
                            >
                              <td className="px-3 py-2 align-middle text-center font-semibold text-ink">
                                {row.laneName}
                              </td>
                              <td className="px-3 py-2 align-middle text-center">
                                <div className="flex justify-center">
                                  <IntensityBadge intensity={row.intensity} />
                                </div>
                              </td>
                              <td className="px-3 py-2 align-middle text-center">
                                <div className="flex flex-wrap items-center justify-center gap-1.5">
                                  {row.workers.length === 0 ? (
                                    <button
                                      type="button"
                                      onClick={primaryEdit}
                                      className="inline-flex items-center rounded-full border border-dashed border-line bg-surface/80 px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition hover:border-brand/40 hover:bg-brand/[0.06] hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-xs"
                                      aria-label={`שיבוץ לנתיב ${row.laneName}`}
                                    >
                                      לא משובץ
                                    </button>
                                  ) : (
                                    row.workers.map((person) => (
                                      <PersonChip
                                        key={person.id}
                                        name={person.name}
                                        trainingRole={person.trainingRole}
                                      />
                                    ))
                                  )}
                                  {staffingOff ? (
                                    <span
                                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ring-1 sm:text-[11px] ${
                                        missing > 0
                                          ? 'bg-hard-soft text-hard ring-hard/20'
                                          : 'bg-warn-soft text-warn ring-warn/20'
                                      }`}
                                      title={`תקן ${row.staffingStandard}`}
                                    >
                                      {missing > 0
                                        ? `חסר ${missing}`
                                        : `${row.assigned}/${row.staffingStandard}`}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                {currentUnassigned.length > 0 && (
                  <p className="mt-3 text-[13px] text-ink-soft">
                    לא שובצו:{' '}
                    {currentUnassigned.map((person) => (
                      <span key={person.id} className="me-1.5 inline-block">
                        <PersonChip
                          name={person.name}
                          trainingRole={person.trainingRole}
                        />
                      </span>
                    ))}
                  </p>
                )}
              </>
            )}
            {currentHeadcount.tracked ? (
              <div
                className={`mt-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] ${
                  currentHeadcount.deficit > 0
                    ? 'border-hard/25 bg-hard-soft/70 text-hard'
                    : 'border-ok/25 bg-ok-soft/70 text-ok'
                }`}
                role="status"
              >
                {currentHeadcount.deficit > 0 ? (
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                )}
                <span className="font-semibold">
                  {currentHeadcount.deficit > 0
                    ? `חוסר בכוח אדם: חסרים ${currentHeadcount.deficit}`
                    : 'כוח אדם מלא לפי תקן המשמרת'}
                </span>
                <span className="tabular-nums opacity-90">
                  נוכחים {currentHeadcount.present} · תקן{' '}
                  {currentHeadcount.standard}
                </span>
              </div>
            ) : null}
          </BoardKiosk>
        )}
      </SectionCard>

      {/* Metrics + quick links — RTL order: first card is rightmost */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 no-print">
        <button
          type="button"
          onClick={() => setView('cancellations')}
          className="group rounded-2xl border border-line/80 bg-gradient-to-bl from-hard/[0.045] via-card to-card p-4 text-start shadow-[var(--shadow-panel)] transition hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-[var(--shadow-panel-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-5"
        >
          <MetricIconBadge tone="hard">
            <Users className="size-[18px]" aria-hidden />
          </MetricIconBadge>
          <p className="mt-3 text-sm font-semibold text-ink">חוסר בכוח אדם</p>
          <p className="mt-1 font-display text-3xl font-bold tracking-tight text-ink tabular-nums">
            {currentHeadcount.tracked
              ? currentHeadcount.deficit
              : recentHeadcountDeficit}
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">
            {currentHeadcount.tracked
              ? `נוכחים ${currentHeadcount.present} מתוך תקן ${currentHeadcount.standard}`
              : 'סה״כ בשבוע האחרון'}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setView('analytics')}
          aria-describedby="hard-gap-tooltip"
          className="group relative rounded-2xl border border-line/80 bg-gradient-to-bl from-accent/[0.045] via-card to-card p-4 text-start shadow-[var(--shadow-panel)] outline-none transition hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-[var(--shadow-panel-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-5"
        >
          <MetricIconBadge tone="accent">
            <BarChart3 className="size-[18px]" aria-hidden />
          </MetricIconBadge>
          <p className="mt-3 text-sm font-semibold text-ink">פער עמדות קשות</p>
          <p className="mt-1 font-display text-3xl font-bold tracking-tight text-ink tabular-nums">
            {formatShiftShare(hardGapInfo.gap)}
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">בין בודקים פעילים</p>

          <div
            id="hard-gap-tooltip"
            role="tooltip"
            className="pointer-events-none absolute inset-x-2 bottom-[calc(100%+0.5rem)] z-[80] hidden rounded-xl border border-line/80 bg-card px-3.5 py-3 text-start text-[12px] leading-relaxed text-ink shadow-[var(--shadow-panel-hover)] group-hover:block group-focus-within:block sm:inset-x-auto sm:start-0 sm:w-72"
          >
            <p className="font-semibold text-ink">
              למה הפער {formatShiftShare(hardGapInfo.gap)}?
            </p>
            <p className="mt-1.5 text-ink-soft">{hardGapInfo.why}</p>
            {hardGapInfo.gap > 0 && (
              <ul className="mt-2 space-y-1.5 border-t border-line/60 pt-2">
                <li>
                  <span className="font-semibold text-hard">
                    הכי הרבה ({formatShiftShare(hardGapInfo.max[0]?.hardCount ?? 0)}):{' '}
                  </span>
                  <span className="text-ink">{hardGapInfo.namesMax}</span>
                </li>
                <li>
                  <span className="font-semibold text-ok">
                    הכי מעט ({formatShiftShare(hardGapInfo.min[0]?.hardCount ?? 0)}):{' '}
                  </span>
                  <span className="text-ink">{hardGapInfo.namesMin}</span>
                </li>
              </ul>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setView('tracking')}
          className="group rounded-2xl border border-line/80 bg-gradient-to-bl from-warn/[0.045] via-card to-card p-4 text-start shadow-[var(--shadow-panel)] transition hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-[var(--shadow-panel-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-5"
        >
          <MetricIconBadge tone="warn">
            <AlertTriangle className="size-[18px]" aria-hidden />
          </MetricIconBadge>
          <p className="mt-3 text-sm font-semibold text-ink">
            חזרות קצרות לעמדה
          </p>
          <p className="mt-1 font-display text-3xl font-bold tracking-tight text-ink tabular-nums">
            {shortReturns}
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">ב־יומיים האחרונים</p>
        </button>

        <button
          type="button"
          onClick={() => setView('workers')}
          className="group rounded-2xl border border-line/80 bg-gradient-to-bl from-brand/[0.035] via-card to-card p-4 text-start shadow-[var(--shadow-panel)] transition hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-[var(--shadow-panel-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-5"
        >
          <MetricIconBadge tone="brand">
            <Users className="size-[18px]" aria-hidden />
          </MetricIconBadge>
          <p className="mt-3 text-sm font-semibold text-ink">בודקים פעילים</p>
          <p className="mt-1 font-display text-3xl font-bold tracking-tight text-ink tabular-nums">
            {activeWorkers}
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">
            מתוך <Ltr>{String(data.workers.length)}</Ltr>
          </p>
        </button>

        <button
          type="button"
          onClick={() => setView('lanes')}
          className="group rounded-2xl border border-line/80 bg-gradient-to-bl from-mid/[0.045] via-card to-card p-4 text-start shadow-[var(--shadow-panel)] transition hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-[var(--shadow-panel-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-5"
        >
          <MetricIconBadge tone="mid">
            <LayoutGrid className="size-[18px]" aria-hidden />
          </MetricIconBadge>
          <p className="mt-3 text-sm font-semibold text-ink">נתיבים מוגדרים</p>
          <p className="mt-1 font-display text-3xl font-bold tracking-tight text-ink tabular-nums">
            {data.lanes.length}
          </p>
        </button>
      </section>

      <div className="flex flex-wrap gap-2 no-print">
        <button
          type="button"
          onClick={() => setView('tracking')}
          className="inline-flex items-center gap-2 rounded-xl border border-line/70 bg-card px-3.5 py-2.5 text-[13px] font-semibold text-ink shadow-sm transition hover:border-brand/25"
        >
          <Table2 className="size-4 text-brand" aria-hidden />
          מעקב עמדות
          <ArrowUpRight className="size-3.5 text-ink-soft" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setView('analytics')}
          className="inline-flex items-center gap-2 rounded-xl border border-line/70 bg-card px-3.5 py-2.5 text-[13px] font-semibold text-ink shadow-sm transition hover:border-brand/25"
        >
          <BarChart3 className="size-4 text-brand" aria-hidden />
          אנליזה
          <ArrowUpRight className="size-3.5 text-ink-soft" aria-hidden />
        </button>
      </div>

      {/* Previous shifts timeline */}
      <section className="rounded-2xl border border-line/80 bg-card/95 p-4 shadow-[var(--shadow-panel)] sm:p-5 no-print">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink sm:text-sm">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-accent/15">
            <Clock className="size-4" aria-hidden />
          </span>
          שיבוצים קודמים
        </div>

        {previousShifts.length === 0 ? (
          <EmptyState
            title="אין שיבוצים קודמים"
            text="אחרי שתשמרו משמרות, יופיעו כאן עד שלושת השיבוצים האחרונים (לא כולל המשמרת הנוכחית)."
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
