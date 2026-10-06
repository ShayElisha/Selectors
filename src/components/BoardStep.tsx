import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Save,
  Shield,
  Sparkles,
  StickyNote,
  Trash2,
  UserMinus,
  UserX,
  X,
  Lock,
} from 'lucide-react'
import {
  afternoonHandoffTier,
  isQualified,
  type SameDayMorningContext,
} from '../algorithm'
import {
  AssignmentExplainDialog,
  groupExplanations,
} from './AssignmentExplainDialog'
import { IntensityBadge, Ltr } from './ui'
import { SHIFT_TYPE_LABELS, shiftSlotConflictMessage } from '../constants'
import type { ShiftDraft } from '../context/AppContext'
import {
  boardsEqual,
  countAssignmentChanges,
  formatOptimizationInfo,
  LANE_NOTE_MAX_LENGTH,
  missingCertsForLane,
  partitionWarnings,
  snapshotBoard,
  staffingChipKind,
  validateBoard,
  type BoardSnapshot,
} from '../lib/boardHelpers'
import {
  buildWhatsAppText,
  downloadBoardImage,
  openWhatsAppShare,
  shareBoardImage,
  type ExportLaneLine,
} from '../lib/export'
import { exportBlockedReason } from '../lib/exportGate'
import { pluralizeHe } from '../lib/hebrew'
import { ShiftDropDialog, ShiftDropSummary } from './ShiftDropDialog'
import { activeAttendanceWorkers, isGateManagerLane, managedLanes } from '../lib/gateManager'
import { notify } from '../lib/notify'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import { postAuditEvent } from '../api'
import { formatSetupDateLine, shiftWindowDisplay } from '../lib/shiftWizard'
import { useApp } from '../context/AppContext'
import type { AppData, LaneAssignment, ShiftType, Worker } from '../types'

export interface BoardStepProps {
  draft: ShiftDraft
  data: AppData
  morningCtx: SameDayMorningContext | null
  exportLines: ExportLaneLine[]
  unassignedNames: string[]
  slotConflict: { id: string; date: string; shiftType: ShiftType } | null
  saveFlash: boolean
  lastSavedAt: Date | null
  baselineKey: number
  requestExplainModal: boolean
  onClearExplainRequest: () => void
  onSave: () => void | Promise<void>
  onSignOff?: () => void
  onCompare?: () => void
  onReassign: () => void
  onEditSettings: () => void
  onRequestDiscard: () => void
  onOpenExtraPick: (laneId?: string, workerId?: string) => void
  onBackToAttendance: () => void
  onExplainModalOpenChange?: (open: boolean) => void
}

function placeFloatingMenu(anchor: HTMLElement, width: number) {
  const rect = anchor.getBoundingClientRect()
  let left = rect.left
  if (left + width > window.innerWidth - 8) left = rect.right - width
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
  let top = rect.bottom + 4
  const estimatedHeight = 88
  if (top + estimatedHeight > window.innerHeight - 8) {
    top = Math.max(8, rect.top - estimatedHeight - 4)
  }
  return { top, left }
}

function workerLaneNameElsewhere(
  workerId: string,
  assignments: LaneAssignment[],
  lanes: AppData['lanes'],
  exceptLaneId: string,
): string | null {
  for (const a of assignments) {
    if (a.laneId === exceptLaneId) continue
    if (a.workerIds.includes(workerId)) {
      return lanes.find((l) => l.id === a.laneId)?.name ?? a.laneId
    }
  }
  return null
}

