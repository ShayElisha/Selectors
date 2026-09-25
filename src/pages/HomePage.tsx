import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Download,
  LayoutGrid,
  Loader2,
  Play,
  RefreshCw,
  Users,
  Table2,
  BarChart3,
  AlertTriangle,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import {
  getCurrentShiftContext,
  SHIFT_TYPE_LABELS,
} from '../constants'
import { fetchAuditLogs, postAuditEvent } from '../api'
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
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import {
  EmptyState,
  IntensityBadge,
  Ltr,
  MetricIconBadge,
  PersonChip,
  SectionCard,
  Skeleton,
  StaffingBadge,
} from '../components/ui'
import type { Intensity, ShiftSchedule } from '../types'
import { SelectorRoundTable } from '../components/SelectorRoundTable'
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

function ShiftWindowLabel({ shiftType }: { shiftType: ShiftSchedule['shiftType'] }) {
  return (
    <span className="text-[13px] text-ink-soft">
      <Ltr>{formatShiftWindow(shiftType)}</Ltr>
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
  } = useApp()

  const activeWorkers = data.workers.filter(
    (w) => w.status === 'active' && w.isInspector,
  ).length
  const [savedBy, setSavedBy] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())
  /** Reserved for when health is persisted on ShiftSchedule — not filled today. */
  const [shiftHealth] = useState<ShiftHealthSnapshot | null>(null)
  const [healthOpen, setHealthOpen] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const currentCtx = useMemo(
    () => getCurrentShiftContext(new Date(nowTick)),
    [nowTick],
  )

  const currentShift: ShiftSchedule | null = useMemo(() => {
    const matches = data.history.filter(
      (h) =>
        h.date === currentCtx.date &&
        h.shiftType === currentCtx.shiftType &&
        h.audience !== 'selector',
    )
    if (matches.length === 0) return null
    return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  }, [data.history, currentCtx.date, currentCtx.shiftType])

  const selectorShift: ShiftSchedule | null = useMemo(() => {
    const matches = data.history.filter(
      (h) =>
        h.date === currentCtx.date &&
        h.shiftType === currentCtx.shiftType &&
        h.audience === 'selector',
    )
    if (matches.length === 0) return null
    return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  }, [data.history, currentCtx.date, currentCtx.shiftType])

  const previousShifts = useMemo(() => {
    const hidden = new Set(
      [currentShift?.id, selectorShift?.id].filter(Boolean),
    )
    return [...data.history]
      .filter((h) => !hidden.has(h.id))
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date)
        return b.updatedAt.localeCompare(a.updatedAt)
      })
      .slice(0, 3)
  }, [data.history, currentShift?.id, selectorShift?.id])

  const currentTableRows = useMemo(() => {
    if (!currentShift) return []
    return currentShift.activeLaneIds
      .map((laneId) => {
        const lane = data.lanes.find((l) => l.id === laneId)
        if (!lane) return null
        const assignment = currentShift.assignments.find((a) => a.laneId === laneId)
        const workers = (assignment?.workerIds ?? [])
          .filter(Boolean)
          .map((id) => data.workers.find((w) => w.id === id)?.fullName ?? id)
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
      workers: string[]
    }[]
  }, [currentShift, data.lanes, data.workers])

  const currentUnassigned = useMemo(() => {
    if (!currentShift) return []
    const assigned = new Set(
      currentShift.assignments.flatMap((a) => a.workerIds.filter(Boolean)),
    )
    return currentShift.presentWorkerIds
      .filter((id) => !assigned.has(id))
      .map((id) => data.workers.find((w) => w.id === id)?.fullName ?? id)
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
      shiftLabel: SHIFT_TYPE_LABELS[draft.shiftType],
      lanes: draft.activeLaneIds.length,
      present: draft.presentWorkerIds.length,
      assigned,
    }
  }, [draft])

  /** Short same-lane returns within 2 calendar days (from history). */
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
              (l.action === 'shift_save' || l.action === 'shift_update') &&
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
      const lines: ExportLaneLine[] = shift.activeLaneIds.flatMap((laneId) => {
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
          ...(gateManagerName ? { gateManagerName } : {}),
        },
      )
      void postAuditEvent(
        'export_board',
        `${shift.date} · ${SHIFT_TYPE_LABELS[shift.shiftType]} · ייצוא מהדף הראשי · ${lines.length} נתיבים`,
      )
      notify.success('המסמך יוצא בהצלחה')
    } catch (e) {
      console.error(e)
      notify.error('ייצוא נכשל. נסו שוב.')
    } finally {
      setExportBusy(false)
    }
  }

  const statusTitle = `${SHIFT_TYPE_LABELS[currentCtx.shiftType]} · ${formatShiftDateShort(currentCtx.date, new Date(nowTick))}`

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
    <div className="space-y-6">
      {/* 1. Compact status bar */}
      <section
        className="flex flex-col gap-3 rounded-xl border border-line/70 bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-4"
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
                <h2 className="font-display text-base font-bold tracking-tight text-ink sm:text-lg">
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
                <CheckCircle2 className="size-3.5" aria-hidden />
                משובץ
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold tracking-tight text-ink sm:text-lg">
                  משמרת {statusTitle}
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-soft">
                  <ShiftWindowLabel shiftType={currentCtx.shiftType} />
                </p>
              </div>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-soft ring-1 ring-line sm:text-xs">
                ממתין לשיבוץ
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold tracking-tight text-ink sm:text-lg">
                  משמרת {statusTitle}
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-soft">
                  <ShiftWindowLabel shiftType={currentCtx.shiftType} />
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
                <Play className="size-4 fill-current" aria-hidden />
                משמרת חדשה
              </button>
              <button
                type="button"
                onClick={beginSelectorShift}
                className="ui-btn ui-btn-secondary"
              >
                שיבוץ סלקטורים
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
          ) : currentShift ? (
            <>
              <button
                type="button"
                onClick={primaryEdit}
                className="ui-btn ui-btn-primary gap-2"
              >
                <ArrowLeft className="size-4" aria-hidden />
                עריכת שיבוץ
              </button>
              <button
                type="button"
                onClick={() => startShift()}
                className="ui-btn ui-btn-secondary gap-2"
                title="לא ניתן לשמור פעמיים לאותו תאריך וסוג משמרת אם כבר קיים שיבוץ"
              >
                <Play className="size-4 fill-current" aria-hidden />
                משמרת חדשה
              </button>
              <button
                type="button"
                onClick={beginSelectorShift}
                className="ui-btn ui-btn-secondary"
              >
                שיבוץ סלקטורים
              </button>
            </>
          ) : (
            <>
            <button
              type="button"
              onClick={() => startShift()}
              className="ui-btn ui-btn-primary gap-2"
            >
              <Play className="size-4 fill-current" aria-hidden />
              התחלת משמרת
            </button>
            <button
              type="button"
              onClick={beginSelectorShift}
              className="ui-btn ui-btn-secondary"
            >
              שיבוץ סלקטורים
            </button>
            </>
          )}
        </div>
      </section>

      {/* Current shift card */}
      <SectionCard
        printRoot
        title={`משמרת נוכחית · ${SHIFT_TYPE_LABELS[currentCtx.shiftType]}`}
        subtitle={
          <>
            <Ltr>{formatShiftDate(currentCtx.date)}</Ltr>
            {' · '}
            <ShiftWindowLabel shiftType={currentCtx.shiftType} />
          </>
        }
      >
        <p className="mb-3 text-[13px] text-ink-soft">
          חלונות: בוקר <Ltr>06:00–15:00</Ltr>
          {' · '}
          צהריים א <Ltr>14:30–18:30</Ltr>
          {' · '}
          צהריים ב <Ltr>18:00–21:30</Ltr>
          {' · '}
          לילה <Ltr>21:00–06:30</Ltr> (למחרת)
        </p>

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
        ) : !currentShift && !selectorShift ? (
          <EmptyState
            title="אין שיבוץ שמור למשמרת הנוכחית"
            text={`אין שיבוץ ל${SHIFT_TYPE_LABELS[currentCtx.shiftType]} בחלון ${formatShiftWindow(currentCtx.shiftType)}.`}
            action={
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startShift()}
                  className="ui-btn ui-btn-primary no-print"
                >
                  התחלת משמרת
                </button>
                <button
                  type="button"
                  onClick={beginSelectorShift}
                  className="ui-btn ui-btn-secondary no-print"
                >
                  שיבוץ סלקטורים
                </button>
              </div>
            }
          />
        ) : !currentShift ? (
          <p className="text-[13px] text-ink-soft">
            אין שיבוץ בודקים למשמרת הזו. שיבוץ הסלקטורים מופיע מתחת.
          </p>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-line/70">
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-right text-[13px]">
                  <thead>
                    <tr className="border-b border-line/70 bg-surface/90">
                      <th className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
                        נתיב
                      </th>
                      <th className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
                        עצימות
                      </th>
                      <th className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
                        תקן
                      </th>
                      <th className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
                        בודקים
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {currentTableRows.map((row) => (
                      <tr
                        key={row.laneId}
                        className="bg-card transition-colors hover:bg-surface/50"
                      >
                        <td className="px-3 py-2.5 font-semibold text-ink">
                          {row.laneName}
                        </td>
                        <td className="px-3 py-2.5">
                          <IntensityBadge intensity={row.intensity} />
                        </td>
                        <td className="px-3 py-2.5">
                          <StaffingBadge
                            assigned={row.assigned}
                            standard={row.staffingStandard}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          {row.workers.length === 0 ? (
                            <span className="text-ink-soft">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {row.workers.map((name) => (
                                <PersonChip key={name} name={name} />
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {currentUnassigned.length > 0 && (
              <p className="mt-3 text-[13px] text-ink-soft">
                לא שובצו:{' '}
                {currentUnassigned.map((n) => (
                  <span key={n} className="me-1.5 inline-block">
                    <PersonChip name={n} />
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </SectionCard>

      {selectorShift ? (
        <SectionCard
          title={`סלקטורים · ${SHIFT_TYPE_LABELS[currentCtx.shiftType]}`}
          subtitle={
            <>
              סבבים של שעתיים · <Ltr>{formatShiftDate(currentCtx.date)}</Ltr>
            </>
          }
          actions={
            <button
              type="button"
              onClick={() => loadShiftFromHistory(selectorShift.id)}
              className="ui-btn ui-btn-secondary no-print"
            >
              עריכה
            </button>
          }
        >
          <SelectorRoundTable
            rounds={selectorShift.rounds ?? []}
            lanes={selectorLanes(data.lanes, selectorShift.activeLaneIds)}
            workers={data.workers}
            overrides={selectorShift.staffingOverrides}
          />
        </SectionCard>
      ) : null}

      {/* Metrics + quick links */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 no-print">
        <button
          type="button"
          onClick={() => setView('workers')}
          className="rounded-xl border border-line/70 bg-card p-4 text-right shadow-sm transition hover:border-brand/25 hover:shadow-[var(--shadow-panel-hover)] sm:p-5"
        >
          <MetricIconBadge tone="brand">
            <Users className="size-[18px]" aria-hidden />
          </MetricIconBadge>
          <p className="mt-3 text-[13px] font-medium text-ink-soft">בודקים פעילים</p>
          <p className="mt-1 font-display text-3xl font-bold tracking-tight text-ink tabular-nums">
            {activeWorkers}
          </p>
          {activeWorkers !== data.workers.length && (
            <p className="mt-1 text-[13px] text-ink-soft">
              מתוך <Ltr>{String(data.workers.length)}</Ltr>
            </p>
          )}
        </button>

        <button
          type="button"
          onClick={() => setView('lanes')}
          className="rounded-xl border border-line/70 bg-card p-4 text-right shadow-sm transition hover:border-brand/25 hover:shadow-[var(--shadow-panel-hover)] sm:p-5"
        >
          <MetricIconBadge tone="mid">
            <LayoutGrid className="size-[18px]" aria-hidden />
          </MetricIconBadge>
          <p className="mt-3 text-[13px] font-medium text-ink-soft">נתיבים מוגדרים</p>
          <p className="mt-1 font-display text-3xl font-bold tracking-tight text-ink tabular-nums">
            {data.lanes.length}
          </p>
        </button>

        <div className="rounded-xl border border-line/70 bg-card p-4 shadow-sm sm:p-5">
          <MetricIconBadge tone="warn">
            <AlertTriangle className="size-[18px]" aria-hidden />
          </MetricIconBadge>
          <p className="mt-3 text-[13px] font-medium text-ink-soft">
            חזרות קצרות לעמדה
          </p>
          <p className="mt-1 font-display text-3xl font-bold tracking-tight text-ink tabular-nums">
            {shortReturns}
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">ב־יומיים האחרונים</p>
        </div>

        <div
          className="group relative rounded-xl border border-line/70 bg-card p-4 shadow-sm outline-none transition hover:border-brand/25 hover:shadow-[var(--shadow-panel-hover)] sm:p-5"
          tabIndex={0}
          aria-describedby="hard-gap-tooltip"
        >
          <MetricIconBadge tone="accent">
            <BarChart3 className="size-[18px]" aria-hidden />
          </MetricIconBadge>
          <p className="mt-3 text-[13px] font-medium text-ink-soft">פער עמדות קשות</p>
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
        </div>
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
      <section className="rounded-xl border border-line/70 bg-card/95 p-4 shadow-sm sm:p-5 no-print">
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
                      {SHIFT_TYPE_LABELS[shift.shiftType]}
                      {shift.audience === 'selector' ? ' · סלקטורים' : ''}
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
    </div>
  )
}
