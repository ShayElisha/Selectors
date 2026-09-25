import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  UserPlus,
  X,
  Hand,
  ChevronDown,
  ChevronUp,
  Moon,
  Sun,
  Search,
  CheckCircle2,
  CircleAlert,
  Shield,
  Download,
  MessageCircle,
} from 'lucide-react'
import {
  isQualified,
  buildSameDayMorningContext,
  needsAfternoonNightRecovery,
} from '../algorithm'
import { useApp } from '../context/AppContext'
import { notify } from '../lib/notify'
import {
  SHIFT_TYPE_LABELS,
  findShiftForSlot,
  getCurrentShiftContext,
  shiftSlotConflictMessage,
} from '../constants'
import {
  activeAttendanceWorkers,
  isGateManagerLane,
  laneStaffPresentIds,
  managedLanes,
} from '../lib/gateManager'
import { IntensityBadge, Ltr } from '../components/ui'
import { BoardStep } from '../components/BoardStep'
import { SelectorRoundTable } from '../components/SelectorRoundTable'
import { selectorLanes, selectorRoundsHavePlacements } from '../lib/selectorRounds'
import {
  shiftFollowsMorning,
  WORKER_WINDOWS,
  workerWindowById,
  SELECTABLE_SHIFT_TYPES,
} from '../lib/shiftCatalog'
import {
  buildRoundsWhatsAppText,
  downloadRoundsImage,
  openWhatsAppShare,
  shareRoundsImage,
  type ExportRoundCell,
} from '../lib/export'
import { postAuditEvent } from '../api'
import { pluralizeHe } from '../lib/hebrew'
import { effectiveStaffingStandard, staffingChoicesForLane } from '../lib/shiftStaffing'
import {
  attendanceStepSummary,
  canAdvanceFromAttendance,
  canAdvanceFromLanes,
  computeFeasibilityPreview,
  deficitMessage,
  formatSetupDateLine,
  laneSelectionFromShift,
  lanesStepSummary,
  mostRecentShiftOfType,
  orderedCertChips,
  presentIdsFromShift,
  shiftWindowDisplay,
  workerMatchesNameQuery,
} from '../lib/shiftWizard'
import type { ShiftType } from '../types'

const STEPS = [
  { id: 'lanes' as const, label: 'נתיבים' },
  { id: 'attendance' as const, label: 'נוכחות' },
  { id: 'board' as const, label: 'שיבוץ' },
]

type ExtraFlow = 'closed' | 'ask' | 'pick'