export function BoardStep({
  draft,
  data,
  morningCtx,
  exportLines,
  unassignedNames,
  slotConflict,
  saveFlash,
  lastSavedAt,
  baselineKey,
  requestExplainModal,
  onClearExplainRequest,
  onSave,
  onSignOff,
  onCompare,
  onReassign,
  onEditSettings: _onEditSettings,
  onRequestDiscard,
  onOpenExtraPick,
  onBackToAttendance,
  onExplainModalOpenChange,
}: BoardStepProps) {
  const {
    updateAssignment,
    swapAssignments,
    beginRemoval,
    recordShiftDrop,
    undoShiftDrop,
    addBoardLane,
    toggleWorker,
    replaceLeavingWorker,
    removeLaneFromShift,
    addSlotToLane,
    updateLaneNotes,
    user,
    draftDirty,
    restoreDraftSnapshot,
  } = useApp()

  const draftRef = useRef(draft)
  draftRef.current = draft

  const runWithUndo = useCallback(
    (message: string, action: () => void) => {
      const current = draftRef.current
      if (!current || current.signOff?.signedAt) {
        action()
        return
      }
      const snapshot = JSON.parse(JSON.stringify(current)) as typeof current
      action()
      notify.undoable(message, () => restoreDraftSnapshot(snapshot))
    },
    [restoreDraftSnapshot],
  )

  const [boardBaseline, setBoardBaseline] = useState<BoardSnapshot>(() =>
    snapshotBoard(draft.assignments),
  )
  const [healthOpen, setHealthOpen] = useState(false)
  const [explainModalOpen, setExplainModalOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [dropWorkerId, setDropWorkerId] = useState<string | null>(null)
  const [addPicker, setAddPicker] = useState<'lane' | 'worker' | null>(null)
  const [summaryMenuOpen, setSummaryMenuOpen] = useState(false)
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(() => new Set())
  const [swapTarget, setSwapTarget] = useState<{
    laneId: string
    slotIndex: number
    workerId: string
  } | null>(null)
  const [leaveTarget, setLeaveTarget] = useState<{
    laneId: string
    workerId: string
  } | null>(null)

  const explainTriggerRef = useRef<HTMLButtonElement | null>(null)
  const shareRootRef = useRef<HTMLDivElement | null>(null)
  const summaryMenuRef = useRef<HTMLDivElement | null>(null)
  const summaryBtnRef = useRef<HTMLButtonElement | null>(null)
  const summaryPanelRef = useRef<HTMLDivElement | null>(null)
  const [summaryPos, setSummaryPos] = useState<{ top: number; left: number } | null>(
    null,
  )

  const currentSnapshot = useMemo(
    () => snapshotBoard(draft.assignments),
    [draft.assignments],
  )
  const boardDirty = !boardsEqual(boardBaseline, currentSnapshot)
  const historyIds = useMemo(
    () => data.history.map((h) => h.id),
    [data.history],
  )
  const exportBlock = useMemo(
    () =>
      exportBlockedReason({
        draftId: draft.id,
        historyIds,
        draftDirty,
        boardDirty,
      }),
    [draft.id, historyIds, draftDirty, boardDirty],
  )

  useEffect(() => {
    setBoardBaseline(snapshotBoard(draft.assignments))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when parent bumps baselineKey
  }, [baselineKey])

  useEffect(() => {
    if (!requestExplainModal) return
    if ((draft.explanations?.length ?? 0) > 0) {
      setExplainModalOpen(true)
    }
    onClearExplainRequest()
  }, [requestExplainModal, draft.explanations, onClearExplainRequest])

  useEffect(() => {
    if (explainModalOpen && (draft.explanations?.length ?? 0) === 0) {
      setExplainModalOpen(false)
    }
  }, [explainModalOpen, draft.explanations])

  useEffect(() => {
    onExplainModalOpenChange?.(explainModalOpen)
  }, [explainModalOpen, onExplainModalOpenChange])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!boardDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [boardDirty])

  useEffect(() => {
    if (!shareOpen && !summaryMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (shareOpen && shareRootRef.current && !shareRootRef.current.contains(e.target as Node)) {
        setShareOpen(false)
      }
      if (
        summaryMenuOpen &&
        summaryMenuRef.current &&
        !summaryMenuRef.current.contains(e.target as Node) &&
        !summaryPanelRef.current?.contains(e.target as Node)
      ) {
        setSummaryMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShareOpen(false)
        setSummaryMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [shareOpen, summaryMenuOpen])

  useLayoutEffect(() => {
    if (!summaryMenuOpen) {
      setSummaryPos(null)
      return
    }
    const place = () => {
      const anchor = summaryBtnRef.current
      if (!anchor) return
      setSummaryPos(placeFloatingMenu(anchor, 176))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [summaryMenuOpen])

  const showToast = useCallback((msg: string) => {
    notify.success(msg)
  }, [])

  const explanationGroups = useMemo(
    () => groupExplanations(draft.explanations ?? [], data.lanes, data.workers),
    [draft.explanations, data.lanes, data.workers],
  )

  const partitioned = useMemo(
    () => partitionWarnings(draft.warnings),
    [draft.warnings],
  )

  const boardIssues = useMemo(
    () =>
      validateBoard({
        assignments: draft.assignments,
        lanes: data.lanes,
        workers: data.workers,
        history: data.history,
        date: draft.date,
        shiftType: draft.shiftType,
        overrides: draft.staffingOverrides,
      }),
    [draft, data],
  )

  const optimizationInfo = useMemo(() => {
    for (const w of partitioned.info) {
      const formatted = formatOptimizationInfo(w)
      if (formatted) return formatted
    }
    return null
  }, [partitioned.info])

  const healthItems = useMemo(() => {
    const items: {
      severity: 'error' | 'warning'
      message: string
      laneId?: string
    }[] = []
    for (const m of partitioned.errors) {
      items.push({ severity: 'error', message: m })
    }
    for (const m of partitioned.warnings) {
      items.push({ severity: 'warning', message: m })
    }
    for (const issue of boardIssues) {
      items.push({
        severity: issue.severity,
        message: issue.message,
        laneId: issue.laneId,
      })
    }
    if (slotConflict) {
      items.push({
        severity: 'error',
        message: shiftSlotConflictMessage(draft.date, draft.shiftType),
      })
    }
    return items
  }, [partitioned, boardIssues, slotConflict, draft.date, draft.shiftType])

  const hasBoardErrors = boardIssues.some((i) => i.severity === 'error')
  const locked = Boolean(draft.signOff?.signedAt)
  const saveBlocked =
    Boolean(slotConflict) ||
    draft.unassignedWorkerIds.length > 0 ||
    hasBoardErrors
  const saveBlockedReason = slotConflict
    ? 'כבר קיים שיבוץ לאותו תאריך ומשמרת'
    : draft.unassignedWorkerIds.length > 0
      ? `יש ${draft.unassignedWorkerIds.length} בודקים שלא שובצו — שבצו את כולם לפני השמירה`
      : hasBoardErrors
        ? 'יש שגיאות בלוח שצריך לתקן לפני השמירה'
        : null

  const trySave = () => {
    if (saveBlockedReason) {
      notify.error('לא ניתן לשמור', saveBlockedReason)
      return
    }
    void onSave()
  }

  const trySignOff = () => {
    if (saveBlockedReason) {
      notify.error(
        'לא ניתן לסגור משמרת',
        saveBlockedReason === 'יש שגיאות בלוח שצריך לתקן לפני השמירה'
          ? 'יש שגיאות בלוח שצריך לתקן לפני הסגירה'
          : saveBlockedReason.includes('לא שובצו')
            ? 'אפשר לסגור רק כשכולם משובצים'
            : saveBlockedReason,
      )
      return
    }
    onSignOff?.()
  }

  const handoffOptionLabel = (workerId: string, fullName: string, laneId: string) => {
    if (!morningCtx?.found) return fullName
    const tier = afternoonHandoffTier(workerId, laneId, morningCtx)
    if (tier === 0) return `${fullName} · צהריים בלבד`
    if (tier === 1) return `${fullName} · ממשיך (היה כאן בבוקר)`
    return `${fullName} · ממשיך מבוקר`
  }

  const handleSelectWorker = (
    laneId: string,
    slotIndex: number,
    workerId: string | null,
  ) => {
    if (locked) return
    if (!workerId) {
      const seated =
        draft.assignments.find((row) => row.laneId === laneId)?.workerIds[slotIndex]
      if (seated) {
        runWithUndo('הוסרה ישיבה מהנתיב', () => beginRemoval(seated))
        return
      }
    }
    if (workerId) {
      const other = workerLaneNameElsewhere(
        workerId,
        draft.assignments,
        data.lanes,
        laneId,
      )
      if (other) {
        const name =
          data.workers.find((w) => w.id === workerId)?.fullName ?? workerId
        showToast(`${name} הועבר/ה מנתיב ${other}`)
      }
    }
    runWithUndo(
      workerId ? 'השיבוץ עודכן' : 'השיבוץ נוקה',
      () => updateAssignment(laneId, slotIndex, workerId),
    )
  }

  const scrollToLane = (laneId: string) => {
    document
      .getElementById(`board-lane-${laneId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const confirmReassign = () => {
    const changes = countAssignmentChanges(boardBaseline, currentSnapshot)
    const filled = currentSnapshot.assignments.reduce(
      (n, a) => n + a.workerIds.filter(Boolean).length,
      0,
    )
    if (changes > 0 || filled > 0) {
      const ok = window.confirm(
        changes > 0
          ? `יש ${changes} שינויים שלא נשמרו בלוח. שיבוץ מחדש יחליף את הלוח הנוכחי. להמשיך?`
          : 'שיבוץ מחדש יחליף את כל השיבוצים הקיימים בלוח. להמשיך?',
      )
      if (!ok) return
    }
    runWithUndo('שיבוץ מחדש', () => onReassign())
  }

  const gateManagerName = useMemo(() => {
    const id = draft.gateManagerWorkerId
    if (!id) return undefined
    return data.workers.find((w) => w.id === id)?.fullName ?? id
  }, [draft.gateManagerWorkerId, data.workers])

  const runShare = async (mode: 'whatsapp' | 'download') => {
    if (exportBlock) {
      notify.error('לא ניתן לייצא', exportBlock)
      setShareOpen(false)
      return
    }
    setShareBusy(true)
    const meta = {
      preparedBy: user?.fullName,
      organizationName: user?.orgName || undefined,
      ...(gateManagerName ? { gateManagerName } : {}),
    }
    try {
      if (mode === 'download') {
        await downloadBoardImage(
          draft.date,
          draft.shiftType,
          exportLines,
          unassignedNames,
          undefined,
          meta,
        )
        void postAuditEvent(
          'export_board',
          `${draft.date} · ${SHIFT_TYPE_LABELS[draft.shiftType]} · ייצוא מסמך · ${exportLines.length} נתיבים`,
        )
        notify.success('המסמך יוצא בהצלחה')
      } else {
        const text = buildWhatsAppText(
          draft.date,
          draft.shiftType,
          exportLines.map((l) => ({
            laneName: l.laneName,
            workers: l.workers,
            notes: l.notes,
          })),
          gateManagerName ? { gateManagerName } : undefined,
        )
        const shareMode = await shareBoardImage(
          draft.date,
          draft.shiftType,
          exportLines,
          unassignedNames,
          meta,
          text,
        )
        void postAuditEvent(
          'export_board',
          `${draft.date} · ${SHIFT_TYPE_LABELS[draft.shiftType]} · שיתוף WhatsApp (${shareMode}) · ${exportLines.length} נתיבים`,
        )
        if (shareMode === 'text') openWhatsAppShare(text)
        notify.success('השיתוף הוכן')
      }
    } catch {
      notify.error(
        mode === 'download'
          ? 'ייצוא המסמך נכשל. נסו שוב.'
          : 'שיתוף המסמך נכשל.',
      )
      if (mode === 'whatsapp') {
        const text = buildWhatsAppText(
          draft.date,
          draft.shiftType,
          exportLines.map((l) => ({
            laneName: l.laneName,
            workers: l.workers,
            notes: l.notes,
          })),
          gateManagerName ? { gateManagerName } : undefined,
        )
        openWhatsAppShare(text)
      }
    }     finally {
      setShareBusy(false)
      setShareOpen(false)
    }
  }

  const saveStatusText = saveFlash
    ? lastSavedAt
      ? `נשמר · ${lastSavedAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
      : 'נשמר'
    : boardDirty
      ? 'שינויים שלא נשמרו'
      : lastSavedAt
        ? `נשמר · ${lastSavedAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
        : 'טרם נשמר'

  const renderWorkerSelect = (
    lane: (typeof data.lanes)[number],
    laneId: string,
    slotIndex: number,
    workerId: string,
    std: number,
  ) => {
    const present = data.workers.filter(
      (w) => draft.presentWorkerIds.includes(w.id) && w.isInspector,
    )
    const options = present
      .slice()
      .sort((a, b) => {
        const qa = isQualified(a, lane) ? 0 : 1
        const qb = isQualified(b, lane) ? 0 : 1
        if (qa !== qb) return qa - qb
        if (lane.afternoonHandoff && draft.shiftType === 'afternoon') {
          const ta = afternoonHandoffTier(a.id, laneId, morningCtx)
          const tb = afternoonHandoffTier(b.id, laneId, morningCtx)
          if (ta !== tb) return ta - tb
        }
        return a.fullName.localeCompare(b.fullName, 'he')
      })

    const isExtra = slotIndex >= std
    const selectedWorker = workerId
      ? data.workers.find((w) => w.id === workerId)
      : null
    const selectedLacksCert =
      selectedWorker != null && !isQualified(selectedWorker, lane)

    const optionLabel = (w: Worker) => {
      const elsewhere = workerLaneNameElsewhere(
        w.id,
        draft.assignments,
        data.lanes,
        laneId,
      )
      let label =
        lane.afternoonHandoff && draft.shiftType === 'afternoon'
          ? handoffOptionLabel(w.id, w.fullName, laneId)
          : w.fullName
      if (elsewhere && w.id !== workerId) {
        label += ` · כעת בנתיב ${elsewhere}`
      }
      if (!isQualified(w, lane)) {
        const missing = missingCertsForLane(w, lane)
        label += missing.length
          ? ` · ללא הסמכה (חסר: ${missing.join(' · ')})`
          : ' · ללא הסמכה'
      }
      return label
    }

    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {locked ? (
          <p className="rounded-xl border border-line/80 bg-surface/70 px-3 py-2 text-sm font-semibold text-ink">
            {selectedWorker?.fullName || 'פנוי'}
          </p>
        ) : (
        <div className="relative min-w-0">
        <select
          className={`min-w-0 w-full appearance-none rounded-xl border py-2 pe-8 ps-3 text-sm font-semibold tracking-tight text-ink transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
            selectedLacksCert
              ? 'border-warn/40 bg-warn-soft/50'
              : isExtra
                ? 'border-accent/30 bg-accent-soft/40'
                : 'border-line/80 bg-surface/70 hover:border-brand/30 hover:bg-card'
          }`}
          value={workerId || ''}
          onChange={(e) =>
            handleSelectWorker(laneId, slotIndex, e.target.value || null)
          }
          aria-label={`בודק בנתיב ${lane.name}${std > 1 ? ` משבצת ${slotIndex + 1}` : ''}`}
        >
          <option value="">— פנוי —</option>
          {options.map((w) => (
            <option key={w.id} value={w.id}>
              {optionLabel(w)}
            </option>
          ))}
          {workerId && !options.some((w) => w.id === workerId) && selectedWorker && (
            <option value={workerId}>{optionLabel(selectedWorker)}</option>
          )}
        </select>
        <ChevronDown
          className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
          aria-hidden
        />
        </div>
        )}
        {!locked && workerId ? (
          <button
            type="button"
            className="ui-btn ui-btn-secondary mt-1 !py-1 text-[12px]"
            onClick={() => setDropWorkerId(workerId)}
          >
            הורדה ממשמרת
          </button>
        ) : null}
        {selectedLacksCert ? (
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-bold text-warn ring-1 ring-warn/25">
            ללא הסמכה
            {missingCertsForLane(selectedWorker!, lane).length > 0
              ? ` · חסר: ${missingCertsForLane(selectedWorker!, lane).join(' · ')}`
              : null}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <section className="board-print-root space-y-4 touch-pan-y pb-40 sm:space-y-5 sm:pb-32">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line/60 bg-card/80 px-3 py-2.5 shadow-[var(--shadow-panel)] backdrop-blur-sm no-print sm:px-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-brand px-2.5 py-1 text-[12px] font-bold text-white">
            {SHIFT_TYPE_LABELS[draft.shiftType]}
          </span>
          <span className="rounded-full bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-soft ring-1 ring-line/80">
            <Ltr>{formatSetupDateLine(draft.date)}</Ltr>
          </span>
          <span className="rounded-full bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-soft ring-1 ring-line/80">
            <Ltr>{shiftWindowDisplay(draft.shiftType)}</Ltr>
          </span>
          <span className="rounded-full bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-soft ring-1 ring-line/80">
            {pluralizeHe(draft.activeLaneIds.length, {
              one: 'נתיב אחד',
              two: 'שני נתיבים',
              many: 'נתיבים',
            })}
          </span>
          <span className="rounded-full bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-soft ring-1 ring-line/80">
            {pluralizeHe(draft.presentWorkerIds.length, {
              one: 'נוכח אחד',
              two: 'שני נוכחים',
              many: 'נוכחים',
            })}
          </span>
          {gateManagerName ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand/8 px-2.5 py-1 text-[12px] font-semibold text-brand ring-1 ring-brand/15">
              <Shield className="size-3.5" aria-hidden />
              {gateManagerName}
            </span>
          ) : null}
        </div>
        {!locked ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAddPicker('lane')}
            className="rounded-full border border-line/80 bg-card px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand/30 hover:text-brand"
          >
            הוספת נתיב
          </button>
          <button
            type="button"
            onClick={() => setAddPicker('worker')}
            className="rounded-full border border-line/80 bg-card px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand/30 hover:text-brand"
          >
            הוספת בודק
          </button>
        </div>
        ) : null}
        {!locked ? (
        <div className="relative" ref={summaryMenuRef}>
          <button
            ref={summaryBtnRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={summaryMenuOpen}
            onClick={() => setSummaryMenuOpen((o) => !o)}
            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="תפריט טיוטה"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
          {summaryMenuOpen && summaryPos
            ? createPortal(
                <div
                  ref={summaryPanelRef}
                  role="menu"
                  className="fixed z-[200] min-w-[10rem] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[var(--shadow-panel-hover)]"
                  style={{ top: summaryPos.top, left: summaryPos.left }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full px-3 py-2.5 text-start text-[13px] font-semibold text-hard hover:bg-hard-soft"
                    onClick={() => {
                      setSummaryMenuOpen(false)
                      onRequestDiscard()
                    }}
                  >
                    ביטול טיוטה
                  </button>
                </div>,
                document.body,
              )
            : null}
        </div>
        ) : null}
      </div>

      <div
        className={`rounded-2xl border px-3.5 py-3 shadow-[var(--shadow-panel)] sm:px-4 ${
          healthItems.length === 0
            ? 'border-ok/20 bg-ok-soft/80'
            : 'border-warn/25 bg-warn-soft/80'
        }`}
        role="status"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => healthItems.length > 0 && setHealthOpen((o) => !o)}
            className={`flex items-center gap-2.5 text-sm font-bold tracking-tight sm:text-[15px] ${
              healthItems.length === 0 ? 'text-ok cursor-default' : 'text-warn'
            }`}
            aria-expanded={healthOpen}
            disabled={healthItems.length === 0}
          >
            <span
              className={`inline-flex size-8 items-center justify-center rounded-full ${
                healthItems.length === 0 ? 'bg-card text-ok shadow-sm' : 'bg-card text-warn shadow-sm'
              }`}
            >
              {healthItems.length === 0 ? (
                <CheckCircle2 className="size-4" aria-hidden />
              ) : (
                <AlertTriangle className="size-4" aria-hidden />
              )}
            </span>
            {healthItems.length === 0 ? (
              'השיבוץ עומד בכל הכללים'
            ) : (
              <>
                התראות ואימות לוח
                <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                  {healthItems.length}
                </span>
                {healthOpen ? (
                  <ChevronUp className="size-3.5 opacity-70" />
                ) : (
                  <ChevronDown className="size-3.5 opacity-70" />
                )}
              </>
            )}
          </button>
          {explanationGroups.length > 0 ? (
            <button
              ref={explainTriggerRef}
              type="button"
              onClick={() => setExplainModalOpen(true)}
              className="rounded-full bg-card px-3 py-1.5 text-[12px] font-semibold text-brand shadow-sm ring-1 ring-brand/15 transition hover:ring-brand/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              הסבר השיבוץ
            </button>
          ) : null}
        </div>
        {optimizationInfo ? (
          <p className="mt-1 text-[11px] text-ink-soft sm:text-xs">{optimizationInfo}</p>
        ) : null}
        {healthOpen && healthItems.length > 0 ? (
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px] sm:text-xs">
            {healthItems.map((item, i) => (
              <li key={`${item.message}-${i}`} className="flex items-start gap-2">
                <span
                  className={
                    item.severity === 'error' ? 'text-hard' : 'text-warn'
                  }
                >
                  {item.message}
                </span>
                {item.laneId ? (
                  <button
                    type="button"
                    onClick={() => scrollToLane(item.laneId!)}
                    className="shrink-0 text-[10px] font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    לנתיב
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!healthOpen && healthItems.length > 0 ? (
          <p className="mt-1 text-[11px] text-warn/90 sm:text-xs">
            {healthItems[0]?.message}
            {healthItems.length > 1 ? ` · ועוד ${healthItems.length - 1}` : ''}
          </p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-[1.35rem] border border-line/70 bg-card shadow-[var(--shadow-panel)]">
        <div className="border-b border-line/70 bg-gradient-to-l from-brand/[0.07] via-card to-card px-4 py-4 sm:px-6 sm:py-5">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-brand/70">
            GATE OUT
          </p>
          <h3 className="mt-1 font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
            שיבוץ שער יציאה
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            {user?.orgName ? `${user.orgName} · ` : ''}
            {new Date(draft.date).toLocaleDateString('he-IL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            {' · '}
            {SHIFT_TYPE_LABELS[draft.shiftType]}
          </p>
        </div>

        <div className="flex touch-pan-y flex-col gap-2.5 bg-surface/50 p-2.5 sm:gap-3 sm:p-4">
          {[...draft.activeLaneIds]
            .sort((a, b) => {
              const la = data.lanes.find((l) => l.id === a)
              const lb = data.lanes.find((l) => l.id === b)
              const gate =
                (la && isGateManagerLane(la) ? 0 : 1) -
                (lb && isGateManagerLane(lb) ? 0 : 1)
              if (gate !== 0) return gate
              return data.lanes.findIndex((l) => l.id === a) -
                data.lanes.findIndex((l) => l.id === b)
            })
            .map((laneId) => {
            const lane = data.lanes.find((l) => l.id === laneId)
            if (!lane) return null
            const isGateLane = isGateManagerLane(lane)
            const std = effectiveStaffingStandard(lane, draft.staffingOverrides)
            const assignment = draft.assignments.find((a) => a.laneId === laneId)
            const slots = [...(assignment?.workerIds ?? [])]
            while (slots.length < std) slots.push('')
            const filled = slots.filter(Boolean).length
            const chipKind = staffingChipKind(filled, std)
            const notesOpen = expandedNotes.has(laneId)

            const emptyLane = !(assignment?.workerIds.some(Boolean))
            const healedTone = draft.healHighlights?.find((item) => item.laneId === laneId)?.tone
            const frozen = emptyLane && draft.frozenLaneIds?.includes(laneId)
            return (
              <div
                key={laneId}
                id={`board-lane-${laneId}`}
                className={`scroll-mt-24 rounded-2xl border border-line/70 border-s-4 bg-card px-3 py-3 shadow-[var(--shadow-panel)] sm:px-4 ${
                  healedTone === 'filled'
                    ? 'ring-2 ring-ok'
                    : frozen || healedTone === 'frozen'
                      ? 'ring-2 ring-warn'
                      : ''
                } ${
                  isGateLane
                    ? 'border-s-brand'
                    : lane.intensity === 'hard'
                      ? 'border-s-hard'
                      : lane.intensity === 'medium'
                        ? 'border-s-warn'
                        : 'border-s-easy'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h4 className="font-display text-base font-bold tracking-tight text-ink">
                        {isGateLane ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Shield className="size-4 text-brand" aria-hidden />
                            {lane.name}
                          </span>
                        ) : (
                          lane.name
                        )}
                      </h4>
                      {frozen ? (
                        <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn ring-1 ring-warn/30">
                          בחור תקן / מוקפא
                        </span>
                      ) : null}
                      {isGateLane ? (
                        <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-bold text-brand">
                          שובץ אוטומטית
                        </span>
                      ) : (
                        <IntensityBadge intensity={lane.intensity} />
                      )}
                      {draft.shiftType === 'afternoon' && lane.afternoonHandoff ? (
                        <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent">
                          החלפת צהריים
                        </span>
                      ) : null}
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                          chipKind === 'ok'
                            ? 'bg-surface text-ink-soft ring-1 ring-line'
                            : chipKind === 'over'
                              ? 'bg-warn-soft text-warn ring-1 ring-warn/20'
                              : 'bg-hard-soft text-hard ring-1 ring-hard/20'
                        }`}
                      >
                        <Ltr>
                          {filled}/{std}
                        </Ltr>
                        {chipKind === 'over' ? ' מעל תקן' : chipKind === 'under' ? ' חסר' : null}
                      </span>
                    </div>
                  </div>
                  {!isGateLane && !locked ? (
                    <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface/80 p-0.5 ring-1 ring-line/70 no-print">
                      <button
                        type="button"
                        onClick={() =>
                          runWithUndo('נוסף מקום בנתיב', () => addSlotToLane(laneId))
                        }
                        className="inline-flex size-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-card hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        title="הוסף משבצת"
                        aria-label={`הוסף משבצת בנתיב ${lane.name}`}
                      >
                        <Plus className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const parked = slots.filter(Boolean).map(
                            (id) =>
                              data.workers.find((worker) => worker.id === id)?.fullName ?? id,
                          )
                          runWithUndo(
                            parked.length > 0
                              ? `${lane.name} הוסר. ${parked.join(', ')} ממתינים לשיבוץ`
                              : `${lane.name} הוסר מהמשמרת`,
                            () => removeLaneFromShift(laneId),
                          )
                        }}
                        className="inline-flex size-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-hard-soft hover:text-hard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        title="הסר נתיב מהמשמרת"
                        aria-label={`הסר נתיב ${lane.name} מהמשמרת`}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-2.5 space-y-2">
                  {slots.map((workerId, slotIndex) => {
                    if (isGateLane) {
                      const name =
                        data.workers.find((w) => w.id === workerId)?.fullName ??
                        (workerId || '—')
                      return (
                        <div
                          key={slotIndex}
                          className="flex items-center gap-3 rounded-xl bg-brand/[0.06] px-3 py-2.5 ring-1 ring-brand/15"
                        >
                          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                            <Shield className="size-4" aria-hidden />
                          </span>
                          <span className="text-base font-semibold tracking-tight text-ink">{name}</span>
                        </div>
                      )
                    }
                    return (
                      <div key={slotIndex} className="flex items-center gap-2">
                        {std > 1 ? (
                          <span className="w-4 shrink-0 text-[11px] text-ink-soft tabular-nums">
                            {slotIndex + 1}.
                          </span>
                        ) : null}
                        {renderWorkerSelect(lane, laneId, slotIndex, workerId, std)}
                        {workerId && !locked ? (
                          <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface/80 p-0.5 ring-1 ring-line/70 no-print">
                            <button
                              type="button"
                              onClick={() => setLeaveTarget({ laneId, workerId })}
                              className="inline-flex size-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-card hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                              title="יציאה באמצע משמרת. רק האדם הזה מוחלף"
                              aria-label="החלפה באמצע משמרת"
                            >
                              <UserMinus className="size-4" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setSwapTarget({ laneId, slotIndex, workerId })
                              }
                              className="inline-flex size-8 items-center justify-center rounded-full text-brand transition hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                              title="החלף עם נתיב אחר"
                              aria-label="החלף עם נתיב אחר"
                            >
                              <ArrowLeftRight className="size-4" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                runWithUndo('הוסרה ישיבה מהנתיב', () =>
                                  beginRemoval(workerId),
                                )
                              }
                              className="inline-flex size-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-hard-soft hover:text-hard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                              title="הסר בודק מהשיבוץ ומהנוכחות"
                              aria-label="הסר בודק מהשיבוץ"
                            >
                              <UserX className="size-4" aria-hidden />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>

                <div className="mt-3 no-print">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedNotes((s) => {
                        const next = new Set(s)
                        if (next.has(laneId)) next.delete(laneId)
                        else next.add(laneId)
                        return next
                      })
                    }
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft transition hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    aria-expanded={notesOpen}
                  >
                    <StickyNote className="size-3.5" aria-hidden />
                    {notesOpen ? 'הסתר הערה' : 'הערה לנתיב'}
                  </button>
                  {notesOpen ? (
                    <div className="mt-1.5">
                      <textarea
                        className="ui-field min-h-[3.5rem] resize-y whitespace-pre-wrap !py-2 text-xs sm:text-sm"
                        rows={3}
                        maxLength={LANE_NOTE_MAX_LENGTH}
                        placeholder={"הערה בכמה שורות…\nתופיע גם בוואטסאפ ובייצוא"}
                        value={assignment?.notes ?? ''}
                        readOnly={locked}
                        onChange={(e) => {
                          if (locked) return
                          updateLaneNotes(laneId, e.target.value)
                        }}
                        aria-describedby={`lane-note-hint-${laneId}`}
                      />
                      <p
                        id={`lane-note-hint-${laneId}`}
                        className="mt-0.5 text-[10px] text-ink-soft sm:text-[11px]"
                      >
                        אפשר Enter לשורה חדשה · עד {LANE_NOTE_MAX_LENGTH} תווים ·{' '}
                        {(assignment?.notes ?? '').length}/{LANE_NOTE_MAX_LENGTH}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
          {draft.activeLaneIds.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-ink-soft">
              אין נתיבים במשמרת. חזרו לבחירת נתיבים כדי להוסיף.
            </p>
          ) : null}
        </div>

        {draft.unassignedWorkerIds.length > 0 ? (
          <div className="border-t border-line/70 bg-surface/40 px-3 py-3 sm:px-5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-soft">
              <UserMinus className="size-3.5" aria-hidden />
              ממתינים לשיבוץ
            </p>
            <ul className="flex flex-wrap gap-1.5 no-print">
              {draft.unassignedWorkerIds.map((id) => {
                const name = data.workers.find((w) => w.id === id)?.fullName ?? id
                return (
                  <li
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full border border-line/80 bg-card px-2.5 py-1 text-xs text-ink shadow-sm"
                  >
                    <span>{name}</span>
                    {!locked ? (
                      <>
                    <button
                      type="button"
                      onClick={() => onOpenExtraPick(undefined, id)}
                      className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      הוספה לנתיב
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runWithUndo('הוסר בודק מהממתינים', () => beginRemoval(id))
                      }
                      className="inline-flex size-5 items-center justify-center rounded-md text-hard hover:bg-hard-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      title={`הסר את ${name} מהממתינים`}
                      aria-label={`הסר את ${name}`}
                    >
                      <UserX className="size-3.5" aria-hidden />
                    </button>
                      </>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {!locked ? (
      <button
        type="button"
        onClick={onBackToAttendance}
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand no-print sm:text-sm"
      >
        <ChevronRight className="size-3.5 sm:size-4" aria-hidden />
        חזרה לנוכחות
      </button>
      ) : null}

      <ShiftDropSummary
        drops={draft.shiftDrops ?? []}
        workers={data.workers}
        onUndo={undoShiftDrop}
      />

      {/* Sticky actions */}
      <div className="fixed inset-x-3 bottom-20 z-40 rounded-2xl border border-line/70 bg-card/95 px-3 py-2.5 shadow-[var(--shadow-panel-hover)] backdrop-blur-md no-print sm:inset-x-4 lg:bottom-4 lg:left-1/2 lg:right-auto lg:w-[min(72rem,calc(100%-2rem))] lg:-translate-x-1/2">
        <div className="mx-auto flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-ink-soft">שמירה</span>
          {locked ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ok">
              <Lock className="size-4" aria-hidden />
              הלוח נעול
            </span>
          ) : (
          <button
            type="button"
            onClick={trySave}
            aria-disabled={saveBlocked}
            title={saveBlockedReason ?? undefined}
            className={`ui-btn ui-btn-primary !py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              saveBlocked ? 'cursor-not-allowed opacity-40' : ''
            } ${saveFlash ? '!bg-ok hover:!bg-ok' : ''}`}
          >
            {saveFlash ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            שמירה
          </button>
          )}
          {!locked && onSignOff ? (
            <button
              type="button"
              onClick={trySignOff}
              aria-disabled={saveBlocked}
              title={
                saveBlocked
                  ? 'אפשר לסגור רק כשהלוח תקין וכולם משובצים'
                  : 'סגירה נועלת את הלוח לעריכה'
              }
              className={`ui-btn ui-btn-secondary !py-2 gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                saveBlocked ? 'cursor-not-allowed opacity-40' : ''
              }`}
            >
              <Lock className="size-4" aria-hidden />
              סגירת משמרת
            </button>
          ) : null}
          <span
            className={`text-[12px] font-medium tabular-nums ${
              saveFlash || (!boardDirty && lastSavedAt)
                ? 'text-ok'
                : boardDirty
                  ? 'text-warn'
                  : 'text-ink-soft'
            }`}
          >
            {saveStatusText}
          </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-2">
            <span className="text-[11px] font-semibold text-ink-soft">כלים</span>
          <div className="relative" ref={shareRootRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={shareOpen}
              disabled={shareBusy}
              title={exportBlock ?? undefined}
              onClick={() => {
                if (exportBlock) {
                  notify.error('לא ניתן לייצא', exportBlock)
                  return
                }
                setShareOpen((o) => !o)
              }}
              className="ui-btn ui-btn-secondary !py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
            >
              {shareBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <MessageCircle className="size-4" aria-hidden />
              )}
              שיתוף
              <ChevronDown className="size-3.5 opacity-70" aria-hidden />
            </button>
            {shareOpen ? (
              <div
                role="menu"
                className="absolute bottom-full end-0 z-20 mb-1 min-w-[11rem] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[var(--shadow-panel-hover)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={shareBusy}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[13px] font-semibold text-ink hover:bg-surface disabled:opacity-50"
                  onClick={() => void runShare('whatsapp')}
                >
                  <MessageCircle className="size-3.5" aria-hidden />
                  WhatsApp
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={shareBusy}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[13px] font-semibold text-ink hover:bg-surface disabled:opacity-50"
                  onClick={() => void runShare('download')}
                >
                  <Download className="size-3.5" aria-hidden />
                  ייצוא מסמך
                </button>
              </div>
            ) : null}
          </div>
          {!locked && onCompare ? (
            <button
              type="button"
              onClick={onCompare}
              className="ui-btn ui-btn-secondary !py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              השוואת חלופות
            </button>
          ) : null}
          {!locked ? (
          <button
            type="button"
            onClick={confirmReassign}
            className="ui-btn ui-btn-secondary !py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Sparkles className="size-4" aria-hidden />
            שבץ מחדש
          </button>
          ) : null}
          </div>
        </div>
      </div>

      {/* Swap modal */}
      {swapTarget
        ? (() => {
            const lane = data.lanes.find((l) => l.id === swapTarget.laneId)
            const current = data.workers.find((w) => w.id === swapTarget.workerId)
            if (!lane) return null

            type SwapOption = {
              laneId: string
              slotIndex: number
              workerId: string
              laneName: string
              workerName: string
              lacksCertHere: boolean
              currentLacksThere: boolean
            }

            const options: SwapOption[] = []
            for (const otherLaneId of draft.activeLaneIds) {
              const otherLane = data.lanes.find((l) => l.id === otherLaneId)
              if (!otherLane) continue
              const assignment = draft.assignments.find(
                (a) => a.laneId === otherLaneId,
              )
              const slotList = assignment?.workerIds ?? []
              slotList.forEach((wid, slotIndex) => {
                if (!wid) return
                if (
                  otherLaneId === swapTarget.laneId &&
                  slotIndex === swapTarget.slotIndex
                ) {
                  return
                }
                const otherWorker = data.workers.find((w) => w.id === wid)
                options.push({
                  laneId: otherLaneId,
                  slotIndex,
                  workerId: wid,
                  laneName: otherLane.name,
                  workerName: otherWorker?.fullName ?? wid,
                  lacksCertHere: otherWorker
                    ? !isQualified(otherWorker, lane)
                    : false,
                  currentLacksThere: current
                    ? !isQualified(current, otherLane)
                    : false,
                })
              })
            }
            options.sort((a, b) => {
              const byLane = a.laneName.localeCompare(b.laneName, 'he')
              if (byLane !== 0) return byLane
              return a.slotIndex - b.slotIndex
            })

            return createPortal(
              <div className="fixed inset-0 z-[200] flex items-end justify-center bg-ink/40 p-3 no-print sm:items-center sm:p-4">
                <div
                  role="dialog"
                  aria-modal="true"
                  className="w-full max-w-md animate-fade-up rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-8 items-center justify-center rounded-xl bg-brand/10 text-brand">
                        <ArrowLeftRight className="size-4" aria-hidden />
                      </span>
                      <div>
                        <h3 className="font-display text-base font-bold text-ink">
                          החלפה בין נתיבים
                        </h3>
                        <p className="text-xs text-ink-soft">
                          {lane.name} · {current?.fullName ?? '—'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSwapTarget(null)}
                      className="rounded-lg p-1.5 text-ink-soft hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      aria-label="סגור"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  {options.length === 0 ? (
                    <p className="rounded-xl bg-surface px-3 py-3 text-sm text-ink-soft">
                      אין כרגע בודקים משובצים בנתיבים אחרים להחלפה.
                    </p>
                  ) : (
                    <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                      {options.map((opt) => (
                        <li key={`${opt.laneId}-${opt.slotIndex}`}>
                          <button
                            type="button"
                            onClick={() => {
                              runWithUndo('החלפה בין נתיבים', () =>
                                swapAssignments(
                                  {
                                    laneId: swapTarget.laneId,
                                    slotIndex: swapTarget.slotIndex,
                                  },
                                  {
                                    laneId: opt.laneId,
                                    slotIndex: opt.slotIndex,
                                  },
                                ),
                              )
                              setSwapTarget(null)
                            }}
                            className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-right transition hover:border-brand hover:bg-brand/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          >
                            <span className="min-w-0">
                              <span className="block text-sm font-bold text-ink">
                                {opt.laneName}
                                <span className="mx-1.5 font-normal text-ink-soft">·</span>
                                {opt.workerName}
                              </span>
                              {(opt.lacksCertHere || opt.currentLacksThere) && (
                                <span className="mt-0.5 block text-[10px] font-medium text-warn">
                                  {opt.lacksCertHere && opt.currentLacksThere
                                    ? 'שימו לב: לשני הבודקים חסרה הסמכה מלאה אחרי ההחלפה'
                                    : opt.lacksCertHere
                                      ? `שימו לב: ל${opt.workerName} חסרה הסמכה מלאה ל${lane.name}`
                                      : `שימו לב: ל${current?.fullName ?? 'הבודק'} חסרה הסמכה מלאה ל${opt.laneName}`}
                                </span>
                              )}
                            </span>
                            <ArrowLeftRight className="size-3.5 shrink-0 text-brand" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>,
              document.body,
            )
          })()
        : null}

      {leaveTarget
        ? (() => {
            const lane = data.lanes.find((item) => item.id === leaveTarget.laneId)
            const current = data.workers.find((worker) => worker.id === leaveTarget.workerId)
            const seated = new Set(
              draft.assignments.flatMap((row) => row.workerIds.filter(Boolean)),
            )
            seated.delete(leaveTarget.workerId)
            const options = data.workers
              .filter(
                (worker) =>
                  worker.status === 'active' &&
                  worker.isInspector &&
                  worker.id !== leaveTarget.workerId &&
                  worker.id !== draft.gateManagerWorkerId &&
                  !seated.has(worker.id) &&
                  lane != null &&
                  isQualified(worker, lane),
              )
              .sort((a, b) => a.fullName.localeCompare(b.fullName, 'he'))
            return createPortal(
              <div className="fixed inset-0 z-[200] flex items-end justify-center bg-ink/40 p-3 no-print sm:items-center sm:p-4">
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="leave-replace-title"
                  className="w-full max-w-md animate-fade-up rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 id="leave-replace-title" className="font-display text-base font-bold text-ink">
                        החלפה באמצע משמרת
                      </h3>
                      <p className="text-xs text-ink-soft">
                        {current?.fullName ?? '—'} יוצא מ{lane?.name ?? 'הנתיב'}. שאר האנשים נשארים במקום.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLeaveTarget(null)}
                      className="rounded-lg p-1.5 text-ink-soft hover:bg-surface"
                      aria-label="סגור"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  {options.length === 0 ? (
                    <p className="rounded-xl bg-surface px-3 py-3 text-sm text-ink-soft">
                      אין מי כשיר ופנוי להיכנס במקומו. מי שכבר יושב בנתיב אחר לא מוזז.
                    </p>
                  ) : (
                    <ul className="max-h-64 space-y-1 overflow-y-auto">
                      {options.map((worker) => (
                        <li key={worker.id}>
                          <button
                            type="button"
                            className="flex w-full rounded-xl px-3 py-2 text-start text-sm font-semibold text-ink hover:bg-surface"
                            onClick={() => {
                              runWithUndo(
                                `${worker.fullName} נכנס במקום ${current?.fullName ?? ''}`,
                                () =>
                                  replaceLeavingWorker(
                                    leaveTarget.workerId,
                                    worker.id,
                                  ),
                              )
                              setLeaveTarget(null)
                            }}
                          >
                            {worker.fullName}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>,
              document.body,
            )
          })()
        : null}

      <AssignmentExplainDialog
        open={explainModalOpen && explanationGroups.length > 0}
        onClose={() => setExplainModalOpen(false)}
        date={draft.date}
        shiftType={draft.shiftType}
        groups={explanationGroups}
        returnFocusRef={explainTriggerRef}
      />
      {dropWorkerId
        ? (() => {
            const worker = data.workers.find((item) => item.id === dropWorkerId)
            if (!worker) return null
            return (
              <ShiftDropDialog
                worker={worker}
                shiftType={draft.shiftType}
                initial={(draft.shiftDrops ?? []).find((item) => item.workerId === worker.id)}
                onClose={() => setDropWorkerId(null)}
                onConfirm={(drop) => {
                  runWithUndo('נרשמה יציאה מהמשמרת', () => recordShiftDrop(drop))
                  setDropWorkerId(null)
                }}
              />
            )
          })()
        : null}
      {addPicker ? (
        <div className="fixed inset-0 z-[400] flex items-end justify-center bg-ink/40 p-3 sm:items-center">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-line bg-card p-4 shadow-xl">
            <h3 className="font-display text-lg font-bold text-ink">
              {addPicker === 'lane' ? 'הוספת נתיב' : 'הוספת בודק'}
            </h3>
            <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
              {(addPicker === 'lane'
                ? managedLanes(data.lanes).filter((lane) => !draft.activeLaneIds.includes(lane.id))
                : activeAttendanceWorkers(data.workers).filter(
                    (worker) => !draft.presentWorkerIds.includes(worker.id),
                  )
              ).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full rounded-xl px-3 py-2 text-right text-sm font-semibold text-ink hover:bg-surface"
                    onClick={() => {
                      if (addPicker === 'lane') {
                        runWithUndo('נוסף נתיב למשמרת', () => addBoardLane(item.id))
                      } else {
                        runWithUndo('נוסף בודק לנוכחות', () => toggleWorker(item.id))
                      }
                      setAddPicker(null)
                    }}
                  >
                    {'fullName' in item ? item.fullName : item.name}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="ui-btn ui-btn-secondary mt-3" onClick={() => setAddPicker(null)}>
              סגירה
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
