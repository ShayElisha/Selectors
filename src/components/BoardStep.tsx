import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useId,
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
  Search,
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
import {
  activeAttendanceWorkers,
  findGateManagerLane,
  isGateManagerLane,
  managedLanes,
} from '../lib/gateManager'
import { notify } from '../lib/notify'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import { compareLaneNames } from '../lib/lanesCertHelpers'
import { postAuditEvent } from '../api'
import { formatSetupDateLine, shiftWindowDisplay } from '../lib/shiftWizard'
import { useApp } from '../context/AppContext'
import type { AppData, LaneAssignment, ShiftType, Worker } from '../types'
import { avatarColor } from '../lib/avatarColor'

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
  onReassign: () => void | Promise<void>
  onEditSettings: () => void
  onRequestDiscard: () => void
  onOpenExtraPick: (laneId?: string, workerId?: string) => void
  onBackToAttendance: () => void
  onExplainModalOpenChange?: (open: boolean) => void
}

function placeFloatingMenu(anchor: HTMLElement, width: number, height = 88) {
  const rect = anchor.getBoundingClientRect()
  let left = rect.left
  if (left + width > window.innerWidth - 8) left = rect.right - width
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
  let top = rect.bottom + 4
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 4)
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

interface WorkerChoice {
  worker: Worker
  description?: string
}

function workerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0]?.slice(0, 2) ?? '?'
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`
}

function WorkerCombobox({
  options,
  value,
  placeholder,
  ariaLabel,
  onChange,
  disabled = false,
}: {
  options: WorkerChoice[]
  value: string
  placeholder: string
  ariaLabel: string
  onChange: (workerId: string | null) => void
  disabled?: boolean
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )
  const selected = options.find((option) => option.worker.id === value)
  const filtered = options.filter(({ worker, description }) =>
    `${worker.fullName} ${description ?? ''}`
      .toLocaleLowerCase('he')
      .includes(query.trim().toLocaleLowerCase('he')),
  )

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(360, window.innerWidth - 16)
    const height = Math.min(320, window.innerHeight - 16)
    let top = rect.bottom + 4
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 4)
    }
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setPosition({ top, left, width })
  }

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    updatePosition()
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false)
        setQuery('')
      }
    }
    const reposition = () => updatePosition()
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex((index) =>
      filtered.length === 0
        ? -1
        : Math.min(Math.max(index, -1), filtered.length - 1),
    )
  }, [filtered.length, query])

  const choose = (workerId: string | null) => {
    onChange(workerId)
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }

  const openList = () => {
    setActiveIndex(filtered.findIndex((option) => option.worker.id === value))
    setOpen(true)
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) =>
        filtered.length ? (index + 2) % (filtered.length + 1) - 1 : -1,
      )
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) =>
        filtered.length
          ? (index - 1 + filtered.length + 2) % (filtered.length + 1) - 1
          : -1,
      )
    } else if (event.key === 'Home' && filtered.length) {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === 'End' && filtered.length) {
      event.preventDefault()
      setActiveIndex(filtered.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex < 0) choose(null)
      else if (filtered[activeIndex]) choose(filtered[activeIndex]!.worker.id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setQuery('')
      triggerRef.current?.focus()
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => {
          if (open) {
            setOpen(false)
            setQuery('')
          } else {
            openList()
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openList()
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        className={`flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border bg-surface-2 px-2.5 text-start transition hover:border-brand/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-70 ${
          selected ? 'border-line' : 'border-dashed border-warn/50'
        }`}
      >
        <ChevronDown
          className={`size-4 shrink-0 text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
        {selected ? (
          <span
            aria-hidden
            className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${avatarColor(selected.worker.fullName)}`}
          >
            {workerInitials(selected.worker.fullName)}
          </span>
        ) : (
          <span className="inline-flex size-7 shrink-0 items-center justify-center">
            <span className="size-2 rounded-full bg-warn" aria-hidden />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {selected?.worker.fullName ?? placeholder}
        </span>
        {selected?.description ? (
          <span className="hidden max-w-[35%] truncate text-xs text-ink-soft sm:block">
            {selected.description}
          </span>
        ) : null}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-[500] overflow-hidden rounded-xl border border-line bg-card p-2 shadow-[var(--shadow-panel-hover)]"
              style={{ top: position.top, left: position.left, width: position.width }}
            >
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
                  aria-hidden
                />
                <input
                  ref={searchRef}
                  type="search"
                  className="ui-field h-10 w-full ps-9 text-sm"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="חיפוש בודק"
                  aria-label="חיפוש בודק"
                  aria-controls={`${id}-listbox`}
                  aria-activedescendant={
                    `${id}-${activeIndex < 0 ? 'clear' : `option-${activeIndex}`}`
                  }
                />
              </label>
              <div
                id={`${id}-listbox`}
                role="listbox"
                aria-label={ariaLabel}
                className="mt-2 max-h-64 overflow-y-auto"
              >
                <button
                  id={`${id}-clear`}
                  type="button"
                  role="option"
                  aria-selected={!value}
                  onMouseEnter={() => setActiveIndex(-1)}
                  onClick={() => choose(null)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm text-ink-soft hover:bg-surface ${
                    activeIndex === -1 ? 'bg-surface' : ''
                  }`}
                >
                  <span className="inline-flex size-7 items-center justify-center">
                    <span className="size-2 rounded-full bg-warn" aria-hidden />
                  </span>
                  {placeholder}
                  {!value ? <Check className="ms-auto size-4" aria-hidden /> : null}
                </button>
                {filtered.map(({ worker, description }, index) => (
                  <button
                    id={`${id}-option-${index}`}
                    key={worker.id}
                    type="button"
                    role="option"
                    aria-selected={worker.id === value}
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(worker.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start hover:bg-surface ${
                      index === activeIndex ? 'bg-surface' : ''
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${avatarColor(worker.fullName)}`}
                    >
                      {workerInitials(worker.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {worker.fullName}
                      </span>
                      {description ? (
                        <span className="block truncate text-xs text-ink-soft">
                          {description}
                        </span>
                      ) : null}
                    </span>
                    {worker.id === value ? (
                      <Check className="size-4 shrink-0 text-brand" aria-hidden />
                    ) : null}
                  </button>
                ))}
                {filtered.length === 0 ? (
                  <p className="px-3 py-4 text-center text-sm text-ink-soft">
                    לא נמצאו בודקים
                  </p>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
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
  onEditSettings,
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
    setGateManager,
    user,
    draftDirty,
    restoreDraftSnapshot,
    assigning,
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
  const [laneActionMenu, setLaneActionMenu] = useState<string | null>(null)
  const [laneActionPos, setLaneActionPos] = useState<{ top: number; left: number } | null>(null)
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
  const laneActionMenuRef = useRef<HTMLDivElement | null>(null)
  const laneActionButtonRef = useRef<HTMLButtonElement | null>(null)
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
    if (!shareOpen && !summaryMenuOpen && !laneActionMenu) return
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
      if (
        laneActionMenu &&
        !laneActionMenuRef.current?.contains(e.target as Node) &&
        !laneActionButtonRef.current?.contains(e.target as Node)
      ) {
        setLaneActionMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShareOpen(false)
        setSummaryMenuOpen(false)
        setLaneActionMenu(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [shareOpen, summaryMenuOpen, laneActionMenu])

  useLayoutEffect(() => {
    if (!laneActionMenu) {
      setLaneActionPos(null)
      return
    }
    const place = () => {
      const anchor = laneActionButtonRef.current
      if (!anchor) return
      setLaneActionPos(placeFloatingMenu(anchor, 224, 280))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [laneActionMenu])

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
    if (!draft.gateManagerWorkerId) {
      items.push({
        severity: 'warning',
        message: 'לא נבחר מנהל משמרת. אפשר לבחור אותו כאן בלוח, בלי לחזור אחורה.',
      })
    }
    return items
  }, [
    partitioned,
    boardIssues,
    slotConflict,
    draft.date,
    draft.shiftType,
    draft.gateManagerWorkerId,
  ])

  const hasBoardErrors = boardIssues.some((i) => i.severity === 'error')
  const locked = Boolean(draft.signOff?.signedAt)
  const gateLane = findGateManagerLane(data.lanes)
  const shiftManagers = useMemo(
    () =>
      data.workers
        .filter(
          (worker) =>
            worker.status === 'active' && worker.isManager && worker.isInspector,
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'he')),
    [data.workers],
  )
  const chooseGateManager = (workerId: string) => {
    if (locked) return
    runWithUndo(
      workerId ? 'נבחר מנהל משמרת' : 'הוסר מנהל משמרת',
      () => setGateManager(workerId || null),
    )
  }
  const gateManagerSelect = (
    <WorkerCombobox
      options={shiftManagers.map((worker) => ({ worker }))}
      value={draft.gateManagerWorkerId ?? ''}
      placeholder={
        shiftManagers.length === 0
          ? 'אין מנהל שהוא גם בודק'
          : 'בחרו מנהל משמרת'
      }
      ariaLabel="בחירת מנהל משמרת"
      disabled={locked || shiftManagers.length === 0}
      onChange={(workerId) => chooseGateManager(workerId ?? '')}
    />
  )
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
    if (assigning) return
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
    // The reassignment is async (progress loader); undo toast only after the
    // new board landed so a fast undo cannot race the search.
    void (async () => {
      const current = draftRef.current
      if (!current || current.signOff?.signedAt) {
        await onReassign()
        return
      }
      const snapshot = JSON.parse(JSON.stringify(current)) as typeof current
      await onReassign()
      notify.undoable('שיבוץ מחדש', () => restoreDraftSnapshot(snapshot))
    })()
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

  const saveStatusText =
    draftDirty || boardDirty
      ? 'שינויים שלא נשמרו'
      : saveFlash
        ? lastSavedAt
          ? `נשמר · ${lastSavedAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
          : 'נשמר'
        : lastSavedAt
          ? `נשמר · ${lastSavedAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
          : 'טרם נשמר'
  const isSaved = !draftDirty && !boardDirty && Boolean(lastSavedAt)

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
    const workers = present
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
    const selectedWorker = workerId
      ? data.workers.find((w) => w.id === workerId)
      : null
    if (selectedWorker && !workers.some((worker) => worker.id === selectedWorker.id)) {
      workers.push(selectedWorker)
    }

    const isExtra = slotIndex >= std
    const selectedLacksCert =
      selectedWorker != null && !isQualified(selectedWorker, lane)

    const optionDescription = (w: Worker) => {
      const details: string[] = []
      const elsewhere = workerLaneNameElsewhere(
        w.id,
        draft.assignments,
        data.lanes,
        laneId,
      )
      if (lane.afternoonHandoff && draft.shiftType === 'afternoon') {
        const tier = morningCtx?.found
          ? afternoonHandoffTier(w.id, laneId, morningCtx)
          : null
        if (tier === 0) details.push('צהריים בלבד')
        else if (tier === 1) details.push('ממשיך — היה כאן בבוקר')
        else if (tier === 2) details.push('ממשיך מבוקר')
      }
      if (elsewhere && w.id !== workerId) {
        details.push(`כעת בנתיב ${elsewhere}`)
      }
      if (!isQualified(w, lane)) {
        const missing = missingCertsForLane(w, lane)
        details.push(
          missing.length
            ? `ללא הסמכה · חסר: ${missing.join(' · ')}`
            : 'ללא הסמכה',
        )
      }
      return details.join(' · ')
    }

    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {locked ? (
          <WorkerCombobox
            options={workers.map((worker) => ({
              worker,
              description: optionDescription(worker),
            }))}
            value={workerId}
            placeholder="פנוי"
            ariaLabel={`בודק בנתיב ${lane.name}`}
            disabled
            onChange={() => undefined}
          />
        ) : (
          <div className={selectedLacksCert ? 'rounded-xl ring-1 ring-warn/40' : isExtra ? 'rounded-xl ring-1 ring-accent/30' : ''}>
            <WorkerCombobox
              options={workers.map((worker) => ({
                worker,
                description: optionDescription(worker),
              }))}
              value={workerId}
              placeholder="בחר בודק"
              ariaLabel={`בודק בנתיב ${lane.name}${std > 1 ? ` משבצת ${slotIndex + 1}` : ''}`}
              onChange={(nextWorkerId) =>
                handleSelectWorker(laneId, slotIndex, nextWorkerId)
              }
            />
          </div>
        )}
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
    <section className="board-print-root space-y-4 touch-pan-y sm:space-y-5">
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
                    className="flex w-full px-3 py-2.5 text-start text-[13px] font-semibold text-ink hover:bg-surface"
                    onClick={() => {
                      setSummaryMenuOpen(false)
                      onEditSettings()
                    }}
                  >
                    עריכת הגדרות
                  </button>
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

      <div className="rounded-[1.5rem] border border-brand/15 bg-card shadow-[var(--shadow-panel-hover)]">
        <div className="rounded-t-[1.5rem] border-b border-brand/10 bg-gradient-to-l from-brand/[0.095] via-brand/[0.025] to-card px-4 py-5 sm:px-6 sm:py-6">
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

        <div className="grid touch-pan-y grid-cols-1 gap-4 p-4 min-[900px]:grid-cols-2">
          {gateLane && !draft.activeLaneIds.includes(gateLane.id) ? (
            <div className="board-lane-card board-lane-card--gate relative rounded-2xl border border-line bg-card p-4 shadow-sm">
              <h4 className="inline-flex items-center gap-1.5 font-display text-base font-semibold text-ink">
                <Shield className="size-4 text-brand" aria-hidden />
                מנהל שער
              </h4>
              <div className="mt-3">{gateManagerSelect}</div>
              <p className="mt-2 truncate text-xs text-ink-soft">
                לא סומן מנהל בתחילת המשמרת. הבחירה כאן מוסיפה אותו ללוח.
              </p>
            </div>
          ) : null}
          {[...draft.activeLaneIds]
            .sort((a, b) => {
              const la = data.lanes.find((l) => l.id === a)
              const lb = data.lanes.find((l) => l.id === b)
              if (!la || !lb) return a.localeCompare(b)
              return compareLaneNames(la, lb)
            })
            .map((laneId, laneIndex) => {
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
            const noteText = assignment?.notes?.trim() ?? ''

            const emptyLane = !(assignment?.workerIds.some(Boolean))
            const healedTone = draft.healHighlights?.find((item) => item.laneId === laneId)?.tone
            const frozen = emptyLane && draft.frozenLaneIds?.includes(laneId)
            return (
              <div
                key={laneId}
                id={`board-lane-${laneId}`}
                style={{ animationDelay: `${laneIndex * 20}ms` }}
                className={`board-lane-card board-lane-card--${isGateLane ? 'gate' : lane.intensity} group relative scroll-mt-24 rounded-2xl border border-line bg-card p-4 shadow-sm transition-shadow duration-150 hover:shadow-md motion-reduce:animate-none ${
                  healedTone === 'filled'
                    ? 'ring-2 ring-ok'
                    : frozen || healedTone === 'frozen'
                      ? 'ring-2 ring-warn'
                      : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <h4 className="min-w-0 font-display text-base font-semibold tracking-tight text-ink sm:text-[17px]">
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
                          {locked ? 'שובץ אוטומטית' : 'בחירה בלוח'}
                        </span>
                      ) : (
                        <IntensityBadge intensity={lane.intensity} />
                      )}
                      {draft.shiftType === 'afternoon' && lane.afternoonHandoff ? (
                        <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent">
                          החלפת צהריים
                        </span>
                      ) : null}
                      {filled >= std && chipKind !== 'over' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
                          <span className="size-1.5 rounded-full bg-ok" aria-hidden />
                          מאויש
                        </span>
                      ) : (
                        <span className="inline-flex min-h-6 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn ring-1 ring-warn/20">
                          <Ltr>{filled}/{std}</Ltr>
                          {chipKind === 'over' ? ' מעל תקן' : null}
                        </span>
                      )}
                    </div>
                  </div>
                  {!locked ? (
                    <div className="flex shrink-0 items-center gap-0.5 no-print">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedNotes((current) => {
                            const next = new Set(current)
                            if (next.has(laneId)) next.delete(laneId)
                            else next.add(laneId)
                            return next
                          })
                        }
                        className="relative inline-flex size-9 items-center justify-center rounded-[10px] text-ink-soft transition hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        title="הערה לנתיב"
                        aria-label={notesOpen ? 'הסתר הערה לנתיב' : 'הערה לנתיב'}
                        aria-expanded={notesOpen}
                      >
                        <StickyNote className="size-4" aria-hidden />
                        {noteText ? (
                          <span className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-brand" aria-label="יש הערה" />
                        ) : null}
                      </button>
                      {!isGateLane ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              runWithUndo('נוסף מקום בנתיב', () => addSlotToLane(laneId))
                            }
                            className="lane-card-action inline-flex size-9 items-center justify-center rounded-[10px] text-ink-soft transition hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
                            className="ui-btn-danger-ghost lane-card-action inline-flex size-9 items-center justify-center rounded-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                            title="הסר נתיב מהמשמרת"
                            aria-label={`הסר נתיב ${lane.name} מהמשמרת`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </>
                      ) : null}
                      <div className="relative">
                        <button
                          ref={laneActionMenu === laneId ? laneActionButtonRef : null}
                          type="button"
                          onClick={() =>
                            setLaneActionMenu((current) =>
                              current === laneId ? null : laneId,
                            )
                          }
                          className="inline-flex size-9 items-center justify-center rounded-[10px] text-ink-soft transition hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          title="פעולות נתיב"
                          aria-label={`פעולות נתיב ${lane.name}`}
                          aria-haspopup="menu"
                          aria-expanded={laneActionMenu === laneId}
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                        </button>
                        {laneActionMenu === laneId && laneActionPos
                          ? createPortal(
                            <div
                            ref={laneActionMenuRef}
                            role="menu"
                            className="fixed z-[1000] max-h-[min(70vh,280px)] min-w-56 overflow-y-auto rounded-xl border border-line bg-card p-1.5 shadow-[var(--shadow-panel-hover)]"
                            style={{ top: laneActionPos.top, left: laneActionPos.left }}
                          >
                            {!isGateLane ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm font-semibold text-ink hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                                onClick={() => {
                                  setLaneActionMenu(null)
                                  onOpenExtraPick(laneId)
                                }}
                              >
                                <Plus className="size-4" aria-hidden />
                                הוספת בודק
                              </button>
                            ) : null}
                            {slots.filter(Boolean).map((id) => {
                              const worker = data.workers.find((item) => item.id === id)
                              const name = worker?.fullName ?? id
                              return (
                                <div key={id} className="border-t border-line/70 px-2 py-2 first:border-t-0">
                                  <p className="truncate text-xs font-semibold text-ink-soft">{name}</p>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-start text-sm font-semibold text-ink-soft hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                                    onClick={() => {
                                      setLaneActionMenu(null)
                                      setLeaveTarget({ laneId, workerId: id })
                                    }}
                                  >
                                    <ArrowLeftRight className="size-4" aria-hidden />
                                    החלפה באמצע משמרת
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-start text-sm font-semibold text-bad hover:bg-bad-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                                    onClick={() => {
                                      setLaneActionMenu(null)
                                      setDropWorkerId(id)
                                    }}
                                  >
                                    <UserMinus className="size-4" aria-hidden />
                                    הורדה ממשמרת
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-start text-sm font-semibold text-ink-soft hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                                    onClick={() => {
                                      setLaneActionMenu(null)
                                      runWithUndo('הוסרה ישיבה מהנתיב', () =>
                                        beginRemoval(id),
                                      )
                                    }}
                                  >
                                    <UserX className="size-4" aria-hidden />
                                    הסרת בודק
                                  </button>
                                </div>
                              )
                            })}
                            {slots.filter(Boolean).length === 0 && isGateLane ? (
                              <p className="px-2.5 py-2 text-sm text-ink-soft">אין פעולות זמינות</p>
                            ) : null}
                            </div>,
                            document.body,
                          )
                          : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 space-y-2">
                  {slots.map((workerId, slotIndex) => {
                    if (isGateLane) {
                      return <div key={slotIndex}>{gateManagerSelect}</div>
                    }
                    return (
                      <div key={slotIndex} className="flex min-w-0 items-center gap-2">
                        {std > 1 ? (
                          <span className="w-4 shrink-0 text-[11px] text-ink-soft tabular-nums">
                            {slotIndex + 1}.
                          </span>
                        ) : null}
                        {renderWorkerSelect(lane, laneId, slotIndex, workerId, std)}
                        {workerId && !locked ? (
                          <button
                            type="button"
                            onClick={() => setSwapTarget({ laneId, slotIndex, workerId })}
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-brand transition hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand no-print"
                            title="החלפה"
                            aria-label={`החלפה ל${data.workers.find((worker) => worker.id === workerId)?.fullName ?? 'בודק'}`}
                          >
                            <ArrowLeftRight className="size-4" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>

                {!notesOpen && noteText ? (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedNotes((current) => new Set(current).add(laneId))
                    }
                    className="mt-2 block max-w-full truncate text-start text-xs text-ink-soft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand no-print"
                    title={noteText}
                    aria-label="הצגת הערת הנתיב"
                  >
                    {noteText}
                  </button>
                ) : null}
                {notesOpen ? (
                  <div className="mt-2 no-print">
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
            )
          })}
          {draft.activeLaneIds.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-ink-soft min-[900px]:col-span-2">
              אין נתיבים במשמרת. חזרו לבחירת נתיבים כדי להוסיף.
            </p>
          ) : null}
        </div>

        {draft.unassignedWorkerIds.length > 0 ? (
          <div className="rounded-b-[1.5rem] border-t border-line/70 bg-surface/40 px-3 py-3 sm:px-5">
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

      <div className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 mx-auto w-auto max-w-[760px] rounded-2xl border border-line/80 bg-card/85 p-2.5 shadow-[var(--shadow-lg)] backdrop-blur-xl no-print sm:inset-x-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 sm:flex-nowrap">
          <div className="flex shrink-0 items-center gap-2">
          <div
            className={`flex shrink-0 items-center gap-1.5 transition-colors duration-200 ${
              isSaved ? 'text-ok' : 'text-warn'
            }`}
            role="status"
            aria-label={isSaved ? saveStatusText : 'טרם נשמר'}
            title={saveStatusText}
          >
            {isSaved ? (
              <CheckCircle2 className="size-4" aria-hidden />
            ) : (
              <span className="size-2 rounded-full bg-warn" aria-hidden />
            )}
            <span className="hidden text-[11px] font-semibold sm:inline">
              {isSaved ? 'נשמר' : 'טרם נשמר'}
            </span>
          </div>

          {locked ? (
            <span className="inline-flex h-10 shrink-0 items-center gap-1.5 text-[13px] font-semibold text-ok">
              <Lock className="size-4" aria-hidden />
              <span className="hidden sm:inline">הלוח נעול</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={trySave}
              aria-disabled={saveBlocked}
              title={saveBlockedReason ?? undefined}
              className={`ui-btn ui-btn-primary !h-10 shrink-0 !px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
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
          </div>

          <span className="hidden h-7 w-px shrink-0 bg-line sm:block" aria-hidden />

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-1 gap-y-1 sm:flex-nowrap sm:gap-2">
          <div className="relative shrink-0" ref={shareRootRef}>
            <button
              type="button"
              aria-label="שיתוף"
              aria-haspopup="menu"
              aria-expanded={shareOpen}
              disabled={shareBusy}
              title={exportBlock ?? 'שיתוף'}
              onClick={() => {
                if (exportBlock) {
                  notify.error('לא ניתן לייצא', exportBlock)
                  return
                }
                setShareOpen((o) => !o)
              }}
              className="ui-btn ui-btn-ghost !h-8 !w-8 !gap-1 !p-0 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60 sm:!h-10 sm:!w-auto sm:!px-3"
            >
              {shareBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <MessageCircle className="size-4" aria-hidden />
              )}
              <span className="hidden sm:inline">שיתוף</span>
              <ChevronDown className="hidden size-3.5 opacity-70 sm:block" aria-hidden />
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
              className="ui-btn ui-btn-ghost !h-8 !w-8 !p-0 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:!h-10 sm:!w-auto sm:!gap-2 sm:!px-3"
              title="השוואת חלופות"
              aria-label="השוואת חלופות"
            >
              <ArrowLeftRight className="size-4" aria-hidden />
              <span className="hidden sm:inline">השוואת חלופות</span>
            </button>
          ) : null}

          {!locked ? (
            <button
              type="button"
              onClick={confirmReassign}
              disabled={assigning}
              className="ui-btn !h-8 !w-8 !gap-0 !rounded-xl !bg-brand-soft !p-0 text-sm !font-semibold !text-brand transition hover:!bg-brand/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60 sm:!h-10 sm:!w-auto sm:!gap-2 sm:!px-3"
              title="שבץ מחדש"
              aria-label="שבץ מחדש"
            >
              <Sparkles className="size-4" aria-hidden />
              <span className="hidden sm:inline">שבץ מחדש</span>
            </button>
          ) : null}

          {!locked && onSignOff ? (
            <>
              <span className="hidden h-7 w-px shrink-0 bg-line sm:block" aria-hidden />
              <button
                type="button"
                onClick={trySignOff}
                aria-disabled={saveBlocked}
                title={
                  saveBlocked
                    ? 'אפשר לסגור רק כשהלוח תקין וכולם משובצים'
                    : 'סגירה נועלת את הלוח לעריכה'
                }
                className={`ui-btn ui-btn-secondary !h-8 !w-8 !gap-0 !p-0 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:!h-10 sm:!w-auto sm:!gap-2 sm:!px-3 ${
                  saveBlocked ? 'cursor-not-allowed opacity-40' : ''
                }`}
                aria-label="סגירת משמרת"
              >
                <Lock className="size-4" aria-hidden />
                <span className="hidden sm:inline">סגירת משמרת</span>
              </button>
            </>
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