export function ShiftPage() {
  const {
    data,
    draft,
    shiftStep,
    setShiftStep,
    updateDraftMeta,
    toggleLane,
    setLaneStaffingStandard,
    applyLaneSelection,
    applyPresentSelection,
    toggleWorker,
    setGateManager,
    setAllActiveLanes,
    setAllActiveWorkers,
    runAutoAssign,
    commitSelectorBoard,
    startManualAssign,
    updateSelectorCell,
    setWorkerWindow,
    addExtraWorkerToLane,
    saveCurrentShift,
    startShift,
    discardDraft,
    loadShiftFromHistory,
    draftDirty,
    setView,
    user,
  } = useApp()

  const [extraFlow, setExtraFlow] = useState<ExtraFlow>('closed')
  const [extraAskedOnce, setExtraAskedOnce] = useState(false)
  const [pickLaneId, setPickLaneId] = useState('')
  const [pickWorkerId, setPickWorkerId] = useState('')
  const [saveFlash, setSaveFlash] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [boardBaselineKey, setBoardBaselineKey] = useState(0)
  const [requestExplainModal, setRequestExplainModal] = useState(false)
  const [explainModalOpen, setExplainModalOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [feasibilityOpen, setFeasibilityOpen] = useState(false)
  const [attendanceQuery, setAttendanceQuery] = useState('')
  const discardTriggerRef = useRef<HTMLButtonElement | null>(null)

  const selectableLanes = useMemo(
    () => managedLanes(data.lanes),
    [data.lanes],
  )

  const exportLines = useMemo(() => {
    if (!draft) return []
    return draft.activeLaneIds.flatMap((laneId) => {
      const lane = data.lanes.find((l) => l.id === laneId)
      if (!lane) return []
      const assignment = draft.assignments.find((a) => a.laneId === laneId)
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
            draft.staffingOverrides,
          ),
          notes: assignment?.notes?.trim() || undefined,
        },
      ]
    })
  }, [draft, data.lanes, data.workers])

  const unassignedNames = useMemo(() => {
    if (!draft) return []
    return draft.unassignedWorkerIds.map(
      (id) => data.workers.find((w) => w.id === id)?.fullName ?? id,
    )
  }, [draft, data.workers])

  const roundExport = useMemo(() => {
    if (!draft || draft.audience !== 'selector') {
      return { laneNames: [] as string[], rounds: [] as ExportRoundCell[] }
    }
    const lanes = selectorLanes(data.lanes, draft.activeLaneIds)
    const nameOf = (id: string) =>
      data.workers.find((w) => w.id === id)?.fullName ?? id
    return {
      laneNames: lanes.map((lane) => lane.name),
      rounds: (draft.rounds ?? []).map((round) => ({
        label: round.label,
        lanes: lanes.map((lane) => ({
          laneName: lane.name,
          workers: (round.assignments.find((a) => a.laneId === lane.id)
            ?.workerIds ?? []
          )
            .filter(Boolean)
            .map(nameOf),
        })),
      })),
    }
  }, [draft, data.lanes, data.workers])

  const exportSelectorBoard = async (mode: 'download' | 'whatsapp') => {
    if (!draft) return
    const meta = { preparedBy: user?.fullName }
    const text = buildRoundsWhatsAppText(
      draft.date,
      draft.shiftType,
      roundExport.rounds,
    )
    try {
      if (mode === 'download') {
        await downloadRoundsImage(
          draft.date,
          draft.shiftType,
          roundExport.rounds,
          roundExport.laneNames,
          meta,
        )
        notify.success('השיבוץ יוצא')
      } else {
        const shareMode = await shareRoundsImage(
          draft.date,
          draft.shiftType,
          roundExport.rounds,
          roundExport.laneNames,
          meta,
          text,
        )
        if (shareMode === 'text') openWhatsAppShare(text)
        notify.success('השיתוף הוכן')
      }
      void postAuditEvent(
        'export_board',
        `${draft.date} · ${SHIFT_TYPE_LABELS[draft.shiftType]} · ייצוא סלקטורים · ${roundExport.rounds.length} סבבים`,
      )
    } catch {
      notify.error(
        mode === 'download' ? 'ייצוא השיבוץ נכשל' : 'שיתוף השיבוץ נכשל',
      )
    }
  }

  const slotConflict = useMemo(() => {
    if (!draft) return null
    return findShiftForSlot(
      data.history,
      draft.date,
      draft.shiftType,
      draft.id,
      draft.audience,
    )
  }, [draft, data.history])

  const morningCtx = useMemo(() => {
    if (!draft || !shiftFollowsMorning(draft.shiftType)) return null
    return buildSameDayMorningContext(data.history, draft.date)
  }, [draft, data.history])

  const attendanceWorkers = useMemo(
    () => activeAttendanceWorkers(data.workers),
    [data.workers],
  )

  const feasibility = useMemo(() => {
    if (!draft) {
      return computeFeasibilityPreview([], [], [], [], {})
    }
    const lanePresent = laneStaffPresentIds(
      draft.presentWorkerIds,
      draft.gateManagerWorkerId,
    )
    const laneIds = draft.activeLaneIds.filter((id) => {
      const lane = data.lanes.find((l) => l.id === id)
      return !lane || !isGateManagerLane(lane)
    })
    return computeFeasibilityPreview(
      data.lanes,
      laneIds,
      lanePresent,
      data.workers,
      draft.staffingOverrides,
    )
  }, [draft, data.lanes, data.workers])

  const lastSameType = useMemo(() => {
    if (!draft) return null
    return mostRecentShiftOfType(data.history, draft.shiftType, draft.id)
  }, [draft, data.history])

  const lanesAdvance = canAdvanceFromLanes(
    draft
      ? draft.activeLaneIds.filter((id) => {
          const lane = data.lanes.find((l) => l.id === id)
          return lane && !isGateManagerLane(lane)
        }).length
      : 0,
  )
  const attendanceAdvance = canAdvanceFromAttendance(
    draft?.presentWorkerIds.length ?? 0,
  )

  const morningShift = useMemo(() => {
    if (!draft || !shiftFollowsMorning(draft.shiftType)) return null
    const audience = draft.audience ?? 'inspector'
    const matches = data.history.filter(
      (shift) =>
        shift.date === draft.date &&
        shift.shiftType === 'morning' &&
        (shift.audience ?? 'inspector') === audience,
    )
    return (
      matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    )
  }, [draft, data.history])

  const filteredAttendance = useMemo(() => {
    const q = attendanceWorkers.filter((w) =>
      workerMatchesNameQuery(w, attendanceQuery),
    )
    if (!draft || !morningShift) return q
    const morningIds = new Set(morningShift.presentWorkerIds)
    return [...q].sort((a, b) => {
      const aGate = morningShift.gateManagerWorkerId === a.id ? 0 : 1
      const bGate = morningShift.gateManagerWorkerId === b.id ? 0 : 1
      if (aGate !== bGate) return aGate - bGate
      const aM = a.isManager && morningIds.has(a.id) ? 0 : 1
      const bM = b.isManager && morningIds.has(b.id) ? 0 : 1
      if (aM !== bM) return aM - bM
      const aStay = morningIds.has(a.id) ? 0 : 1
      const bStay = morningIds.has(b.id) ? 0 : 1
      if (aStay !== bStay) return aStay - bStay
      return 0
    })
  }, [attendanceWorkers, attendanceQuery, draft, morningShift])

  const continuersSeeded = useRef<string | null>(null)
  useEffect(() => {
    if (!draft || !morningShift) return
    if (draft.presentWorkerIds.length > 0) return
    const key = `${draft.id}|${draft.date}|${draft.shiftType}`
    if (continuersSeeded.current === key) return
    const workerWindows: Record<string, string> = {}
    for (const id of morningShift.presentWorkerIds) {
      const saved = morningShift.workerWindows?.[id]
      if (saved && workerWindowById(saved)) workerWindows[id] = saved
    }
    continuersSeeded.current = key
    applyPresentSelection(morningShift.presentWorkerIds, { workerWindows })
  }, [draft, morningShift, applyPresentSelection])

  const handleAutoAssign = () => {
    if (
      (draft?.audience === 'selector'
        ? selectorRoundsHavePlacements(draft.rounds ?? [])
        : draft?.assignments.some((a) => a.workerIds.some(Boolean))) &&
      !window.confirm(
        'כבר יש שיבוץ בלוח. שיבוץ אוטומטי יחליף את כל השיבוצים הקיימים. להמשיך?',
      )
    ) {
      return
    }
    setExtraAskedOnce(false)
    setExtraFlow('closed')
    setSaveFlash(false)
    setRequestExplainModal(true)
    runAutoAssign()
    setBoardBaselineKey((k) => k + 1)
  }

  const handleManualAssign = () => {
    if (
      (draft?.audience === 'selector'
        ? selectorRoundsHavePlacements(draft.rounds ?? [])
        : draft?.assignments.some((a) => a.workerIds.some(Boolean))) &&
      !window.confirm(
        'כבר יש שיבוץ בלוח. שיבוץ ידני ינקה את הלוח וישאיר את הנוכחים לא משובצים. להמשיך?',
      )
    ) {
      return
    }
    // Skip surplus modal — manual board starts with everyone unassigned on purpose.
    setExtraAskedOnce(true)
    setExtraFlow('closed')
    setSaveFlash(false)
    startManualAssign()
    setBoardBaselineKey((k) => k + 1)
  }

  // Surplus prompt — only once after each auto-assign
  useEffect(() => {
    if (!draft || shiftStep !== 'board' || extraAskedOnce) return
    if (draft.audience === 'selector') return
    if (requestExplainModal || explainModalOpen) return
    const moreWorkersThanLanes =
      laneStaffPresentIds(draft.presentWorkerIds, draft.gateManagerWorkerId)
        .length >
      draft.activeLaneIds.filter((id) => {
        const lane = data.lanes.find((l) => l.id === id)
        return !lane || !isGateManagerLane(lane)
      }).length
    const hasUnassigned = draft.unassignedWorkerIds.length > 0
    if (!moreWorkersThanLanes || !hasUnassigned) return

    setExtraAskedOnce(true)
    setPickLaneId(
      draft.activeLaneIds.find((id) => {
        const lane = data.lanes.find((l) => l.id === id)
        return lane && !isGateManagerLane(lane)
      }) ?? '',
    )
    setPickWorkerId(draft.unassignedWorkerIds[0] ?? '')
    setExtraFlow('ask')
  }, [draft, shiftStep, extraAskedOnce, requestExplainModal, explainModalOpen, data.lanes])

  const confirmExtraAdd = () => {
    if (!pickLaneId || !pickWorkerId) return
    addExtraWorkerToLane(pickLaneId, pickWorkerId)
    setExtraFlow('closed')
  }

  useLayoutEffect(() => {
    if (shiftStep !== 'board' || !draft || draft.audience === 'selector') return
    commitSelectorBoard()
  }, [shiftStep, draft, commitSelectorBoard])

  const handleSave = async () => {
    if (!draft) return
    if (slotConflict) {
      notify.error(shiftSlotConflictMessage(draft.date, draft.shiftType))
      return
    }
    if (draft.audience !== 'selector' && draft.unassignedWorkerIds.length > 0) {
      setSaveFlash(false)
      notify.error(
        'לא ניתן לשמור',
        `נשארו ${draft.unassignedWorkerIds.length} בודקים שלא שובצו לעמדה. שבצו את כולם לפני השמירה.`,
      )
      return
    }
    try {
      await saveCurrentShift()
      setSaveFlash(true)
      setLastSavedAt(new Date())
      setBoardBaselineKey((k) => k + 1)
      notify.success('השיבוץ נשמר')
      window.setTimeout(() => setSaveFlash(false), 2000)
    } catch {
      /* error shown via context + toast */
    }
  }

  if (!draft) {
    const ctx = getCurrentShiftContext()
    const existing = findShiftForSlot(data.history, ctx.date, ctx.shiftType)
    return (
      <div className="ui-panel-solid p-8 text-center sm:rounded-2xl">
        <p className="ui-empty-title">אין משמרת פעילה</p>
        <p className="ui-empty-text mt-1">
          {existing
            ? 'נמצא שיבוץ שמור למשמרת הנוכחית — אפשר לפתוח אותו לעריכה ידנית.'
            : 'התחילו שיבוץ חדש כדי לבחור נתיבים ונוכחות.'}
        </p>
        {existing ? (
          <button
            type="button"
            onClick={() => loadShiftFromHistory(existing.id)}
            className="ui-btn ui-btn-primary mt-5"
          >
            פתיחת השיבוץ הקיים
          </button>
        ) : (
          <button
            type="button"
            onClick={() => startShift()}
            className="ui-btn ui-btn-primary mt-5"
          >
            התחלת משמרת
          </button>
        )}
      </div>
    )
  }

  const hasFilledBoard = draft.assignments.some((a) =>
    a.workerIds.some(Boolean),
  )

  const stepIndex = STEPS.findIndex((s) => s.id === shiftStep)
  const unassignedWorkers = draft.unassignedWorkerIds
    .map((id) => data.workers.find((w) => w.id === id))
    .filter(Boolean)

  const pickLane = data.lanes.find((l) => l.id === pickLaneId)

  return (
    <div
      className={`space-y-4 sm:space-y-5 ${
        shiftStep === 'board'
          ? 'pb-28 sm:pb-32'
          : 'pb-44 sm:pb-36'
      }`}
    >
      {draft.audience === 'selector' && shiftStep !== 'board' ? (
        <p className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
          שיבוץ סלקטורים. בסוף התהליך מתקבלת טבלה: כל שורה היא סבב של שעתיים מתחילת המשמרת, וכל עמודה היא נתיב. הסלקטורים מתחלפים בין הנתיבים בכל סבב.
        </p>
      ) : null}
      {shiftStep !== 'board' ? (
      <div className="ui-panel-solid flex flex-wrap items-end gap-3 p-3.5 sm:rounded-2xl sm:p-4">
        <label className="text-xs sm:text-sm">
          <span className="mb-1.5 block text-[10px] font-medium text-ink-soft sm:text-xs">
            תאריך
          </span>
          <input
            type="date"
            className="ui-field !w-auto min-w-[9.5rem] !py-1.5 !text-xs sm:!py-2 sm:!text-sm"
            value={draft.date}
            onChange={(e) => updateDraftMeta({ date: e.target.value })}
          />
          <p className="mt-1 text-[13px] text-ink-soft">
            {formatSetupDateLine(draft.date)}
          </p>
        </label>
        <label className="text-xs sm:text-sm">
          <span className="mb-1.5 block text-[10px] font-medium text-ink-soft sm:text-xs">
            סוג משמרת
          </span>
          <select
            className="ui-field !w-auto min-w-[8rem] !py-1.5 !text-xs sm:!py-2 sm:!text-sm"
            value={draft.shiftType}
            onChange={(e) =>
              updateDraftMeta({ shiftType: e.target.value as ShiftType })
            }
          >
            {SELECTABLE_SHIFT_TYPES.map((k) => {
              const taken = Boolean(
                findShiftForSlot(
                  data.history,
                  draft.date,
                  k,
                  draft.id,
                  draft.audience,
                ),
              )
              return (
                <option key={k} value={k}>
                  {SHIFT_TYPE_LABELS[k]}
                  {taken ? ' (קיים שמור)' : ''}
                </option>
              )
            })}
          </select>
          <p className="mt-1 text-[13px] text-ink-soft">
            <Ltr>{shiftWindowDisplay(draft.shiftType)}</Ltr>
          </p>
        </label>
        <div className="ms-auto flex flex-col items-end gap-1.5">
          {draftDirty ? (
            <p className="text-[12px] font-medium text-ink-soft">
              טיוטה נשמרה אוטומטית
            </p>
          ) : null}
        <button
            ref={discardTriggerRef}
          type="button"
            onClick={() => setDiscardOpen(true)}
            className="ui-btn ui-btn-danger !py-1.5 text-xs sm:text-sm"
          >
            ביטול טיוטה
        </button>
      </div>
      </div>
      ) : null}

      {shiftStep !== 'board' && slotConflict && (
        <div
          className="rounded-xl border border-hard/30 bg-hard-soft px-3 py-2.5 text-[13px] text-hard sm:px-4 sm:py-3"
          role="alert"
        >
          <p className="font-bold">כבר קיים שיבוץ שמור למשמרת זו</p>
          <p className="mt-1 opacity-90">
            {shiftSlotConflictMessage(draft.date, draft.shiftType)}
          </p>
          <button
            type="button"
            onClick={() => loadShiftFromHistory(slotConflict.id)}
            className="mt-2 text-[13px] font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            פתיחה לעריכה
          </button>
        </div>
      )}

      {shiftStep !== 'board' ? (
      <ol className="flex gap-1.5 sm:gap-2" aria-label="שלבי שיבוץ">
        {STEPS.map((s, i) => {
          const done = i < stepIndex
          const active = i === stepIndex
          const lanesOk = lanesAdvance.ok
          const attOk = attendanceAdvance.ok
          const blocked =
            (s.id === 'attendance' && !lanesOk) ||
            (s.id === 'board' && (!lanesOk || !attOk))
          const subtitle =
            s.id === 'lanes'
              ? lanesStepSummary(
                  draft.activeLaneIds.length,
                  feasibility.totalStandard,
                )
              : s.id === 'attendance'
                ? attendanceStepSummary(
                    draft.presentWorkerIds.length,
                    attendanceWorkers.length,
                  )
                : draft.assignments.length > 0
                  ? 'לוח מוכן'
                  : 'טרם שובץ'
          return (
            <li key={s.id} className="min-w-0 flex-1">
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                disabled={blocked && !done && !active}
                title={
                  blocked && !done && !active
                    ? s.id === 'attendance'
                      ? lanesAdvance.reason ?? undefined
                      : attendanceAdvance.reason ??
                        lanesAdvance.reason ??
                        undefined
                    : undefined
                }
                onClick={() => {
                  if (s.id === 'attendance' && !lanesOk) return
                  if (s.id === 'board' && (!lanesOk || !attOk)) return
                  setShiftStep(s.id)
                }}
                className={`flex w-full flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:gap-1 sm:px-2 sm:py-2.5 ${
                  active
                    ? 'bg-brand text-white shadow-sm'
                    : done
                      ? 'bg-ok-soft text-ok'
                      : blocked
                        ? 'bg-card text-ink-soft/50 ring-1 ring-line'
                      : 'bg-card text-ink-soft ring-1 ring-line'
                }`}
              >
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold sm:text-[13px]">
                  <span
                    className={`inline-flex size-6 items-center justify-center rounded-full text-[11px] tabular-nums sm:size-7 sm:text-xs ${
                      active
                        ? 'bg-white/20 text-white'
                        : done
                          ? 'bg-ok text-white'
                          : 'bg-surface text-ink-soft'
                    }`}
                  >
                    {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
                  </span>
                  <span className="truncate">{s.label}</span>
                </span>
                <span
                  className={`hidden max-w-full truncate text-[11px] font-medium tabular-nums sm:block ${
                    active ? 'text-white/85' : ''
                  }`}
                >
                  {subtitle}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      ) : null}

      {shiftStep === 'lanes' && (
        <section className="ui-panel-solid p-4 sm:rounded-2xl sm:p-5">
          {selectableLanes.length === 0 ? (
            <div className="ui-empty">
              <p className="ui-empty-title">עדיין אין נתיבים</p>
              <p className="ui-empty-text">הגדירו נתיבים לפני השיבוץ.</p>
              <button
                type="button"
                onClick={() => setView('lanes')}
                className="ui-btn ui-btn-primary mt-2"
              >
                למסך נתיבים
              </button>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="ui-title">בחירת נתיבים פעילים</h2>
                  <p className="mt-1 text-[13px] text-ink-soft tabular-nums">
                    נבחרו{' '}
                    {
                      draft.activeLaneIds.filter((id) => {
                        const lane = data.lanes.find((l) => l.id === id)
                        return lane && !isGateManagerLane(lane)
                      }).length
                    }{' '}
                    מתוך {selectableLanes.length} ·{' '}
                    {lanesStepSummary(
                      draft.activeLaneIds.filter((id) => {
                        const lane = data.lanes.find((l) => l.id === id)
                        return lane && !isGateManagerLane(lane)
                      }).length,
                      feasibility.totalStandard,
                    )}
              </p>
            </div>
                <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAllActiveLanes(true)}
                    className="ui-btn ui-btn-secondary !py-1.5 text-xs"
              >
                    בחירת הכל
              </button>
              <button
                type="button"
                onClick={() => setAllActiveLanes(false)}
                    className="ui-btn ui-btn-ghost !py-1.5 text-xs"
              >
                ניקוי
              </button>
                  <button
                    type="button"
                    disabled={!lastSameType}
                    title={
                      lastSameType
                        ? undefined
                        : 'אין משמרת שמורה קודמת מאותו סוג'
                    }
                    onClick={() => {
                      if (!lastSameType) return
                      const sel = laneSelectionFromShift(lastSameType)
                      applyLaneSelection(
                        sel.laneIds,
                        sel.hadSavedStandards ? sel.staffingOverrides : {},
                      )
                    }}
                    className="ui-btn ui-btn-ghost !py-1.5 text-xs disabled:opacity-40"
                  >
                    כמו במשמרת האחרונה מאותו סוג
                  </button>
            </div>
          </div>
              {lastSameType &&
              !laneSelectionFromShift(lastSameType).hadSavedStandards ? (
                <p className="mb-2 text-[12px] text-ink-soft">
                  במשמרת הקודמת לא נשמרו תקנים מותאמים — יוחל תקן 1 כברירת מחדל.
                </p>
              ) : null}
              <ul className="flex flex-col gap-1.5">
            {selectableLanes.map((lane) => {
              const on = draft.activeLaneIds.includes(lane.id)
                  const std = effectiveStaffingStandard(
                    lane,
                    draft.staffingOverrides,
                  )
                  const overridden = std !== lane.staffingStandard
                  const certs = orderedCertChips(
                    data.certificationsCatalog,
                    lane.requiredCertifications,
                  )
              return (
                <li key={lane.id}>
                      <div
                        className={`flex min-h-14 w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 transition sm:gap-3 sm:px-3 ${
                          on
                            ? 'border-brand bg-brand/5 ring-1 ring-brand/25'
                            : 'border-line bg-card hover:border-brand/25'
                        }`}
                      >
                  <button
                    type="button"
                    onClick={() => {
                      if (on && hasFilledBoard) {
                        const hasPeople = draft.assignments
                          .find((a) => a.laneId === lane.id)
                          ?.workerIds.some(Boolean)
                        if (
                          hasPeople &&
                          !window.confirm(
                            `בנתיב «${lane.name}» יש משובצים. הסרה תוריד אותם מהלוח. להמשיך?`,
                          )
                        ) {
                          return
                        }
                      }
                      toggleLane(lane.id)
                    }}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-right focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          aria-pressed={on}
                  >
                    <span
                            className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${
                        on
                          ? 'border-brand bg-brand text-white'
                                : 'border-line bg-surface'
                      }`}
                            aria-hidden
                    >
                            {on ? <Check className="size-3" /> : null}
                    </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[13px] font-bold text-ink sm:text-sm">
                                {lane.name}
                              </span>
                        <IntensityBadge intensity={lane.intensity} />
                        </span>
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              {certs.length === 0 ? (
                                <span
                                  className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line"
                                  title="אין דרישת הסמכה"
                                >
                                  פתוח לכל הבודקים
                                </span>
                              ) : (
                                certs.map((c) => (
                                  <span
                                    key={c}
                                    className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line"
                                  >
                                    {c}
                                  </span>
                                ))
                              )}
                            </span>
                          </span>
                        </button>
                        <div
                          role="radiogroup"
                          aria-label={`תקן למשמרת עבור ${lane.name} (מקסימום ${lane.staffingStandard})`}
                          className={`flex shrink-0 flex-col items-end gap-0.5 ${
                            on ? '' : 'opacity-40'
                          }`}
                        >
                          <div className="inline-flex rounded-lg bg-surface p-0.5 ring-1 ring-line">
                            {staffingChoicesForLane(lane).map((n) => (
                              <button
                                key={n}
                                type="button"
                                role="radio"
                                aria-checked={std === n}
                                disabled={!on}
                                onClick={() =>
                                  setLaneStaffingStandard(lane.id, n)
                                }
                                className={`min-h-9 min-w-9 rounded-md text-[13px] font-bold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed ${
                                  std === n && on
                                    ? 'bg-brand text-white'
                                    : 'text-ink-soft'
                                }`}
                              >
                                {n}
                              </button>
                            ))}
                      </div>
                          {on && overridden ? (
                            <span className="text-[10px] font-medium text-accent">
                              עד {lane.staffingStandard} · נבחר {std}
                            </span>
                          ) : on ? (
                            <span className="text-[10px] text-ink-soft">
                              מקסימום {lane.staffingStandard}
                            </span>
                          ) : null}
                      </div>
                    </div>
                </li>
              )
            })}
          </ul>
            </>
          )}
        </section>
      )}

      {shiftStep === 'attendance' && (
        <section className="ui-panel-solid p-4 sm:rounded-2xl sm:p-5">
          {attendanceWorkers.length === 0 ? (
            <div className="ui-empty">
              <p className="ui-empty-title">אין בודקים פעילים</p>
              <p className="ui-empty-text">
                הוסיפו או הפעילו בודקים במאגר. מנהל בלבד לא מופיע בשיבוץ.
              </p>
              <button
                type="button"
                onClick={() => setView('workers')}
                className="ui-btn ui-btn-primary mt-2"
              >
                למאגר בודקים
              </button>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="ui-title">סימון נוכחות</h2>
                  <p className="mt-1 sticky top-0 z-10 text-[13px] font-semibold text-ink tabular-nums">
                    נוכחים: {draft.presentWorkerIds.length} מתוך{' '}
                    {attendanceWorkers.length}
                    {draft.gateManagerWorkerId
                      ? ' · כולל מנהל שער'
                      : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAllActiveWorkers(true)}
                    className="ui-btn ui-btn-secondary !py-1.5 text-xs"
                  >
                    כל הפעילים
                  </button>
                  <button
                    type="button"
                    disabled={!lastSameType}
                    title={
                      lastSameType
                        ? undefined
                        : 'אין משמרת שמורה קודמת מאותו סוג'
                    }
                    onClick={() => {
                      if (!lastSameType) return
                      applyPresentSelection(presentIdsFromShift(lastSameType), {
                        gateManagerWorkerId:
                          lastSameType.gateManagerWorkerId ?? null,
                      })
                    }}
                    className="ui-btn ui-btn-ghost !py-1.5 text-xs disabled:opacity-40"
                  >
                    כמו במשמרת הקודמת
                  </button>
                  {morningShift?.gateManagerWorkerId &&
                  draft.gateManagerWorkerId !==
                    morningShift.gateManagerWorkerId ? (
                    <button
                      type="button"
                      onClick={() =>
                        setGateManager(morningShift.gateManagerWorkerId!)
                      }
                      className="ui-btn ui-btn-secondary !py-1.5 text-xs"
                      title="העדפה כמו לילה: המשך מנהל שער מהבוקר"
                    >
                      מנהל שער מהבוקר
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setAllActiveWorkers(false)}
                    className="ui-btn ui-btn-ghost !py-1.5 text-xs"
                  >
                    ניקוי
                  </button>
                </div>
              </div>
              <div className="relative mb-3">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
                  aria-hidden
                />
                <input
                  type="search"
                  value={attendanceQuery}
                  onChange={(e) => setAttendanceQuery(e.target.value)}
                  placeholder="חיפוש לפי שם"
                  aria-label="חיפוש בודקים"
                  className="ui-field w-full pe-3 ps-10"
                />
              </div>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {filteredAttendance.map((w) => {
                  const on = draft.presentWorkerIds.includes(w.id)
                  const isGate = draft.gateManagerWorkerId === w.id
                  const certs = orderedCertChips(
                    data.certificationsCatalog,
                    w.certifications,
                  )
                  const nightRec =
                    shiftFollowsMorning(draft.shiftType) &&
                    needsAfternoonNightRecovery(
                      w.id,
                      data.history,
                      draft.date,
                      draft.shiftType,
                    )
                  const wasMorning =
                    Boolean(morningShift?.presentWorkerIds.includes(w.id))
                  const wasMorningGate =
                    morningShift?.gateManagerWorkerId === w.id
                  const managerOnly = w.isManager && !w.isInspector
                  return (
                    <li key={w.id} className="min-w-0">
                      <div
                        className={`flex w-full flex-col rounded-xl border transition ${
                          on || isGate
                            ? 'border-brand bg-brand/5 ring-1 ring-brand/30'
                            : 'border-line bg-card'
                        }`}
                      >
                        <div className="flex min-h-14 items-stretch gap-1 sm:gap-1.5">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          disabled={managerOnly}
                          title={
                            managerOnly
                              ? 'מנהל בלבד — הפעילו «מנהל שער» כדי לכלול במשמרת'
                              : undefined
                          }
                          onClick={() => {
                            if (managerOnly) return
                            toggleWorker(w.id)
                          }}
                          onKeyDown={(e) => {
                            if (managerOnly) return
                            if (e.key === ' ') {
                              e.preventDefault()
                              toggleWorker(w.id)
                            }
                          }}
                          className={`flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-right focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:px-3 ${
                            managerOnly ? 'cursor-default opacity-90' : ''
                          }`}
                        >
                          <span
                            className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${
                              on || (managerOnly && isGate)
                                ? 'border-brand bg-brand text-white'
                                : 'border-line bg-surface'
                            } ${managerOnly && !isGate ? 'opacity-40' : ''}`}
                            aria-hidden
                          >
                            {on || (managerOnly && isGate) ? (
                              <Check className="size-3" />
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[13px] font-semibold text-ink sm:text-sm">
                                {w.fullName}
                              </span>
                              {w.isManager ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-bold text-ink-soft ring-1 ring-line">
                                  מנהל
                                </span>
                              ) : null}
                              {nightRec ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn ring-1 ring-warn/20">
                                  <Moon className="size-3" aria-hidden />
                                  יצא מלילה אתמול
                                </span>
                              ) : null}
                              {wasMorningGate ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-bold text-brand ring-1 ring-brand/25">
                                  <Shield className="size-3" aria-hidden />
                                  מנהל שער בבוקר
                                </span>
                              ) : wasMorning ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent ring-1 ring-accent/20">
                                  <Sun className="size-3" aria-hidden />
                                  היה בבוקר היום
                                </span>
                              ) : null}
                            </span>
                            {w.isInspector ? (
                              <span className="mt-0.5 flex flex-wrap gap-1">
                                {certs.length === 0 ? (
                                  <span className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line">
                                    ללא הסמכה
                                  </span>
                                ) : (
                                  certs.map((c) => (
                                    <span
                                      key={c}
                                      className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line"
                                    >
                                      {c}
                                    </span>
                                  ))
                                )}
                              </span>
                            ) : (
                              <span className="mt-0.5 text-[11px] text-ink-soft">
                                ישובץ אוטומטית לעמדת מנהל שער
                              </span>
                            )}
                          </span>
                        </button>
                        {w.isManager ? (
                          <button
                            type="button"
                            aria-pressed={isGate}
                            onClick={(e) => {
                              e.stopPropagation()
                              setGateManager(isGate ? null : w.id)
                            }}
                            className={`m-1.5 flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-[10px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                              isGate
                                ? 'bg-brand text-white shadow-sm'
                                : 'bg-surface text-ink-soft ring-1 ring-line hover:bg-brand/10 hover:text-brand'
                            }`}
                            title={
                              isGate
                                ? 'בטל מנהל שער'
                                : 'הפעל כמנהל שער (שיבוץ אוטומטי לעמדה)'
                            }
                          >
                            <Shield className="size-3.5" aria-hidden />
                            מנהל שער
                          </button>
                        ) : null}
                        </div>
                        {on ? (
                          <div
                            className="flex w-full min-w-0 gap-1 overflow-x-auto px-2.5 pb-2"
                            role="group"
                            aria-label={`שעות של ${w.fullName}`}
                          >
                            <button
                              type="button"
                              onClick={() => setWorkerWindow(w.id, null)}
                              className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold ${
                                !draft.workerWindows?.[w.id]
                                  ? 'bg-brand text-white'
                                  : 'bg-surface text-ink-soft ring-1 ring-line'
                              }`}
                            >
                              כל המשמרת
                            </button>
                            {WORKER_WINDOWS.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() =>
                                  setWorkerWindow(w.id, preset.id)
                                }
                                className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold ${
                                  draft.workerWindows?.[w.id] === preset.id
                                    ? 'bg-brand text-white'
                                    : 'bg-surface text-ink-soft ring-1 ring-line'
                                }`}
                              >
                                <Ltr>{preset.label}</Ltr>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {/* Sticky feasibility + actions (steps 1–2) */}
      {(shiftStep === 'lanes' || shiftStep === 'attendance') && (
        <div className="fixed inset-x-0 bottom-16 z-40 border-t border-line/80 bg-card/95 px-3 py-2.5 shadow-[0_-8px_24px_rgb(15_28_46/0.08)] backdrop-blur-md no-print sm:px-4 lg:bottom-0">
          <div className="mx-auto flex max-w-7xl flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                onClick={() => setFeasibilityOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                aria-expanded={feasibilityOpen}
              >
                בדיקה מקדימה
                {feasibility.insufficientCount > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-hard-soft px-1.5 py-0.5 text-[11px] font-bold text-hard">
                    <CircleAlert className="size-3" aria-hidden />
                    חוסר
                  </span>
                ) : feasibility.tightCount > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-bold text-warn">
                    <AlertTriangle className="size-3" aria-hidden />
                    הדוק
                  </span>
                ) : draft.activeLaneIds.length > 0 &&
                  draft.presentWorkerIds.length > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-ok-soft px-1.5 py-0.5 text-[11px] font-bold text-ok">
                    <CheckCircle2 className="size-3" aria-hidden />
                    תקין
                  </span>
                ) : null}
                {feasibilityOpen ? (
                  <ChevronDown className="size-3.5" aria-hidden />
                ) : (
                  <ChevronUp className="size-3.5" aria-hidden />
                  )}
                </button>
              <p className="text-[12px] text-ink-soft tabular-nums">
                נוכחים {feasibility.present} · תקן {feasibility.totalStandard}
                {deficitMessage(feasibility)
                  ? ` · ${deficitMessage(feasibility)}`
                  : ''}
              </p>
              </div>
            {feasibilityOpen ? (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-line bg-surface/80 p-2 text-[12px] text-ink-soft">
                {/* Per-lane K>=standard is necessary but not sufficient (shared qualified inspectors). */}
                <p className="mb-1.5 text-[11px] text-ink-soft/90">
                  בדיקה מקדימה בלבד — אינה מבטיחה שיבוץ מלא (בודק מוסמך יכול
                  להיספר לכמה נתיבים).
                </p>
                {feasibility.lanes.length === 0 ? (
                  <p>בחרו נתיבים ונוכחות כדי לראות כיסוי.</p>
                ) : (
                  <ul className="space-y-1">
                    {feasibility.lanes.map((row) => (
                      <li
                        key={row.laneId}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span className="font-semibold text-ink">
                          {row.laneName}
                        </span>
                        <span className="tabular-nums">
                          מוסמכים {row.qualified}/{row.standard}
                        </span>
                        {row.status === 'insufficient' ? (
                          <span className="inline-flex items-center gap-1 text-hard">
                            <CircleAlert className="size-3" aria-hidden />
                            חסר
                          </span>
                        ) : row.status === 'tight' ? (
                          <span className="inline-flex items-center gap-1 text-warn">
                            <AlertTriangle className="size-3" aria-hidden />
                            הדוק
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-ok">
                            <CheckCircle2 className="size-3" aria-hidden />
                            תקין
                          </span>
                        )}
                        {row.messages.map((m) => (
                          <span key={m} className="w-full text-hard">
                            {m}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
              )}
            </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {shiftStep === 'attendance' ? (
                <button
                  type="button"
                  onClick={() => setShiftStep('lanes')}
                  className="ui-btn ui-btn-ghost !py-2"
                >
                  <ChevronRight className="size-4" aria-hidden />
                  הקודם
                </button>
              ) : (
                <span className="min-w-[4.5rem]" />
              )}
              <span className="flex-1 text-[12px] text-ink-soft">
                {shiftStep === 'lanes' && !lanesAdvance.ok
                  ? lanesAdvance.reason
                  : shiftStep === 'attendance' && !attendanceAdvance.ok
                    ? attendanceAdvance.reason
                    : null}
              </span>
              {shiftStep === 'lanes' ? (
              <button
                type="button"
                  disabled={!lanesAdvance.ok}
                  title={lanesAdvance.reason ?? undefined}
                  onClick={() => setShiftStep('attendance')}
                  className="ui-btn ui-btn-primary !py-2 disabled:opacity-40"
                >
                  המשך
                  <ChevronLeft className="size-4" aria-hidden />
              </button>
              ) : hasFilledBoard ? (
                <>
                  <button
                    type="button"
                    disabled={!attendanceAdvance.ok}
                    title={attendanceAdvance.reason ?? undefined}
                    onClick={() => setShiftStep('board')}
                    className="ui-btn ui-btn-primary !py-2 disabled:opacity-40"
                  >
                    חזרה ללוח
                    <ChevronLeft className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={!attendanceAdvance.ok}
                    title={
                      attendanceAdvance.reason ??
                      'ינקה את הלוח הקיים ויאפשר שיבוץ ידני מחדש'
                    }
                    onClick={handleManualAssign}
                    className="ui-btn ui-btn-ghost !py-2 disabled:opacity-40"
                  >
                    <Hand className="size-4" aria-hidden />
                    שיבוץ ידני מחדש
                  </button>
                  <button
                    type="button"
                    disabled={!attendanceAdvance.ok}
                    title={
                      attendanceAdvance.reason ??
                      'יחליף את כל השיבוצים בלוח'
                    }
                    onClick={handleAutoAssign}
                    className="ui-btn ui-btn-ghost !py-2 disabled:opacity-40"
                  >
                    <Sparkles className="size-4" aria-hidden />
                    שיבוץ אוטומטי מחדש
                  </button>
                </>
              ) : (
                                <>
                                  <button
                                    type="button"
                    disabled={!attendanceAdvance.ok}
                    title={attendanceAdvance.reason ?? undefined}
                    onClick={handleManualAssign}
                    className="ui-btn ui-btn-secondary !py-2 disabled:opacity-40"
                  >
                    <Hand className="size-4" aria-hidden />
                    שבץ ידני
                                  </button>
                                  <button
                                    type="button"
                    disabled={!attendanceAdvance.ok}
                    title={attendanceAdvance.reason ?? undefined}
                    onClick={handleAutoAssign}
                    className="ui-btn ui-btn-primary !py-2 disabled:opacity-40"
                  >
                    <Sparkles className="size-4" aria-hidden />
                    שבץ אוטומטית
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
              </div>
            )}

      {discardOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4 no-print"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setDiscardOpen(false)
              discardTriggerRef.current?.focus()
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="discard-draft-title"
            className="w-full max-w-md rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-panel-hover)] sm:p-5"
          >
            <h3
              id="discard-draft-title"
              className="font-display text-base font-bold text-ink"
            >
              ביטול טיוטה
                  </h3>
            <div className="mt-2 space-y-2 text-[13px] text-ink-soft">
              <p>הטיוטה תימחק מהמכשיר ולא ניתן לשחזר אותה. יימחקו:</p>
              <ul className="list-disc space-y-1 pe-5">
                <li>
                  תאריך ומשמרת:{' '}
                  <Ltr>{formatSetupDateLine(draft.date)}</Ltr> ·{' '}
                  {SHIFT_TYPE_LABELS[draft.shiftType]}
                </li>
                <li>
                  {pluralizeHe(draft.activeLaneIds.length, {
                    one: 'נתיב נבחר אחד',
                    two: 'שני נתיבים נבחרים',
                    many: 'נתיבים נבחרים',
                  })}
                </li>
                <li>
                  {pluralizeHe(draft.presentWorkerIds.length, {
                    one: 'נוכח אחד',
                    two: 'שני נוכחים',
                    many: 'נוכחים',
                  })}
                </li>
                {draft.assignments.some((a) => a.workerIds.some(Boolean)) ? (
                  <li>שיבוצים בלוח (אם כבר נוצרו)</li>
                ) : null}
                        </ul>
                      </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setDiscardOpen(false)
                  discardTriggerRef.current?.focus()
                }}
                className="ui-btn ui-btn-secondary min-h-10"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={() => {
                  setDiscardOpen(false)
                  discardDraft()
                }}
                className="ui-btn ui-btn-danger min-h-10"
              >
                ביטול טיוטה
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {shiftStep === 'board' && draft.audience === 'selector' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-ink sm:text-lg">
                שיבוץ סלקטורים
              </h2>
              <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-soft">
                שורות לפי שעות, כל שעתיים מתחילת המשמרת. עמודות לפי נתיבים. בכל תא בוחרים סלקטור, והשיבוץ האוטומטי מסובב אותם בין הנתיבים.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShiftStep('attendance')}
                className="ui-btn ui-btn-ghost"
              >
                חזרה לנוכחות
              </button>
              <button
                type="button"
                onClick={() => void exportSelectorBoard('whatsapp')}
                className="ui-btn ui-btn-secondary gap-2"
              >
                <MessageCircle className="size-4" aria-hidden />
                וואטסאפ
              </button>
              <button
                type="button"
                onClick={() => void exportSelectorBoard('download')}
                className="ui-btn ui-btn-secondary gap-2"
              >
                <Download className="size-4" aria-hidden />
                ייצוא
              </button>
              <button
                type="button"
                onClick={handleAutoAssign}
                className="ui-btn ui-btn-secondary gap-2"
              >
                <Sparkles className="size-4" aria-hidden />
                שיבוץ אוטומטי
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                className="ui-btn ui-btn-primary"
              >
                שמירה
              </button>
            </div>
          </div>
          {draft.warnings.length > 0 ? (
            <ul className="list-disc space-y-1 rounded-xl border border-warn/25 bg-warn-soft/80 px-4 py-2.5 text-[13px] text-warn pe-8">
              {draft.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <SelectorRoundTable
            rounds={draft.rounds ?? []}
            lanes={selectorLanes(data.lanes, draft.activeLaneIds)}
            workers={data.workers.filter((w) =>
              draft.presentWorkerIds.includes(w.id),
            )}
            overrides={draft.staffingOverrides}
            editable
            onChange={updateSelectorCell}
          />
        </div>
      ) : null}

      {shiftStep === 'board' && draft.audience !== 'selector' && (
        <BoardStep
          draft={draft}
          data={data}
          morningCtx={morningCtx}
          exportLines={exportLines}
          unassignedNames={unassignedNames}
          slotConflict={slotConflict}
          saveFlash={saveFlash}
          lastSavedAt={lastSavedAt}
          baselineKey={boardBaselineKey}
          requestExplainModal={requestExplainModal}
          onClearExplainRequest={() => setRequestExplainModal(false)}
          onSave={handleSave}
          onReassign={handleAutoAssign}
          onEditSettings={() => setShiftStep('lanes')}
          onRequestDiscard={() => setDiscardOpen(true)}
          onOpenExtraPick={(laneId, workerId) => {
            setPickLaneId(laneId ?? draft.activeLaneIds[0] ?? '')
            setPickWorkerId(workerId ?? draft.unassignedWorkerIds[0] ?? '')
            setExtraFlow('pick')
          }}
          onBackToAttendance={() => setShiftStep('attendance')}
          onExplainModalOpenChange={setExplainModalOpen}
        />
      )}

      {extraFlow !== 'closed' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md animate-fade-up rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5"
          >
            <div className="mb-2.5 flex items-start justify-between gap-3 sm:mb-3">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-xl bg-accent-soft text-accent sm:size-9">
                  <UserPlus className="size-4 sm:size-5" />
                </span>
                <h3 className="font-display text-base font-bold text-ink sm:text-lg">
                  בודקים עודפים
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setExtraFlow('closed')}
                className="rounded-lg p-1.5 text-ink-soft hover:bg-surface"
                aria-label="סגור"
              >
                <X className="size-4" />
              </button>
            </div>

            {extraFlow === 'ask' && (
              <>
                <p className="text-xs leading-relaxed text-ink-soft sm:text-sm">
                  יש יותר בודקים (
                  {
                    laneStaffPresentIds(
                      draft.presentWorkerIds,
                      draft.gateManagerWorkerId,
                    ).length
                  }
                  ) ממספר הנתיבים
                  שנבחרו ({draft.activeLaneIds.length}), ונותרו{' '}
                  {draft.unassignedWorkerIds.length} שלא שובצו.
                  <br />
                  האם תרצה להוסיף בודק לעמדה נוספת?
                </p>
                {(draft.explanations?.length ?? 0) > 0 && (
                  <p className="mt-2 rounded-lg bg-accent-soft px-2.5 py-2 text-[11px] font-medium text-accent sm:text-xs">
                    אפשר תמיד לפתוח שוב את «הסבר השיבוץ» מלוח השיבוץ.
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2 sm:mt-5">
                  <button
                    type="button"
                    onClick={() => setExtraFlow('pick')}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-3.5 py-2 text-xs font-bold text-white sm:px-4 sm:py-2.5 sm:text-sm"
                  >
                    כן, הוסף לעמדה
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtraFlow('closed')}
                    className="rounded-xl px-3.5 py-2 text-xs font-medium text-ink-soft hover:bg-surface sm:px-4 sm:py-2.5 sm:text-sm"
                  >
                    לא תודה
                  </button>
                </div>
              </>
            )}

            {extraFlow === 'pick' && (
              <>
                <p className="mb-3 text-xs text-ink-soft sm:mb-4 sm:text-sm">
                  בחר נתיב ובודק להוספה מעבר לתקן העמדה
                </p>
                <div className="space-y-3">
                  <label className="block text-xs sm:text-sm">
                    <span className="mb-1 block text-ink-soft">עמדה / נתיב</span>
                    <select
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs sm:py-2.5 sm:text-sm"
                      value={pickLaneId}
                      onChange={(e) => {
                        setPickLaneId(e.target.value)
                        setPickWorkerId('')
                      }}
                    >
                      {draft.activeLaneIds.map((id) => {
                        const lane = data.lanes.find((l) => l.id === id)
                        return (
                          <option key={id} value={id}>
                            {lane?.name ?? id}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                  <label className="block text-xs sm:text-sm">
                    <span className="mb-1 block text-ink-soft">בודק להוספה</span>
                    <select
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs sm:py-2.5 sm:text-sm"
                      value={pickWorkerId}
                      onChange={(e) => setPickWorkerId(e.target.value)}
                    >
                      <option value="">— בחר בודק —</option>
                      {unassignedWorkers.map(
                        (w) =>
                          w && (
                            <option key={w.id} value={w.id}>
                              {w.fullName}
                              {!pickLane || isQualified(w, pickLane)
                                ? ''
                                : ' (ללא הסמכה מלאה)'}
                            </option>
                          ),
                      )}
                    </select>
                  </label>
                  {pickLane &&
                    pickWorkerId &&
                    (() => {
                      const w = data.workers.find((x) => x.id === pickWorkerId)
                      return w && !isQualified(w, pickLane) ? (
                        <p className="text-[11px] text-warn sm:text-xs">
                          שימו לב: לבודק זה חסרה הסמכה מלאה לנתיב שנבחר.
                        </p>
                      ) : null
                    })()}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 sm:mt-5">
                  <button
                    type="button"
                    disabled={!pickLaneId || !pickWorkerId}
                    onClick={confirmExtraAdd}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
                  >
                    <UserPlus className="size-3.5 sm:size-4" />
                    הוסף לשיבוץ
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtraFlow('closed')}
                    className="rounded-xl px-3.5 py-2 text-xs font-medium text-ink-soft hover:bg-surface sm:px-4 sm:py-2.5 sm:text-sm"
                  >
                    ביטול
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
