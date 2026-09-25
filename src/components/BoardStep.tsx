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
  Copy,
  Download,
  Info,
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
  X,
} from 'lucide-react'
import {
  afternoonHandoffTier,
  isQualified,
  type SameDayMorningContext,
} from '../algorithm'
import { IntensityBadge, Ltr } from './ui'
import { SHIFT_TYPE_LABELS, shiftSlotConflictMessage } from '../constants'
import type { ShiftDraft } from '../context/AppContext'
import {
  boardsEqual,
  countAssignmentChanges,
  formatOptimizationInfo,
  findWhyNotLine,
  LANE_NOTE_MAX_LENGTH,
  missingCertsForLane,
  partitionWarnings,
  pickExplainChips,
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
import { pluralizeHe } from '../lib/hebrew'
import { isGateManagerLane } from '../lib/gateManager'
import { notify } from '../lib/notify'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import { formatSetupDateLine, shiftWindowDisplay } from '../lib/shiftWizard'
import { postAuditEvent } from '../api'
import { useApp } from '../context/AppContext'
import type { AppData, LaneAssignment, ShiftType, Worker } from '../types'

type ExplanationGroup = {
  laneId: string
  laneName: string
  placements: { workerId: string; workerName: string; reasons: string[] }[]
}

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

function filterTechnicalReasons(reasons: string[], hideTechnical: boolean): string[] {
  if (!hideTechnical) return reasons
  return reasons.filter(
    (r) => !r.includes('סדר מילוי') && !r.includes('#'),
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
    removeWorkerFromShift,
    addSlotToLane,
    updateLaneNotes,
    user,
  } = useApp()

  const [boardBaseline, setBoardBaseline] = useState<BoardSnapshot>(() =>
    snapshotBoard(draft.assignments),
  )
  const [healthOpen, setHealthOpen] = useState(false)
  const [explainModalOpen, setExplainModalOpen] = useState(false)
  const [explainModalExpanded, setExplainModalExpanded] = useState(false)
  const [hideTechnical, setHideTechnical] = useState(true)
  const [explainFocus, setExplainFocus] = useState<{
    laneId: string
    workerId?: string
  } | null>(null)
  const [copyFlash, setCopyFlash] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [summaryMenuOpen, setSummaryMenuOpen] = useState(false)
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(() => new Set())
  const [openLaneMenu, setOpenLaneMenu] = useState<string | null>(null)
  const [swapTarget, setSwapTarget] = useState<{
    laneId: string
    slotIndex: number
    workerId: string
  } | null>(null)

  const explainTriggerRef = useRef<HTMLButtonElement | null>(null)
  const shareRootRef = useRef<HTMLDivElement | null>(null)
  const summaryMenuRef = useRef<HTMLDivElement | null>(null)
  const summaryBtnRef = useRef<HTMLButtonElement | null>(null)
  const summaryPanelRef = useRef<HTMLDivElement | null>(null)
  const laneBtnRefs = useRef(new Map<string, HTMLButtonElement>())
  const lanePanelRef = useRef<HTMLDivElement | null>(null)
  const modalRef = useRef<HTMLDivElement | null>(null)
  const [summaryPos, setSummaryPos] = useState<{ top: number; left: number } | null>(
    null,
  )
  const [laneMenuPos, setLaneMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  )

  const currentSnapshot = useMemo(
    () => snapshotBoard(draft.assignments),
    [draft.assignments],
  )
  const boardDirty = !boardsEqual(boardBaseline, currentSnapshot)

  useEffect(() => {
    setBoardBaseline(snapshotBoard(draft.assignments))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when parent bumps baselineKey
  }, [baselineKey])

  useEffect(() => {
    if (!requestExplainModal) return
    if ((draft.explanations?.length ?? 0) > 0) {
      setExplainModalExpanded(false)
      setExplainFocus(null)
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

  useLayoutEffect(() => {
    if (!openLaneMenu) {
      setLaneMenuPos(null)
      return
    }
    const place = () => {
      const anchor = laneBtnRefs.current.get(openLaneMenu)
      if (!anchor) return
      setLaneMenuPos(placeFloatingMenu(anchor, 192))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [openLaneMenu])

  useEffect(() => {
    if (!explainModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExplainModalOpen(false)
        explainTriggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [explainModalOpen])

  const showToast = useCallback((msg: string) => {
    notify.success(msg)
  }, [])

  const explanationGroups = useMemo((): ExplanationGroup[] => {
    if (!draft.explanations?.length) return []
    const groups: ExplanationGroup[] = []
    for (const laneId of draft.activeLaneIds) {
      const lane = data.lanes.find((l) => l.id === laneId)
      if (!lane) continue
      const placements = draft.explanations
        .filter((e) => e.laneId === laneId)
        .map((e) => ({
          workerId: e.workerId,
          workerName:
            data.workers.find((w) => w.id === e.workerId)?.fullName ?? e.workerId,
          reasons: e.reasons,
        }))
      if (placements.length === 0) continue
      groups.push({ laneId, laneName: lane.name, placements })
    }
    return groups
  }, [draft, data.lanes, data.workers])

  const explanationText = useMemo(() => {
    if (explanationGroups.length === 0) return ''
    const header = `הסבר שיבוץ · ${new Date(draft.date).toLocaleDateString('he-IL')} · ${SHIFT_TYPE_LABELS[draft.shiftType]}`
    const blocks = explanationGroups.map((g) => {
      const people = g.placements
        .map((p) => {
          const reasons = filterTechnicalReasons(p.reasons, hideTechnical)
          const bullets = reasons.map((r) => `  • ${r}`).join('\n')
          return `${p.workerName}\n${bullets}`
        })
        .join('\n')
      return `▸ ${g.laneName}\n${people}`
    })
    return [header, ...blocks].join('\n\n')
  }, [draft.date, draft.shiftType, explanationGroups, hideTechnical])

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
  const saveBlocked =
    Boolean(slotConflict) ||
    draft.unassignedWorkerIds.length > 0 ||
    hasBoardErrors

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
    updateAssignment(laneId, slotIndex, workerId)
  }

  const copyExplanations = async () => {
    if (!explanationText) return
    try {
      await navigator.clipboard.writeText(explanationText)
      setCopyFlash(true)
      window.setTimeout(() => setCopyFlash(false), 1600)
      notify.success('ההסבר הועתק')
    } catch {
      notify.error('ההעתקה נכשלה')
      window.prompt('העתיקו את ההסבר:', explanationText)
    }
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
    onReassign()
  }

  const gateManagerName = useMemo(() => {
    const id = draft.gateManagerWorkerId
    if (!id) return undefined
    return data.workers.find((w) => w.id === id)?.fullName ?? id
  }, [draft.gateManagerWorkerId, data.workers])

  const runShare = async (mode: 'whatsapp' | 'download') => {
    if (boardDirty) {
      notify.warning(
        'יש שינויים שלא נשמרו',
        'השיתוף משקף את הלוח הנוכחי.',
      )
    }
    setShareBusy(true)
    const meta = {
      preparedBy: user?.fullName,
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
    } finally {
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
        <select
          className={`min-w-0 w-full appearance-none rounded-xl border px-3 py-2.5 text-[15px] font-semibold tracking-tight text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.6)] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:py-3 sm:text-base ${
            selectedLacksCert
              ? 'border-warn/50 bg-warn-soft/40'
              : isExtra
                ? 'border-accent/40 bg-accent-soft/50'
                : 'border-line/90 bg-card'
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

  const filteredModalGroups = explainFocus
    ? explanationGroups
        .filter((g) => g.laneId === explainFocus.laneId)
        .map((g) => ({
          ...g,
          placements: explainFocus.workerId
            ? g.placements.filter((p) => p.workerId === explainFocus.workerId)
            : g.placements,
        }))
    : explanationGroups

  return (
    <section className="board-print-root space-y-4 pb-28 sm:space-y-5 sm:pb-32">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line/70 bg-card/90 px-4 py-3 shadow-[var(--shadow-panel)] backdrop-blur-sm no-print sm:px-5">
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-relaxed tracking-tight text-ink sm:text-sm">
          <span className="font-bold">{SHIFT_TYPE_LABELS[draft.shiftType]}</span>
          <span className="mx-2 text-ink-soft/70">·</span>
          <Ltr>{formatSetupDateLine(draft.date)}</Ltr>
          <span className="mx-2 text-ink-soft/70">·</span>
          <Ltr>{shiftWindowDisplay(draft.shiftType)}</Ltr>
          <span className="mx-2 text-ink-soft/70">·</span>
          <span className="tabular-nums">
            {pluralizeHe(draft.activeLaneIds.length, {
              one: 'נתיב אחד',
              two: 'שני נתיבים',
              many: 'נתיבים',
            })}
          </span>
          <span className="mx-2 text-ink-soft/70">·</span>
          <span className="tabular-nums">
            {pluralizeHe(draft.presentWorkerIds.length, {
              one: 'נוכח אחד',
              two: 'שני נוכחים',
              many: 'נוכחים',
            })}
          </span>
          {gateManagerName ? (
            <>
              <span className="mx-2 text-ink-soft/70">·</span>
              <span className="inline-flex items-center gap-1 font-semibold text-brand">
                <Shield className="size-3.5" aria-hidden />
                מנהל שער: {gateManagerName}
              </span>
            </>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onEditSettings}
          className="ui-btn ui-btn-ghost !py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          עריכת שיבוץ
        </button>
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
      </div>

      <div
        className={`rounded-2xl border px-4 py-3.5 shadow-[var(--shadow-panel)] sm:px-5 ${
          healthItems.length === 0
            ? 'border-ok/25 bg-ok-soft'
            : 'border-warn/30 bg-warn-soft/70'
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
              onClick={() => {
                setExplainFocus(null)
                setExplainModalExpanded(false)
                setExplainModalOpen(true)
              }}
              className="text-[11px] font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-xs"
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

      <div className="ui-panel-solid overflow-hidden shadow-[var(--shadow-panel-hover)] sm:rounded-[1.35rem]">
        <div className="relative overflow-hidden border-b border-white/10 bg-gradient-to-l from-brand-deep via-brand to-brand px-5 py-6 text-white sm:px-7 sm:py-7">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 20%, white 0.5px, transparent 0.6px)',
              backgroundSize: '14px 14px',
            }}
            aria-hidden
          />
          <p className="relative text-[10px] font-semibold tracking-[0.28em] text-white/55 sm:text-[11px]">
            שיבוצון
          </p>
          <h3 className="relative mt-1 font-display text-2xl font-bold tracking-tight sm:text-[1.75rem]">
            שיבוץ שער יציאה
          </h3>
          <p className="relative mt-1.5 text-sm text-white/75 sm:text-[15px]">
            {new Date(draft.date).toLocaleDateString('he-IL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}{' '}
            · {SHIFT_TYPE_LABELS[draft.shiftType]}
          </p>
        </div>

        <div className="flex flex-col gap-3 bg-surface/80 p-3 sm:gap-3.5 sm:p-4">
          {[...draft.activeLaneIds]
            .sort((a, b) => {
              const la = data.lanes.find((l) => l.id === a)
              const lb = data.lanes.find((l) => l.id === b)
              return (
                (la && isGateManagerLane(la) ? 0 : 1) -
                (lb && isGateManagerLane(lb) ? 0 : 1)
              )
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

            return (
              <div
                key={laneId}
                id={`board-lane-${laneId}`}
                className={`scroll-mt-24 rounded-2xl border px-3.5 py-3.5 shadow-[var(--shadow-panel)] sm:px-5 sm:py-4 ${
                  isGateLane
                    ? 'border-brand/20 bg-brand/[0.06]'
                    : 'border-line/80 bg-card'
                }`}
              >
                <div className="flex min-h-10 flex-wrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <h4 className="font-display text-base font-bold tracking-tight text-ink sm:text-lg">
                      {isGateLane ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Shield className="size-4 text-brand" aria-hidden />
                          {lane.name}
                        </span>
                      ) : (
                        lane.name
                      )}
                    </h4>
                    {isGateLane ? (
                      <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[9px] font-bold text-brand sm:text-[10px]">
                        שובץ אוטומטית
                      </span>
                    ) : (
                      <IntensityBadge intensity={lane.intensity} />
                    )}
                    {draft.shiftType === 'afternoon' && lane.afternoonHandoff ? (
                      <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold text-accent sm:text-[10px]">
                        החלפת צהריים
                      </span>
                    ) : null}
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums sm:text-[11px] ${
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
                  {!isGateLane ? (
                  <div className="relative no-print">
                    <button
                      ref={(node) => {
                        if (node) laneBtnRefs.current.set(laneId, node)
                        else laneBtnRefs.current.delete(laneId)
                      }}
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={openLaneMenu === laneId}
                      aria-label={`פעולות בנתיב ${lane.name}`}
                      onClick={() =>
                        setOpenLaneMenu((cur) => (cur === laneId ? null : laneId))
                      }
                      className="inline-flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </button>
                    {openLaneMenu === laneId && laneMenuPos
                      ? createPortal(
                          <div
                            ref={lanePanelRef}
                            role="menu"
                            className="fixed z-[200] min-w-[11rem] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[var(--shadow-panel-hover)]"
                            style={{ top: laneMenuPos.top, left: laneMenuPos.left }}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] font-semibold text-ink hover:bg-surface"
                              onClick={() => {
                                setOpenLaneMenu(null)
                                addSlotToLane(laneId)
                              }}
                              aria-label={`הוסף משבצת מעבר לתקן בנתיב ${lane.name}`}
                            >
                              <Plus className="size-3.5" aria-hidden />
                              הוסף משבצת
                            </button>
                          </div>,
                          document.body,
                        )
                      : null}
                  </div>
                  ) : null}
                </div>

                <div className="mt-3 space-y-2.5">
                  {slots.map((workerId, slotIndex) => {
                    if (isGateLane) {
                      const name =
                        data.workers.find((w) => w.id === workerId)?.fullName ??
                        (workerId || '—')
                      return (
                        <div
                          key={slotIndex}
                          className="flex items-center gap-3 rounded-xl border border-brand/20 bg-card px-4 py-3 shadow-sm"
                        >
                          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                            <Shield className="size-4" aria-hidden />
                          </span>
                          <span className="text-base font-semibold tracking-tight text-ink">{name}</span>
                        </div>
                      )
                    }
                    const placement = draft.explanations?.find(
                      (e) => e.laneId === laneId && e.workerId === workerId,
                    )
                    const chips = placement ? pickExplainChips(placement.reasons) : []
                    const whyNot = placement
                      ? findWhyNotLine(placement.reasons)
                      : null

                    return (
                      <div key={slotIndex} className="flex flex-wrap items-center gap-2 sm:gap-3">
                        {std > 1 ? (
                          <span className="w-4 text-[10px] text-ink-soft tabular-nums sm:w-5 sm:text-xs">
                            {slotIndex + 1}.
                          </span>
                        ) : (
                          <span className="w-0 sm:w-0" aria-hidden />
                        )}
                        {renderWorkerSelect(lane, laneId, slotIndex, workerId, std)}
                        {workerId && placement ? (
                          <div className="flex flex-wrap items-center gap-1 no-print">
                            {chips.slice(0, 2).map((c) => (
                              <span
                                key={c}
                                className="max-w-[8rem] truncate rounded-md bg-surface px-1.5 py-0.5 text-[10px] text-ink-soft ring-1 ring-line sm:max-w-[10rem] sm:text-[11px]"
                                title={c}
                              >
                                {c}
                              </span>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setExplainFocus({ laneId, workerId })
                                setExplainModalExpanded(true)
                                setExplainModalOpen(true)
                              }}
                              className="text-[10px] font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-[11px]"
                            >
                              למה?
                            </button>
                          </div>
                        ) : null}
                        {workerId ? (
                          <div className="flex shrink-0 overflow-hidden rounded-xl border border-line bg-surface no-print">
                            <button
                              type="button"
                              onClick={() =>
                                setSwapTarget({ laneId, slotIndex, workerId })
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold text-brand transition hover:bg-brand/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                              title="החלף עם נתיב אחר"
                            >
                              <ArrowLeftRight className="size-3.5" aria-hidden />
                              החלף
                            </button>
                            <button
                              type="button"
                              onClick={() => removeWorkerFromShift(workerId)}
                              className="inline-flex items-center gap-1.5 border-s border-line px-3 py-2.5 text-xs font-bold text-hard transition hover:bg-hard-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                              title="הסר מהשיבוץ ומהנוכחות"
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                              הסר
                            </button>
                          </div>
                        ) : null}
                        {whyNot && workerId ? (
                          <p className="w-full text-[10px] text-ink-soft sm:text-[11px]">
                            {whyNot}
                          </p>
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
                        onChange={(e) => updateLaneNotes(laneId, e.target.value)}
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
        </div>

        {draft.unassignedWorkerIds.length > 0 ? (
          <div className="rounded-2xl border border-line/80 bg-card px-4 py-3.5 shadow-[var(--shadow-panel)] sm:px-5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-ink-soft sm:mb-2 sm:text-xs">
              <UserMinus className="size-3 sm:size-3.5" aria-hidden />
              לא שובצו
            </p>
            <ul className="flex flex-wrap gap-1.5 no-print">
              {draft.unassignedWorkerIds.map((id) => {
                const name = data.workers.find((w) => w.id === id)?.fullName ?? id
                return (
                  <li
                    key={id}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink"
                  >
                    <span>{name}</span>
                    <button
                      type="button"
                      onClick={() => onOpenExtraPick(undefined, id)}
                      className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      הוספה לנתיב
                    </button>
                    <button
                      type="button"
                      onClick={() => removeWorkerFromShift(id)}
                      className="inline-flex size-5 items-center justify-center rounded-md text-hard hover:bg-hard-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      title={`הסר את ${name}`}
                      aria-label={`הסר את ${name}`}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onBackToAttendance}
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand no-print sm:text-sm"
      >
        <ChevronRight className="size-3.5 sm:size-4" aria-hidden />
        חזרה לנוכחות
      </button>

      {/* Sticky actions */}
      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-line/80 bg-card/95 px-3 py-2.5 shadow-[0_-8px_24px_rgb(15_28_46/0.08)] backdrop-blur-md no-print sm:px-4 lg:bottom-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saveBlocked}
            title={
              slotConflict
                ? 'כבר קיים שיבוץ לאותו תאריך ומשמרת'
                : draft.unassignedWorkerIds.length > 0
                  ? 'יש בודקים שלא שובצו'
                  : hasBoardErrors
                    ? 'יש שגיאות בלוח'
                    : undefined
            }
            className={`ui-btn ui-btn-primary !py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 ${
              saveFlash ? '!bg-ok hover:!bg-ok' : ''
            }`}
          >
            {saveFlash ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            שמירה
          </button>
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
          <div className="relative ms-auto" ref={shareRootRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={shareOpen}
              disabled={shareBusy}
              onClick={() => setShareOpen((o) => !o)}
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
          <button
            type="button"
            onClick={confirmReassign}
            className="ui-btn ui-btn-secondary !py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Sparkles className="size-4" aria-hidden />
            שבץ מחדש
          </button>
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
                              swapAssignments(
                                {
                                  laneId: swapTarget.laneId,
                                  slotIndex: swapTarget.slotIndex,
                                },
                                {
                                  laneId: opt.laneId,
                                  slotIndex: opt.slotIndex,
                                },
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

      {/* Explain modal — portaled so overlay covers full viewport (main has transform) */}
      {explainModalOpen && explanationGroups.length > 0
        ? createPortal(
            <div className="fixed inset-0 z-[200] flex items-end justify-center bg-ink/50 p-3 no-print sm:items-center sm:p-4">
              <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="explain-modal-title"
                className="flex max-h-[85vh] w-full max-w-lg flex-col animate-fade-up rounded-2xl border border-line bg-card shadow-xl"
              >
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-xl bg-accent-soft text-accent sm:size-9">
                      <Info className="size-4 sm:size-5" aria-hidden />
                    </span>
                    <div>
                      <h3
                        id="explain-modal-title"
                        className="font-display text-base font-bold text-ink sm:text-lg"
                      >
                        הסבר השיבוץ
                      </h3>
                      <p className="text-[11px] text-ink-soft sm:text-xs">
                        {explainModalExpanded ? 'פירוט מלא' : 'תצוגה מקוצרת'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setExplainModalOpen(false)
                      explainTriggerRef.current?.focus()
                    }}
                    className="rounded-lg p-1.5 text-ink-soft hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    aria-label="סגור"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
                  {filteredModalGroups.map((g) => (
                    <div
                      key={g.laneId}
                      className="mb-3 rounded-xl border border-line bg-surface/70 px-3 py-2.5 last:mb-0"
                    >
                      <h4 className="mb-1 text-sm font-bold text-brand">{g.laneName}</h4>
                      {!explainModalExpanded ? (
                        <p className="text-xs text-ink-soft sm:text-sm">
                          {g.placements.map((p) => p.workerName).join(' · ')}
                        </p>
                      ) : (
                        <div className="mt-1.5 space-y-2.5">
                          {g.placements.map((p) => (
                            <div key={`${g.laneId}-${p.workerId}`}>
                              <p className="text-xs font-semibold text-ink sm:text-sm">
                                {p.workerName}
                              </p>
                              <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-[11px] leading-relaxed text-ink-soft sm:text-xs">
                                {filterTechnicalReasons(p.reasons, hideTechnical).map(
                                  (r, i) => (
                                    <li key={i}>{r}</li>
                                  ),
                                )}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5">
                  <button
                    type="button"
                    onClick={() => setHideTechnical((h) => !h)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-sm"
                  >
                    {hideTechnical ? 'הצג פרטים טכניים' : 'הסתר פרטים טכניים'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExplainModalExpanded((o) => !o)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-sm"
                  >
                    {explainModalExpanded ? (
                      <ChevronUp className="size-3.5" aria-hidden />
                    ) : (
                      <ChevronDown className="size-3.5" aria-hidden />
                    )}
                    {explainModalExpanded ? 'מזער' : 'פירוט מלא'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyExplanations()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-sm"
                  >
                    {copyFlash ? (
                      <Check className="size-3.5 text-ok" aria-hidden />
                    ) : (
                      <Copy className="size-3.5" aria-hidden />
                    )}
                    {copyFlash ? 'הועתק' : 'העתק'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExplainModalOpen(false)
                      explainTriggerRef.current?.focus()
                    }}
                    className="ms-auto inline-flex flex-1 items-center justify-center rounded-xl bg-accent px-3.5 py-2 text-xs font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-none sm:px-5 sm:text-sm"
                  >
                    סגור
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}
