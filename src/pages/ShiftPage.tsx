import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  Lock,
  MoreHorizontal,
  Save,
  Table2,
  LayoutList,
} from 'lucide-react'
import {
  isQualified,
  buildSameDayMorningContext,
  needsAfternoonNightRecovery,
} from '../algorithm'
import { MODULE_LABELS, peopleLabelsForModule } from '../auth'
import { useApp } from '../context/AppContext'
import {
  assessBoardQualityAlert,
  collectRecentQualityScores,
} from '../lib/boardQualityAlert'
import { notify } from '../lib/notify'
import { ShiftDropDialog, ShiftDropSummary } from '../components/ShiftDropDialog'
import { ShiftClosedBanner, ShiftSignOffDialog } from '../components/ShiftSignOffDialog'
import { BoardCompareDialog } from '../components/BoardCompareDialog'
import type { AssignmentResult } from '../algorithm'
import {
  findShiftForSlot,
  getCurrentShiftContext,
  shiftSlotConflictMessage,
} from '../constants'
import {
  activeAttendanceWorkers,
  isGateManagerLane,
  laneStaffPresentIds,
  managedLanes,
  selectorStaff,
} from '../lib/gateManager'
import { IntensityBadge, Ltr, TraineeBadge } from '../components/ui'
import { LateMinutesControl } from '../components/LateMinutesControl'
import { AttendanceWorkerExtras } from '../components/AttendanceWorkerExtras'
import { BoardStep } from '../components/BoardStep'
import { SelectorRoundTable } from '../components/SelectorRoundTable'
import { usesRounds } from '../lib/assignmentMode'
import { selectorLanes, selectorRoundsHavePlacements } from '../lib/selectorRounds'
import {
  continuesIntoShift,
  earlierShiftsToContinue,
  presetsOverlappingShift,
  shiftFollowsMorning,
  workerWindowById,
} from '../lib/shiftCatalog'
import {
  formatShiftModelWindow,
  resolveShiftModels,
  shiftModelLabel,
} from '../lib/shiftModels'
import {
  buildRoundsWhatsAppText,
  downloadRoundsImage,
  openWhatsAppShare,
  shareRoundsImage,
  type ExportRoundCell,
} from '../lib/export'
import { exportBlockedReason } from '../lib/exportGate'
import { buildShiftCloseSummary } from '../lib/shiftCloseSummary'
import { useUnsavedChangesGuard } from '../lib/useUnsavedChangesGuard'
import {
  fetchGuestWorkersRemote,
  postAuditEvent,
  reportShiftPresence,
  type GuestWorker,
} from '../api'
import { guestWorkerAsWorker, mergeShiftRoster } from '../lib/guestWorkers'
import { pluralizeHe } from '../lib/hebrew'
import { sortIdsByCatalogOrder } from '../lib/lanesCertHelpers'
import {
  effectiveStaffingStandard,
  headcountDeficit,
  staffingChoicesForLane,
} from '../lib/shiftStaffing'
import {
  attendanceStepSummary,
  canAdvanceFromAttendance,
  canAdvanceFromLanes,
  computeFeasibilityPreview,
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

const QUALITY_LABELS: Record<string, string> = {
  rotation: 'רוטציה בין נתיבים', workload: 'איזון עומס', recovery: 'מנוחה אחרי לילה',
  hardBalance: 'ניסיון ואיזון בעמדות קשות', handoff: 'החלפת צהריים',
  versatility: 'שמירת עובדים רב־תכליתיים', intensityDist: 'פיזור רמות קושי',
  idleOnHard: 'התאמת מנוחה לעמדה קשה', staffing: 'כיסוי תקנים', stability: 'יציבות השיבוץ',
}

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
    setTrainingPair,
    setManualPlacement,
    addGuestWorkers,
    setGateManager,
    setAllActiveLanes,
    setAllActiveWorkers,
    runAutoAssign,
    commitSelectorBoard,
    rebuildRoundsFromSettings,
    startManualAssign,
    updateSelectorCell,
    removeLaneFromShift,
    setWorkerWindow,
    setWindowAdjustment,
    setDefaultLateMinutes,
    recordShiftDrop,
    undoShiftDrop,
    addBoardLane,
    addExtraWorkerToLane,
    saveCurrentShift,
    signCurrentShift,
    confirmSelfHeal,
    editRemovalManually,
    dismissSelfHeal,
    healing,
    healPlan,
    unfreezePrompt,
    dismissUnfreezePrompt,
    keepLanesFrozen,
    unfreezeAndReassign,
    // manuallyUnfreezeLane, // TODO: add manual unfreeze button in lanes list
    remindUnfreezeLater,
    assigning,
    assignProgress,
    previewBoardOptions,
    applyBoardOption,
    startShift,
    discardDraft,
    loadShiftFromHistory,
    draftDirty,
    restoreDraftSnapshot,
    setView,
    user,
    module,
  } = useApp()
  const people = peopleLabelsForModule(module)
  const roleName = people.plural

  const draftRef = useRef(draft)
  draftRef.current = draft
  const [roundsMoreOpen, setRoundsMoreOpen] = useState(false)
  const [roundsWarningsOpen, setRoundsWarningsOpen] = useState(false)
  const [roundsWarningsDismissed, setRoundsWarningsDismissed] = useState(false)
  const [roundsLayout, setRoundsLayout] = useState<'cards' | 'table'>('cards')
  const [assignPreview, setAssignPreview] = useState<{
    before: NonNullable<typeof draft>
  } | null>(null)
  const [roundsRebuildPreview, setRoundsRebuildPreview] = useState<{
    keepRounds: NonNullable<NonNullable<typeof draft>['rounds']>
    emptyRounds: NonNullable<NonNullable<typeof draft>['rounds']>
    fromLabels: string[]
    toLabels: string[]
  } | null>(null)
  const roundsMoreRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!roundsMoreOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRoundsMoreOpen(false)
    }
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (target && roundsMoreRef.current?.contains(target)) return
      // Bottom-sheet portal is outside the ref; ignore that case via role=menu parent check.
      if (target instanceof Element && target.closest('[role="menu"]')) return
      setRoundsMoreOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [roundsMoreOpen])

  useEffect(() => {
    setRoundsWarningsDismissed(false)
    setRoundsWarningsOpen(false)
  }, [draft?.warnings?.join('|')])

  const runWithUndo = useCallback(
    (message: string, action: () => void, major = false) => {
      const current = draftRef.current
      if (!current || current.signOff?.signedAt) {
        action()
        return
      }
      const snapshot = JSON.parse(JSON.stringify(current)) as typeof current
      action()
      notify.undoable(message, () => restoreDraftSnapshot(snapshot), { major })
    },
    [restoreDraftSnapshot],
  )

  const exportBlock = useMemo(() => {
    if (!draft) return 'אין שיבוץ פתוח לייצוא.'
    return exportBlockedReason({
      draftId: draft.id,
      historyIds: data.history.map((h) => h.id),
      draftDirty,
    })
  }, [draft, data.history, draftDirty])

  useUnsavedChangesGuard(Boolean(draft && draftDirty && !draft.signOff?.signedAt))

  const closeSummary = useMemo(() => {
    if (!draft) return null
    return buildShiftCloseSummary(draft, data.lanes, data.workers)
  }, [draft, data.lanes, data.workers])

  const qualityVsHistory = useMemo(() => {
    if (!draft?.quality?.score || draft.quality.legal === false) return null
    const historyScores = collectRecentQualityScores(data.history, {
      beforeDate: draft.date,
    })
    return assessBoardQualityAlert(draft.quality.score, historyScores)
  }, [data.history, draft?.date, draft?.quality])

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
  const [signOpen, setSignOpen] = useState(false)
  const [signBusy, setSignBusy] = useState(false)
  const [dropWorkerId, setDropWorkerId] = useState<string | null>(null)
  const [addPicker, setAddPicker] = useState<'lane' | 'worker' | null>(null)
  const [compareOptions, setCompareOptions] = useState<{
    loadFair: AssignmentResult
    hardExperience: AssignmentResult
  } | null>(null)
  const [otherEditors, setOtherEditors] = useState<string[]>([])
  const [feasibilityOpen, setFeasibilityOpen] = useState(false)
  const [attendanceQuery, setAttendanceQuery] = useState('')
  const discardTriggerRef = useRef<HTMLButtonElement | null>(null)
  const shiftModels = useMemo(
    () => resolveShiftModels(data.shiftModels, module),
    [data.shiftModels, module],
  )

  useEffect(() => {
    if (!draft?.id) {
      setOtherEditors([])
      return
    }
    let stop = false
    const ping = async () => {
      try {
        const result = await reportShiftPresence(draft.id)
        if (!stop) setOtherEditors(result.others)
      } catch {
        if (!stop) setOtherEditors([])
      }
    }
    void ping()
    const timer = window.setInterval(() => void ping(), 15000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [draft?.id])

  const selectableLanes = useMemo(
    () =>
      managedLanes(data.lanes).filter(
        (lane) => !(draft && usesRounds(draft) && lane.roundsDisabled),
      ),
    [data.lanes, draft],
  )

  const exportLines = useMemo(() => {
    if (!draft) return []
    return sortIdsByCatalogOrder(draft.activeLaneIds, data.lanes).flatMap(
      (laneId) => {
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
      },
    )
  }, [draft, data.lanes, data.workers])

  const unassignedNames = useMemo(() => {
    if (!draft) return []
    return draft.unassignedWorkerIds.map(
      (id) => data.workers.find((w) => w.id === id)?.fullName ?? id,
    )
  }, [draft, data.workers])

  const roundExport = useMemo(() => {
    if (!draft || !usesRounds(draft)) {
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
    if (exportBlock) {
      notify.error('לא ניתן לייצא', exportBlock)
      return
    }
    const meta = { preparedBy: user?.fullName, organizationName: user?.orgName || undefined }
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
        `${draft.date} · ${shiftModelLabel(shiftModels, draft.shiftType)} · ייצוא ${roleName} · ${roundExport.rounds.length} סבבים`,
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

  const [guestCatalog, setGuestCatalog] = useState<GuestWorker[]>([])
  const [guestPickerOpen, setGuestPickerOpen] = useState(false)
  const [guestLoading, setGuestLoading] = useState(false)
  const [guestPickIds, setGuestPickIds] = useState<string[]>([])

  const loadGuestCatalog = useCallback(async () => {
    setGuestLoading(true)
    try {
      setGuestCatalog(await fetchGuestWorkersRemote())
    } catch {
      notify.error('לא ניתן לטעון עובדים ממחלקות אחרות')
      setGuestCatalog([])
    } finally {
      setGuestLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!draft?.guestWorkerIds?.length) return
    if (guestCatalog.length > 0) return
    void loadGuestCatalog()
  }, [draft?.guestWorkerIds, guestCatalog.length, loadGuestCatalog])

  const guestWorkerModels = useMemo(
    () => guestCatalog.map(guestWorkerAsWorker),
    [guestCatalog],
  )
  const shiftRoster = useMemo(
    () => mergeShiftRoster(data.workers, guestWorkerModels),
    [data.workers, guestWorkerModels],
  )
  const guestIdSet = useMemo(
    () => new Set(draft?.guestWorkerIds ?? []),
    [draft?.guestWorkerIds],
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
      return (!lane || !isGateManagerLane(lane)) && !(usesRounds(draft) && lane?.roundsDisabled)
    })
    return computeFeasibilityPreview(
      data.lanes,
      laneIds,
      lanePresent,
      data.workers,
      draft.staffingOverrides,
    )
  }, [draft, data.lanes, data.workers])

  const missingHeadcount = useMemo(
    () =>
      headcountDeficit(
        draft?.presentWorkerIds.length ?? 0,
        draft?.headcountStandard,
      ),
    [draft?.presentWorkerIds.length, draft?.headcountStandard],
  )

  const lastSameType = useMemo(() => {
    if (!draft) return null
    return mostRecentShiftOfType(data.history, draft.shiftType, draft.id)
  }, [draft, data.history])

  const lanesAdvance = canAdvanceFromLanes(
    draft
      ? draft.activeLaneIds.filter((id) => {
          const lane = data.lanes.find((l) => l.id === id)
          return lane && !isGateManagerLane(lane) && !(usesRounds(draft) && lane.roundsDisabled)
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
    const localIds = new Set(attendanceWorkers.map((w) => w.id))
    const guestPresent = guestWorkerModels.filter(
      (w) =>
        (draft?.guestWorkerIds?.includes(w.id) ||
          draft?.presentWorkerIds.includes(w.id)) &&
        !localIds.has(w.id),
    )
    const base = [...attendanceWorkers, ...guestPresent]
    const q = base.filter((w) => workerMatchesNameQuery(w, attendanceQuery))
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
  }, [
    attendanceWorkers,
    guestWorkerModels,
    attendanceQuery,
    draft,
    morningShift,
  ])

  useEffect(() => {
    if (!draft) return
    const sourceTypes = earlierShiftsToContinue(draft.shiftType)
    if (sourceTypes.length === 0) return
    if (draft.presentWorkerIds.length > 0) return
    const audience = draft.audience ?? 'inspector'
    const ids: string[] = []
    const workerWindows: Record<string, string> = {}
    for (const sourceType of sourceTypes) {
      const matches = data.history.filter(
        (shift) => shift.date === draft.date && shift.shiftType === sourceType,
      )
      const sameAudience = matches.filter(
        (shift) => (shift.audience ?? 'inspector') === audience,
      )
      const source = (sameAudience.length > 0 ? sameAudience : matches).sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      )[0]
      if (!source) continue
      for (const id of source.presentWorkerIds) {
        const saved = source.workerWindows?.[id]
        if (!continuesIntoShift(sourceType, saved, draft.shiftType)) continue
        if (!ids.includes(id)) ids.push(id)
        if (saved && workerWindowById(saved) && !workerWindows[id]) {
          workerWindows[id] = saved
        }
      }
    }
    if (ids.length === 0) return
    applyPresentSelection(ids, { workerWindows })
  }, [draft, data.history, applyPresentSelection])

  const handleAutoAssign = async () => {
    if (assigning) return
    setExtraAskedOnce(false)
    setExtraFlow('closed')
    setSaveFlash(false)
    const preAssign = draftRef.current
    const snapshot =
      preAssign && !preAssign.signOff?.signedAt
        ? (JSON.parse(JSON.stringify(preAssign)) as typeof preAssign)
        : null
    const ok = await runAutoAssign()
    if (!ok) {
      if (snapshot) restoreDraftSnapshot(snapshot)
      return
    }
    // Always show Apply/Cancel preview; Cancel restores the pre-assign board.
    if (snapshot) {
      setAssignPreview({ before: snapshot })
      setBoardBaselineKey((k) => k + 1)
      return
    }
    setRequestExplainModal(true)
    setBoardBaselineKey((k) => k + 1)
  }

  const handleManualAssign = () => {
    if (
      (draft && usesRounds(draft)
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
    runWithUndo('לוח ידני', () => startManualAssign())
    setBoardBaselineKey((k) => k + 1)
  }

  // Surplus prompt — only once after each auto-assign
  useEffect(() => {
    if (!draft || shiftStep !== 'board' || extraAskedOnce) return
    if (usesRounds(draft)) return
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
    if (shiftStep !== 'board' || !draft || !usesRounds(draft)) return
    if (draft.audience === 'selector' || (draft.rounds?.length ?? 0) > 0) return
    commitSelectorBoard()
  }, [shiftStep, draft, commitSelectorBoard])

  useEffect(() => {
    if (draft?.signOff?.signedAt && shiftStep !== 'board') setShiftStep('board')
  }, [draft?.signOff?.signedAt, shiftStep, setShiftStep])

  const handleSave = async () => {
    if (!draft) return
    if (slotConflict) {
      notify.error(shiftSlotConflictMessage(draft.date, draft.shiftType))
      return
    }
    if (!usesRounds(draft) && draft.unassignedWorkerIds.length > 0) {
      setSaveFlash(false)
      notify.error(
        'לא ניתן לשמור',
        `נשארו ${draft.unassignedWorkerIds.length} ${roleName} שלא שובצו לעמדה. שבצו את כולם לפני השמירה.`,
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

  const openSignOff = () => {
    if (!draft || draft.signOff?.signedAt) return
    if (slotConflict) {
      notify.error(shiftSlotConflictMessage(draft.date, draft.shiftType))
      return
    }
    if (!usesRounds(draft) && draft.unassignedWorkerIds.length > 0) {
      notify.error(
        'לא ניתן לסגור',
        `נשארו ${draft.unassignedWorkerIds.length} ${roleName} שלא שובצו לעמדה. שבצו את כולם לפני הסגירה.`,
      )
      return
    }
    setSignOpen(true)
  }

  const confirmSignOff = async (signature: string) => {
    setSignBusy(true)
    try {
      await signCurrentShift(signature)
      setSignOpen(false)
      notify.success('המשמרת נסגרה', 'הלוח נעול לעריכה ולמחיקה.')
    } catch {
      /* error shown via context + toast */
    } finally {
      setSignBusy(false)
    }
  }

  const openCompare = () => {
    if (!draft || draft.signOff?.signedAt || usesRounds(draft)) return
    const options = previewBoardOptions()
    if (!options) {
      notify.error(
        'אין מה להשוות',
        'צריך נתיבים ונוכחים במשמרת לפני שאפשר להכין שתי חלופות.',
      )
      return
    }
    setCompareOptions(options)
  }

  const chooseBoardOption = (result: AssignmentResult, label: string) => {
    const filled = draft?.assignments.some((row) => row.workerIds.some(Boolean))
    if (
      filled &&
      !window.confirm('החלופה תחליף את השיבוץ שבלוח. להמשיך?')
    ) {
      return
    }
    applyBoardOption(result, label)
    setCompareOptions(null)
    setExtraAskedOnce(false)
    setExtraFlow('closed')
    setSaveFlash(false)
    setBoardBaselineKey((key) => key + 1)
    notify.success('החלופה הוכנסה ללוח', 'אפשר לשמור אותה כשהלוח מוכן.')
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
          ? 'pb-48 lg:pb-32'
          : 'pb-44 sm:pb-36'
      }`}
    >
      {usesRounds(draft) && shiftStep !== 'board' ? (
        <p className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
          שיבוץ {roleName} בסבבים. בסוף התהליך מתקבלת טבלה: כל שורה היא סבב של שעתיים מתחילת המשמרת, וכל עמודה היא נתיב. האנשים מתחלפים בין הנתיבים בכל סבב.
        </p>
      ) : null}
      {shiftStep !== 'board' ? (
      <div className="ui-panel-solid flex flex-wrap items-end gap-3 rounded-2xl border-brand/10 bg-gradient-to-l from-brand/[0.045] via-card to-card p-4 shadow-[var(--shadow-panel)] sm:p-5">
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
            {shiftModels.map((model) => {
              const taken = Boolean(
                findShiftForSlot(
                  data.history,
                  draft.date,
                  model.id as ShiftType,
                  draft.id,
                  draft.audience,
                ),
              )
              return (
                <option key={model.id} value={model.id}>
                  {model.name}
                  {taken ? ' (קיים שמור)' : ''}
                </option>
              )
            })}
          </select>
          <p className="mt-1 text-[13px] text-ink-soft">
            <Ltr>
              {(() => {
                const model = shiftModels.find((item) => item.id === draft.shiftType)
                return model
                  ? formatShiftModelWindow(model)
                  : shiftWindowDisplay(draft.shiftType)
              })()}
            </Ltr>
          </p>
        </label>
        <label className="text-xs sm:text-sm">
          <span className="mb-1.5 block text-[10px] font-medium text-ink-soft sm:text-xs">
            תקן משמרת
          </span>
          <input
            type="number"
            min={1}
            max={99}
            inputMode="numeric"
            className="ui-field !w-auto min-w-[5.5rem] !py-1.5 !text-xs sm:!py-2 sm:!text-sm"
            value={draft.headcountStandard ?? ''}
            placeholder="—"
            aria-label="תקן משמרת — מספר אנשים נדרש למשמרת"
            onChange={(e) => {
              const raw = e.target.value
              updateDraftMeta({
                headcountStandard:
                  raw.trim() === '' ? undefined : Number(raw),
              })
            }}
          />
          <p className="mt-1 text-[13px] text-ink-soft">
            {draft.headcountStandard != null
              ? missingHeadcount > 0
                ? `נוכחים ${draft.presentWorkerIds.length} · חסרים ${missingHeadcount}`
                : `נוכחים ${draft.presentWorkerIds.length} · מלא`
              : 'אופציונלי — מעקב חוסר'}
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
                    draft.headcountStandard,
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
                    ? 'bg-brand text-white shadow-md ring-2 ring-brand/15 ring-offset-2 ring-offset-card'
                    : done
                      ? 'bg-ok-soft text-ok ring-1 ring-ok/15'
                      : blocked
                        ? 'bg-card text-ink-soft/50 ring-1 ring-line/80'
                      : 'bg-card text-ink-soft ring-1 ring-line/80 hover:border-brand/20 hover:text-ink'
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

      {otherEditors.length > 0 ? (
        <p className="rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn">
          גם {otherEditors.join(', ')} עורך את המשמרת הזו עכשיו. שמירה עלולה לדרוס את העבודה שלו.
        </p>
      ) : null}

      {shiftStep === 'lanes' && (
        <section className="ui-panel-solid rounded-2xl border-brand/10 p-4 shadow-[var(--shadow-panel)] sm:p-5">
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
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-3">
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
                        className={`flex min-h-[4.25rem] w-full items-center gap-3 rounded-2xl border px-3 py-2 transition duration-150 sm:gap-4 sm:px-4 ${
                          on
                            ? 'border-brand/35 bg-brand/[0.045] shadow-sm ring-1 ring-brand/15'
                            : 'border-line/80 bg-card hover:border-brand/25 hover:shadow-sm'
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
                                  פתוח לכל {people.thePlural}
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
                          <div className="inline-flex rounded-xl bg-surface p-1 ring-1 ring-line/80">
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
                                className={`min-h-10 min-w-10 rounded-lg text-[13px] font-bold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed ${
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
        <section className="ui-panel-solid rounded-2xl border-brand/10 p-4 shadow-[var(--shadow-panel)] sm:p-5">
          {attendanceWorkers.length === 0 ? (
            <div className="ui-empty">
              <p className="ui-empty-title">אין {people.plural} פעילים</p>
              <p className="ui-empty-text">
                הוסיפו או הפעילו {people.plural} במאגר. מנהל בלבד לא מופיע בשיבוץ.
              </p>
              <button
                type="button"
                onClick={() => setView('workers')}
                className="ui-btn ui-btn-primary mt-2"
              >
                למאגר {people.plural}
              </button>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-3">
                <div>
                  <h2 className="ui-title">סימון נוכחות</h2>
                  <p className="mt-1 inline-flex rounded-full bg-brand/8 px-2.5 py-1 text-[13px] font-bold text-brand-deep tabular-nums">
                    נוכחים: {draft.presentWorkerIds.length} מתוך{' '}
                    {attendanceWorkers.length}
                    {draft.gateManagerWorkerId
                      ? ' · כולל מנהל משמרת'
                      : ''}
                  </p>
                  <LateMinutesControl
                    className="mt-3"
                    variant="bar"
                    label="איחור כללי למשמרת"
                    hint="חל על כל הנוכחים · אפשר לשנות לאדם למטה"
                    value={draft.defaultLateMinutes ?? 0}
                    onChange={(minutes) => setDefaultLateMinutes(minutes, true)}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 rounded-xl bg-surface/70 p-1 ring-1 ring-line/70">
                  <button
                    type="button"
                    onClick={() => setAllActiveWorkers(true)}
                    className="ui-btn ui-btn-secondary min-h-10 !py-1.5 text-xs"
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
                    className="ui-btn ui-btn-ghost min-h-10 !py-1.5 text-xs disabled:opacity-60"
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
                      className="ui-btn ui-btn-secondary min-h-10 !py-1.5 text-xs"
                      title="המשך מנהל המשמרת מהבוקר"
                    >
                      מנהל משמרת מהבוקר
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setAllActiveWorkers(false)}
                    className="ui-btn ui-btn-ghost min-h-10 !py-1.5 text-xs"
                  >
                    ניקוי
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGuestPickIds([])
                      setGuestPickerOpen(true)
                      void loadGuestCatalog()
                    }}
                    className="ui-btn ui-btn-secondary min-h-10 !py-1.5 text-xs"
                  >
                    הוסף מאורח ממחלקה אחרת
                  </button>
                </div>
              </div>
              <div className="relative mb-4">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
                  aria-hidden
                />
                <input
                  type="search"
                  value={attendanceQuery}
                  onChange={(e) => setAttendanceQuery(e.target.value)}
                  placeholder="חיפוש לפי שם"
                  aria-label={`חיפוש ${people.plural}`}
                  className="ui-field min-h-11 w-full pe-3 ps-10"
                />
              </div>
              <ul className="grid items-start gap-2 sm:grid-cols-2">
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
                        className={`flex w-full flex-col rounded-2xl border transition-colors duration-150 ${
                          on || isGate
                            ? 'border-brand/40 bg-brand/[0.045] shadow-sm ring-2 ring-brand/10'
                            : 'border-line/80 bg-card hover:border-brand/25 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex min-h-[4.25rem] items-stretch gap-1 sm:gap-1.5">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          disabled={managerOnly}
                          title={
                            managerOnly
                              ? 'מנהל בלבד — הפעילו «מנהל משמרת» כדי לכלול במשמרת'
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
                          className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-right transition-colors hover:bg-brand/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:px-4 ${
                            managerOnly ? 'cursor-default opacity-90' : ''
                          }`}
                        >
                          <span
                            className={`flex size-6 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                              on || (managerOnly && isGate)
                                ? 'border-brand bg-brand text-white shadow-sm'
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
                              <span className="text-sm font-bold text-ink sm:text-[15px]">
                                {w.fullName}
                              </span>
                              {w.trainingRole === 'trainee' ? (
                                <TraineeBadge />
                              ) : null}
                              {guestIdSet.has(w.id) ? (
                                <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent">
                                  אורח
                                </span>
                              ) : null}
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
                                  מנהל משמרת בבוקר
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
                                ישובץ אוטומטית כמנהל משמרת
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
                            className={`m-1.5 flex min-h-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2.5 py-1.5 text-[10px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                              isGate
                                ? 'bg-brand text-white shadow-sm'
                                : 'bg-surface text-ink-soft ring-1 ring-line hover:bg-brand/10 hover:text-brand'
                            }`}
                            title={
                              isGate
                                ? 'בטל מנהל משמרת'
                                : 'הפעל כמנהל משמרת'
                            }
                          >
                            <Shield className="size-3.5" aria-hidden />
                            מנהל משמרת
                          </button>
                        ) : null}
                        </div>
                        {on && !isGate ? (
                          (() => {
                            const mentorPair = (draft.trainingPairs ?? []).find(
                              (pair) => pair.mentorId === w.id,
                            )
                            const preferredLaneId =
                              mentorPair?.laneId ??
                              draft.manualPlacements?.find(
                                (p) => p.workerId === w.id,
                              )?.laneId ??
                              ''
                            const showLaneSelect =
                              module === 'inspectors' &&
                              w.trainingRole !== 'trainee'
                            return (
                              <AttendanceWorkerExtras
                                workerName={w.fullName}
                                windowId={draft.workerWindows?.[w.id] ?? ''}
                                windowPresets={presetsOverlappingShift(
                                  draft.shiftType,
                                )}
                                onWindowChange={(windowId) =>
                                  setWorkerWindow(w.id, windowId)
                                }
                                showLaneSelect={showLaneSelect}
                                laneId={showLaneSelect ? preferredLaneId : ''}
                                laneLockedByMentoring={Boolean(mentorPair)}
                                lanes={data.lanes.filter(
                                  (lane) =>
                                    draft.activeLaneIds.includes(lane.id) &&
                                    !isGateManagerLane(lane),
                                )}
                                onLaneChange={(laneId) =>
                                  setManualPlacement(w.id, laneId)
                                }
                                lateMinutes={
                                  draft.windowAdjustments?.[w.id]
                                    ?.lateMinutes ??
                                  draft.defaultLateMinutes ??
                                  0
                                }
                                onLateChange={(lateMinutes) =>
                                  setWindowAdjustment(w.id, { lateMinutes })
                                }
                                earlyMinutes={
                                  draft.windowAdjustments?.[w.id]
                                    ?.earlyMinutes ?? 0
                                }
                                onEarlyChange={(earlyMinutes) =>
                                  setWindowAdjustment(w.id, { earlyMinutes })
                                }
                              />
                            )
                          })()
                        ) : null}
                        {w.trainingRole === 'trainee' && on && !isGate ? (
                          <div className="border-t border-brand/15 px-2.5 py-2">
                            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-brand">
                              <TraineeBadge />
                              שיבוץ חונך מראש
                            </p>
                            {(() => {
                              const pair = draft.trainingPairs?.find(
                                (item) => item.traineeId === w.id,
                              )
                              const mentors = data.workers.filter(
                                (mentor) =>
                                  mentor.trainingRole === 'mentor' &&
                                  mentor.status === 'active' &&
                                  mentor.id !== w.id &&
                                  draft.presentWorkerIds.includes(mentor.id) &&
                                  mentor.id !== draft.gateManagerWorkerId,
                              )
                              const pairLanes = data.lanes.filter(
                                (lane) =>
                                  draft.activeLaneIds.includes(lane.id) &&
                                  !isGateManagerLane(lane),
                              )
                              const mentorBusy = mentors.filter((mentor) =>
                                (draft.trainingPairs ?? []).some(
                                  (item) =>
                                    item.mentorId === mentor.id &&
                                    item.traineeId !== w.id,
                                ),
                              )
                              return (
                                <div className="grid gap-1.5 sm:grid-cols-2">
                                  <label className="text-[11px] font-semibold text-ink-soft">
                                    חונך
                                    <select
                                      className="ui-field mt-0.5 w-full py-1.5 text-[13px]"
                                      aria-label={`חונך למתלמד ${w.fullName}`}
                                      value={pair?.mentorId ?? ''}
                                      onChange={(e) => {
                                        const mentorId = e.target.value
                                        if (!mentorId) {
                                          setTrainingPair(w.id, null)
                                          return
                                        }
                                        const laneId =
                                          pair?.laneId || pairLanes[0]?.id
                                        if (!laneId) return
                                        setTrainingPair(w.id, {
                                          mentorId,
                                          laneId,
                                        })
                                      }}
                                    >
                                      <option value="">בחר חונך נוכח</option>
                                      {mentors.map((mentor) => (
                                        <option
                                          key={mentor.id}
                                          value={mentor.id}
                                          disabled={mentorBusy.some(
                                            (busy) => busy.id === mentor.id,
                                          )}
                                        >
                                          {mentor.fullName}
                                          {mentorBusy.some(
                                            (busy) => busy.id === mentor.id,
                                          )
                                            ? ' (תפוס)'
                                            : ''}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="text-[11px] font-semibold text-ink-soft">
                                    נתיב
                                    <select
                                      className="ui-field mt-0.5 w-full py-1.5 text-[13px]"
                                      aria-label={`נתיב למתלמד ${w.fullName}`}
                                      value={pair?.laneId ?? ''}
                                      disabled={!pair?.mentorId}
                                      onChange={(e) => {
                                        const laneId = e.target.value
                                        if (!laneId || !pair?.mentorId) {
                                          setTrainingPair(w.id, null)
                                          return
                                        }
                                        setTrainingPair(w.id, {
                                          mentorId: pair.mentorId,
                                          laneId,
                                        })
                                      }}
                                    >
                                      <option value="">בחר נתיב</option>
                                      {pairLanes.map((lane) => (
                                        <option key={lane.id} value={lane.id}>
                                          {lane.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  {mentors.length === 0 ? (
                                    <p className="sm:col-span-2 text-[11px] text-warn">
                                      סמנו נוכחות לחונך מוסמך כדי לקשור אותו למתלמד
                                    </p>
                                  ) : null}
                                  {pair?.mentorId && pair.laneId ? (
                                    <p className="sm:col-span-2 text-[11px] font-semibold text-ok">
                                      יישבצו יחד בנתיב שנבחר בשיבוץ האוטומטי
                                    </p>
                                  ) : null}
                                </div>
                              )
                            })()}
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
                <div className="flex flex-wrap items-center gap-3">
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
                </div>
              <p className="text-[12px] text-ink-soft tabular-nums">
                נוכחים {feasibility.present}
                {draft.headcountStandard != null ? (
                  <>
                    {' · '}תקן משמרת {draft.headcountStandard}
                    {missingHeadcount > 0 ? ` · חסרים ${missingHeadcount}` : ' · מלא'}
                  </>
                ) : null}
                {feasibility.totalStandard > 0 ? (
                  <>
                    {' · '}תקן עמדות {feasibility.totalStandard}
                  </>
                ) : null}
              </p>
              </div>
            {feasibilityOpen ? (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-line bg-surface/80 p-2 text-[12px] text-ink-soft">
                {/* Per-lane K>=standard is necessary but not sufficient (shared qualified inspectors). */}
                <p className="mb-1.5 text-[11px] text-ink-soft/90">
                  בדיקה מקדימה בלבד — אינה מבטיחה שיבוץ מלא ({people.singular} מוסמך יכול
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
                    disabled={assigning || !attendanceAdvance.ok}
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
                  {!usesRounds(draft) ? (
                    <button
                      type="button"
                      disabled={!attendanceAdvance.ok}
                      onClick={openCompare}
                      className="ui-btn ui-btn-ghost !py-2 disabled:opacity-40"
                    >
                      השוואת חלופות
                    </button>
                  ) : null}
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
                    disabled={assigning || !attendanceAdvance.ok}
                    title={attendanceAdvance.reason ?? undefined}
                    onClick={handleAutoAssign}
                    className="ui-btn ui-btn-primary !py-2 disabled:opacity-40"
                  >
                    <Sparkles className="size-4" aria-hidden />
                    שבץ אוטומטית
                                  </button>
                                  {!usesRounds(draft) ? (
                                    <button
                                      type="button"
                                      disabled={!attendanceAdvance.ok}
                                      onClick={openCompare}
                                      className="ui-btn ui-btn-secondary !py-2 disabled:opacity-40"
                                    >
                                      השוואת חלופות
                                    </button>
                                  ) : null}
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
                  {shiftModelLabel(shiftModels, draft.shiftType)}
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

      {shiftStep === 'board' && usesRounds(draft) ? (
        <div className="space-y-3 pb-28">
          <header className="sticky top-0 z-30 -mx-1 flex items-center gap-2 border-b border-line/70 bg-bg/95 px-1 py-2 backdrop-blur-md">
            {!draft.signOff?.signedAt ? (
              <button
                type="button"
                onClick={() => setShiftStep('attendance')}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                aria-label="חזרה לנוכחות"
                title="חזרה לנוכחות"
              >
                <ChevronRight className="size-5" aria-hidden />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold tracking-[0.2em] text-brand/70">
                GATE OUT
              </p>
              <h2 className="truncate font-display text-lg font-bold text-ink sm:text-xl">
                שיבוץ {roleName}
              </h2>
            </div>
            <div
              className="inline-flex shrink-0 rounded-xl border border-line/80 bg-card p-0.5"
              role="group"
              aria-label="סוג תצוגה"
            >
              <button
                type="button"
                onClick={() => setRoundsLayout('cards')}
                className={`inline-flex h-10 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  roundsLayout === 'cards'
                    ? 'bg-brand/10 text-brand'
                    : 'text-ink-soft hover:text-ink'
                }`}
                aria-pressed={roundsLayout === 'cards'}
                title="תצוגת רשימה"
              >
                <LayoutList className="size-4" aria-hidden />
                <span className="hidden sm:inline">רשימה</span>
              </button>
              <button
                type="button"
                onClick={() => setRoundsLayout('table')}
                className={`inline-flex h-10 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  roundsLayout === 'table'
                    ? 'bg-brand/10 text-brand'
                    : 'text-ink-soft hover:text-ink'
                }`}
                aria-pressed={roundsLayout === 'table'}
                title="תצוגת טבלה"
              >
                <Table2 className="size-4" aria-hidden />
                <span className="hidden sm:inline">טבלה</span>
              </button>
            </div>
            <div className="relative" ref={roundsMoreRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={roundsMoreOpen}
                aria-label="עוד פעולות"
                onClick={() => setRoundsMoreOpen((o) => !o)}
                className="inline-flex size-11 items-center justify-center rounded-xl text-ink-soft hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <MoreHorizontal className="size-5" aria-hidden />
              </button>
              {roundsMoreOpen
                ? createPortal(
                    <div
                      role="menu"
                      className="fixed inset-x-0 bottom-0 z-[60] animate-fade-up rounded-t-2xl border border-line bg-card p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-panel-hover)] sm:inset-x-auto sm:bottom-auto sm:start-auto sm:end-4 sm:top-16 sm:w-64 sm:rounded-2xl sm:pb-3"
                    >
                      <div className="mb-2 flex items-center justify-between sm:hidden">
                        <h3 className="text-sm font-bold text-ink">עוד</h3>
                        <button
                          type="button"
                          className="ui-btn ui-btn-ghost !p-2"
                          aria-label="סגור"
                          onClick={() => setRoundsMoreOpen(false)}
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-start text-sm font-semibold text-ink hover:bg-surface"
                        onClick={() => {
                          setRoundsMoreOpen(false)
                          void exportSelectorBoard('whatsapp')
                        }}
                      >
                        <MessageCircle className="size-4" aria-hidden />
                        וואטסאפ
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-start text-sm font-semibold text-ink hover:bg-surface"
                        onClick={() => {
                          setRoundsMoreOpen(false)
                          void exportSelectorBoard('download')
                        }}
                      >
                        <Download className="size-4" aria-hidden />
                        ייצוא
                      </button>
                      {!draft.signOff?.signedAt ? (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-start text-sm font-semibold text-ink hover:bg-surface"
                            onClick={() => {
                              setRoundsMoreOpen(false)
                              setAddPicker('lane')
                            }}
                          >
                            הוספת נתיב
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-start text-sm font-semibold text-ink hover:bg-surface"
                            onClick={() => {
                              setRoundsMoreOpen(false)
                              setAddPicker('worker')
                            }}
                          >
                            הוספת {people.singular}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-start text-sm font-semibold text-ink hover:bg-surface"
                            onClick={() => {
                              setRoundsMoreOpen(false)
                              openSignOff()
                            }}
                          >
                            <Lock className="size-4" aria-hidden />
                            סגירת משמרת
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-start text-sm font-semibold text-ink hover:bg-surface"
                            onClick={() => {
                              setRoundsMoreOpen(false)
                              const keep = rebuildRoundsFromSettings({
                                mode: 'keep',
                              })
                              const empty = rebuildRoundsFromSettings({
                                mode: 'empty',
                              })
                              if (!keep || !empty) {
                                notify.error('לא ניתן לעדכן סבבים')
                                return
                              }
                              if (!keep.changed) {
                                notify.info(
                                  'הסבבים כבר תואמים להגדרות',
                                  'אין שינוי בשעות הסבבים',
                                )
                                return
                              }
                              setRoundsRebuildPreview({
                                keepRounds: keep.rounds,
                                emptyRounds: empty.rounds,
                                fromLabels: keep.fromLabels,
                                toLabels: keep.toLabels,
                              })
                            }}
                          >
                            עדכון סבבים לפי ההגדרות
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-start text-sm font-semibold text-hard hover:bg-hard-soft"
                            onClick={() => {
                              setRoundsMoreOpen(false)
                              setDiscardOpen(true)
                            }}
                          >
                            ביטול טיוטה
                          </button>
                        </>
                      ) : null}
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          </header>

          {draft.warnings.length > 0 && !roundsWarningsDismissed ? (
            <div
              className="rounded-xl border border-warn/25 bg-warn-soft/80 px-3 py-2.5 text-[13px] text-warn"
              role="status"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {draft.warnings.length === 1
                      ? draft.warnings[0]
                      : `${draft.warnings.length} התראות בשיבוץ`}
                  </p>
                  {draft.warnings.length > 1 && !roundsWarningsOpen ? (
                    <button
                      type="button"
                      className="mt-1 text-xs font-bold underline underline-offset-2"
                      onClick={() => setRoundsWarningsOpen(true)}
                    >
                      הצג פירוט
                    </button>
                  ) : null}
                  {roundsWarningsOpen || draft.warnings.length === 1 ? (
                    <ul className="mt-1.5 list-disc space-y-0.5 pe-4 text-xs">
                      {draft.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-warn/10"
                  aria-label="סגור התראות"
                  onClick={() => setRoundsWarningsDismissed(true)}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          ) : null}

          {draft.quality ? (
            <section
              className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-3"
              aria-label="מדדי איכות השיבוץ"
            >
              {qualityVsHistory && qualityVsHistory.level !== 'ok' ? (
                <div
                  className={`mb-3 rounded-lg border px-3 py-2 text-xs font-semibold ${
                    qualityVsHistory.level === 'bad'
                      ? 'border-hard/30 bg-hard-soft text-hard'
                      : 'border-warn/30 bg-warn-soft text-warn'
                  }`}
                  role="status"
                >
                  {qualityVsHistory.message}
                </div>
              ) : null}
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold text-ink">מדדי איכות לשיבוץ האוטומטי</h3>
                <span className="font-display text-xl font-bold tabular-nums text-brand">
                  {Math.round(draft.quality.score)}/100
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(draft.quality.components)
                  .slice(0, 4)
                  .map(([key, value]) => (
                    <span
                      key={key}
                      className="rounded-lg bg-card px-2 py-1 text-xs text-ink-soft ring-1 ring-line/70"
                    >
                      {QUALITY_LABELS[key] ?? key}:{' '}
                      <b className="tabular-nums text-ink">{Math.round(value)}</b>
                    </span>
                  ))}
              </div>
            </section>
          ) : null}

          {draft.signOff ? <ShiftClosedBanner signOff={draft.signOff} /> : null}
          <SelectorRoundTable
            rounds={draft.rounds ?? []}
            lanes={selectorLanes(data.lanes, draft.activeLaneIds)}
            workers={selectorStaff(
              shiftRoster,
              draft.presentWorkerIds,
              draft.gateManagerWorkerId,
            )}
            overrides={draft.staffingOverrides}
            windowAdjustments={draft.windowAdjustments}
            workerWindows={draft.workerWindows}
            defaultLateMinutes={draft.defaultLateMinutes}
            earlyLeaveAt={draft.earlyLeaveAt}
            layout={roundsLayout}
            stickyOffsetClass="top-14"
            ramashName={
              draft.gateManagerWorkerId
                ? data.workers.find((w) => w.id === draft.gateManagerWorkerId)
                    ?.fullName ?? ''
                : ''
            }
            managerId={draft.gateManagerWorkerId}
            managerOptions={data.workers
              .filter(
                (worker) =>
                  worker.status === 'active' &&
                  worker.isManager &&
                  worker.isInspector,
              )
              .sort((a, b) => a.fullName.localeCompare(b.fullName, 'he'))
              .map((worker) => ({ id: worker.id, fullName: worker.fullName }))}
            onManagerChange={(workerId) =>
              runWithUndo(
                workerId ? 'נבחר מנהל משמרת' : 'הוסר מנהל משמרת',
                () => setGateManager(workerId),
              )
            }
            onLateChange={(workerId, lateMinutes) =>
              setWindowAdjustment(workerId, { lateMinutes })
            }
            onStaffingChange={(laneId, standard) =>
              runWithUndo('עודכן תקן נתיב', () =>
                setLaneStaffingStandard(laneId, standard),
              )
            }
            editable={!draft.signOff?.signedAt}
            onChange={(...args) =>
              runWithUndo('השיבוץ בסבב עודכן', () => updateSelectorCell(...args))
            }
            onRemoveLane={(laneId) => {
              runWithUndo(
                'הנתיב הוסר מהמשמרת',
                () => removeLaneFromShift(laneId),
                true,
              )
            }}
          />
          {!draft.signOff?.signedAt ? (
            <div className="rounded-2xl border border-line/70 bg-card px-4 py-3">
              <p className="text-sm font-semibold text-ink">הורדה ממשמרת</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {selectorStaff(
                  data.workers,
                  draft.presentWorkerIds,
                  draft.gateManagerWorkerId,
                ).map((worker) => (
                  <li key={worker.id}>
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary gap-1.5"
                      onClick={() => setDropWorkerId(worker.id)}
                    >
                      {worker.fullName}
                      {worker.trainingRole === 'trainee' ? (
                        <TraineeBadge />
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ShiftDropSummary
            drops={draft.shiftDrops ?? []}
            workers={data.workers}
            onUndo={undoShiftDrop}
          />

          {!draft.signOff?.signedAt ? (
            <div className="fixed inset-x-3 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-[760px] items-center gap-2 rounded-2xl border border-line/80 bg-card/90 p-2.5 shadow-[var(--shadow-lg)] backdrop-blur-xl no-print sm:inset-x-4">
              <div
                className={`flex shrink-0 items-center gap-1.5 ${
                  draftDirty ? 'text-warn' : 'text-ok'
                }`}
                role="status"
                aria-label={draftDirty ? 'יש שינויים שלא נשמרו' : 'הכל שמור'}
              >
                {draftDirty ? (
                  <span className="size-2 rounded-full bg-warn" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-4" aria-hidden />
                )}
                <span className="hidden text-[11px] font-semibold sm:inline">
                  {draftDirty ? 'לא נשמר' : 'נשמר'}
                </span>
              </div>
              <button
                type="button"
                disabled={!draftDirty}
                onClick={() => void handleSave()}
                className={`ui-btn ui-btn-primary !h-11 flex-1 gap-1.5 ${
                  !draftDirty ? 'cursor-not-allowed opacity-40' : ''
                }`}
              >
                <Save className="size-4" aria-hidden />
                שמירה
              </button>
              <button
                type="button"
                onClick={() => void exportSelectorBoard('whatsapp')}
                className="ui-btn ui-btn-secondary !h-11 shrink-0 gap-1.5 !px-3"
                aria-label="שיתוף"
                title="שיתוף בוואטסאפ"
              >
                <MessageCircle className="size-4" aria-hidden />
                <span className="hidden sm:inline">שיתוף</span>
              </button>
              <button
                type="button"
                onClick={openSignOff}
                className="ui-btn !h-11 shrink-0 gap-1.5 !bg-ok-soft !px-3 !font-semibold !text-ok hover:!bg-ok/15"
                aria-label="סגירת משמרת"
                title="סגירת משמרת"
              >
                <Lock className="size-4" aria-hidden />
                <span className="hidden sm:inline">סגירה</span>
              </button>
              <button
                type="button"
                disabled={assigning}
                onClick={() => void handleAutoAssign()}
                className="ui-btn !h-11 shrink-0 gap-2 !bg-brand-soft !font-semibold !text-brand hover:!bg-brand/15"
                aria-label="שיבוץ אוטומטי"
              >
                <Sparkles className="size-4" aria-hidden />
                <span className="hidden sm:inline">שיבוץ אוטומטי</span>
              </button>
            </div>
          ) : null}

          {roundsRebuildPreview
            ? createPortal(
                <div
                  className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center"
                  role="dialog"
                  aria-modal="true"
                  aria-label="תצוגה מקדימה לעדכון סבבים"
                >
                  <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-panel-hover)]">
                    <h3 className="font-display text-lg font-bold text-ink">
                      עדכון סבבים לפי ההגדרות
                    </h3>
                    <p className="mt-1 text-sm text-ink-soft">
                      בחרו איך להחיל את השעות החדשות על הלוח הפתוח.
                    </p>
                    <div className="mt-3 space-y-2 text-sm">
                      <p>
                        <span className="font-semibold text-ink">לפני: </span>
                        <span className="text-ink-soft">
                          {roundsRebuildPreview.fromLabels.join(' · ') || '—'}
                        </span>
                      </p>
                      <p>
                        <span className="font-semibold text-ink">אחרי: </span>
                        <span className="text-ink-soft">
                          {roundsRebuildPreview.toLabels.join(' · ') || '—'}
                        </span>
                      </p>
                    </div>
                    <div className="mt-4 flex flex-col gap-2">
                      <button
                        type="button"
                        className="ui-btn ui-btn-primary w-full"
                        onClick={() => {
                          const snapshot = draft
                            ? (JSON.parse(
                                JSON.stringify(draft),
                              ) as typeof draft)
                            : null
                          rebuildRoundsFromSettings({
                            apply: true,
                            rounds: roundsRebuildPreview.keepRounds,
                          })
                          setRoundsRebuildPreview(null)
                          if (snapshot) {
                            notify.undoable(
                              'עודכנו סבבים לפי ההגדרות',
                              () => restoreDraftSnapshot(snapshot),
                              {
                                major: true,
                                description:
                                  'השיבוצים הועברו לסבבים החופפים ככל האפשר',
                              },
                            )
                          }
                        }}
                      >
                        אישור עם העברת שיבוצים
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary w-full"
                        onClick={() => {
                          const snapshot = draft
                            ? (JSON.parse(
                                JSON.stringify(draft),
                              ) as typeof draft)
                            : null
                          rebuildRoundsFromSettings({
                            apply: true,
                            rounds: roundsRebuildPreview.emptyRounds,
                          })
                          setRoundsRebuildPreview(null)
                          if (snapshot) {
                            notify.undoable(
                              'עודכנו סבבים (מבנה ריק)',
                              () => restoreDraftSnapshot(snapshot),
                              {
                                major: true,
                                description: 'הסבבים עודכנו בלי להעביר שיבוצים',
                              },
                            )
                          }
                        }}
                      >
                        אישור — מבנה ריק בלבד
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost w-full"
                        onClick={() => setRoundsRebuildPreview(null)}
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                </div>,
                document.body,
              )
            : null}
        </div>
      ) : null}

      {shiftStep === 'board' && !usesRounds(draft) && (
        <div className="space-y-3">
          {draft.signOff ? <ShiftClosedBanner signOff={draft.signOff} /> : null}
        <BoardStep
          draft={draft}
          data={data}
          extraWorkers={guestWorkerModels}
          people={people}
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
          onSignOff={openSignOff}
          onCompare={openCompare}
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
        </div>
      )}

      {assignPreview && draft && shiftStep === 'board'
        ? createPortal(
            <div
              className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center"
              role="dialog"
              aria-modal="true"
              aria-label="תצוגה מקדימה לשיבוץ אוטומטי"
            >
              <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-panel-hover)]">
                <h3 className="font-display text-lg font-bold text-ink">
                  תצוגה מקדימה — שיבוץ אוטומטי
                </h3>
                <p className="mt-1 text-sm text-ink-soft">
                  זה השיבוץ המוצע. אפשר לאשר או לבטל ולחזור ללוח הקודם.
                </p>
                <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto text-sm">
                  {usesRounds(draft)
                    ? (draft.rounds ?? []).flatMap((round) =>
                        round.assignments.flatMap((row) => {
                          const laneName =
                            data.lanes.find((l) => l.id === row.laneId)?.name ??
                            row.laneId
                          const beforeRow = assignPreview.before.rounds
                            ?.find(
                              (r) =>
                                r.label === round.label &&
                                r.cohort === round.cohort,
                            )
                            ?.assignments.find((a) => a.laneId === row.laneId)
                          const beforeIds = (beforeRow?.workerIds ?? [])
                            .filter(Boolean)
                            .join(',')
                          const afterIds = row.workerIds.filter(Boolean).join(',')
                          if (beforeIds === afterIds) return []
                          const names = row.workerIds
                            .filter(Boolean)
                            .map(
                              (id) =>
                                data.workers.find((w) => w.id === id)?.fullName ??
                                id,
                            )
                            .join(' · ')
                          return [
                            <li
                              key={`${round.label}-${row.laneId}`}
                              className="rounded-lg bg-surface px-2.5 py-2"
                            >
                              <span className="font-semibold text-ink">
                                {round.label} · {laneName}
                              </span>
                              <span className="mt-0.5 block text-ink-soft">
                                {names || 'פנוי'}
                              </span>
                            </li>,
                          ]
                        }),
                      )
                    : draft.assignments.map((row) => {
                        const laneName =
                          data.lanes.find((l) => l.id === row.laneId)?.name ??
                          row.laneId
                        const names = row.workerIds
                          .filter(Boolean)
                          .map(
                            (id) =>
                              data.workers.find((w) => w.id === id)?.fullName ??
                              id,
                          )
                          .join(' · ')
                        return (
                          <li
                            key={row.laneId}
                            className="rounded-lg bg-surface px-2.5 py-2"
                          >
                            <span className="font-semibold text-ink">{laneName}</span>
                            <span className="mt-0.5 block text-ink-soft">
                              {names || 'פנוי'}
                            </span>
                          </li>
                        )
                      })}
                </ul>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost flex-1"
                    onClick={() => {
                      restoreDraftSnapshot(assignPreview.before)
                      setAssignPreview(null)
                    }}
                  >
                    ביטול
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary flex-1"
                    onClick={() => {
                      const before = assignPreview.before
                      setAssignPreview(null)
                      notify.undoable(
                        'שיבוץ אוטומטי',
                        () => restoreDraftSnapshot(before),
                        { major: true },
                      )
                      setRequestExplainModal(true)
                    }}
                  >
                    אישור
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

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
                  {people.plural} עודפים
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
                  יש יותר {people.plural} (
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
                  האם תרצה להוסיף {people.singular} לעמדה נוספת?
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
                  בחר נתיב ו{people.singular} להוספה מעבר לתקן העמדה
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
                      {sortIdsByCatalogOrder(
                        draft.activeLaneIds,
                        data.lanes,
                      ).map((id) => {
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
                    <span className="mb-1 block text-ink-soft">
                      {people.singular} להוספה
                    </span>
                    <select
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs sm:py-2.5 sm:text-sm"
                      value={pickWorkerId}
                      onChange={(e) => setPickWorkerId(e.target.value)}
                    >
                      <option value="">— בחר {people.singular} —</option>
                      {unassignedWorkers.map(
                        (w) =>
                          w && (
                            <option key={w.id} value={w.id}>
                              {w.fullName}
                              {w.trainingRole === 'trainee' ? ' · מתלמד' : ''}
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
                          שימו לב: ל{people.singular} זה חסרה הסמכה מלאה לנתיב
                          שנבחר.
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
      {signOpen ? (
        <ShiftSignOffDialog
          accountName={user?.fullName ?? ''}
          busy={signBusy}
          summary={closeSummary}
          onClose={() => {
            if (!signBusy) setSignOpen(false)
          }}
          onConfirm={(signature) => void confirmSignOff(signature)}
        />
      ) : null}
      {healPlan
        ? createPortal(
            <div className="fixed inset-0 z-[400] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="self-heal-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5"
          >
            <h3 id="self-heal-title" className="font-display text-lg font-bold text-ink">
              שיקום לוח
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
              {healPlan.healed.summary}
            </p>
            {healPlan.healed.lines.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {healPlan.healed.lines.map((line) => (
                  <li
                    key={line}
                    className="rounded-xl bg-ok-soft/80 px-3 py-2 text-[13px] text-ink ring-1 ring-ok/30"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
            {healPlan.healed.frozenLaneIds.length > 0 ? (
              <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-[13px] font-medium text-warn">
                נתיב קל נשאר בלי אדם וסומן כבחור תקן / מוקפא.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={dismissSelfHeal}
                className="ui-btn ui-btn-secondary min-h-10"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={editRemovalManually}
                className="ui-btn ui-btn-secondary min-h-10"
              >
                ערוך ידנית
              </button>
              <button
                type="button"
                onClick={() => void confirmSelfHeal()}
                className="ui-btn ui-btn-primary min-h-10"
              >
                אשר שיקום אוטומטי
              </button>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
      {assigning ? (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-ink/45 p-4">
          <div
            className="w-full max-w-sm rounded-2xl border border-line bg-card px-5 py-5 shadow-xl"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={assignProgress}
            aria-label="התקדמות יצירת השיבוץ"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-bold text-ink">
                <span className="page-loader page-loader--sm" aria-hidden />
                יוצר שיבוץ
              </p>
              <p className="font-display text-2xl font-bold tabular-nums text-brand">
                {assignProgress}%
              </p>
            </div>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-surface ring-1 ring-line">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-200"
                style={{ width: `${assignProgress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              נבדקים 1,000 שיבוצים מלאים. הלוח יוצג בסיום החיפוש.
            </p>
          </div>
        </div>
      ) : null}
      {healing ? (
        <p className="fixed bottom-24 start-1/2 z-[210] -translate-x-1/2 rounded-full bg-ink px-3 py-1.5 text-[13px] font-semibold text-white shadow-lg">
          מחשב שיבוץ חליפי אופטימלי...
        </p>
      ) : null}
      {dropWorkerId && draft
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
      {guestPickerOpen && draft ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[min(32rem,85vh)] w-full max-w-lg flex-col rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3
                  id="guest-picker-title"
                  className="font-display text-base font-bold text-ink"
                >
                  הוספת מאורח ממחלקה אחרת
                </h3>
                <p className="mt-1 text-[13px] text-ink-soft">
                  מאורחים נספרים בנוכחות וניתן לשבצם ידנית בלבד.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGuestPickerOpen(false)}
                className="rounded-lg p-1.5 text-ink-soft hover:bg-surface"
                aria-label="סגור"
              >
                <X className="size-4" />
              </button>
            </div>
            {guestLoading ? (
              <p className="py-8 text-center text-[13px] text-ink-soft">טוען...</p>
            ) : guestCatalog.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-ink-soft">
                אין עובדים פעילים במחלקות האחרות של הארגון.
              </p>
            ) : (
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pe-1">
                {guestCatalog
                  .filter((g) => !draft.presentWorkerIds.includes(g.id))
                  .map((g) => {
                    const picked = guestPickIds.includes(g.id)
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setGuestPickIds((ids) =>
                              picked
                                ? ids.filter((id) => id !== g.id)
                                : [...ids, g.id],
                            )
                          }
                          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-start transition ${
                            picked
                              ? 'border-brand/40 bg-brand/[0.06]'
                              : 'border-line bg-surface hover:border-brand/25'
                          }`}
                        >
                          <span
                            className={`flex size-5 shrink-0 items-center justify-center rounded border ${
                              picked
                                ? 'border-brand bg-brand text-white'
                                : 'border-line bg-card'
                            }`}
                          >
                            {picked ? <Check className="size-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-ink">
                              {g.fullName}
                            </span>
                            <span className="block text-[12px] text-ink-soft">
                              {MODULE_LABELS[g.sourceModule]} ·{' '}
                              <Ltr>{g.phone}</Ltr>
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line/70 pt-3">
              <button
                type="button"
                className="ui-btn ui-btn-ghost"
                onClick={() => setGuestPickerOpen(false)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                disabled={guestPickIds.length === 0}
                onClick={() => {
                  addGuestWorkers(guestPickIds)
                  setGuestPickerOpen(false)
                  setGuestPickIds([])
                }}
              >
                הוסף נבחרים
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {compareOptions && draft ? (
        <BoardCompareDialog
          loadFair={compareOptions.loadFair}
          hardExperience={compareOptions.hardExperience}
          lanes={managedLanes(data.lanes).filter((lane) =>
            draft.activeLaneIds.includes(lane.id),
          )}
          workers={data.workers}
          onClose={() => setCompareOptions(null)}
          onChoose={chooseBoardOption}
        />
      ) : null}
      {addPicker && draft ? (
        <div className="fixed inset-0 z-[400] flex items-end justify-center bg-ink/40 p-3 sm:items-center">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-line bg-card p-4 shadow-xl">
            <h3 className="font-display text-lg font-bold text-ink">
              {addPicker === 'lane' ? 'הוספת נתיב' : `הוספת ${people.singular}`}
            </h3>
            <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
              {(addPicker === 'lane'
                ? managedLanes(data.lanes).filter(
                    (lane) => !draft.activeLaneIds.includes(lane.id),
                  )
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
                        runWithUndo(
                          `נוסף ${people.singular} לנוכחות`,
                          () => toggleWorker(item.id),
                        )
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
      {unfreezePrompt?.show
        ? createPortal(
            <div className="fixed inset-0 z-[400] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="unfreeze-prompt-title"
                className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5"
              >
                <h3 id="unfreeze-prompt-title" className="font-display text-lg font-bold text-ink">
                  💡 הצעה - פתיחת נתיב קפוא
                </h3>
                
                {unfreezePrompt.triggerWorkerName ? (
                  <p className="mt-2 text-[13px] leading-relaxed text-ink">
                    ✅ <span className="font-medium">{unfreezePrompt.triggerWorkerName}</span> הגיע/ה
                  </p>
                ) : null}
                
                <div className="mt-3 space-y-2 rounded-xl bg-ok-soft/50 px-3 py-2.5 ring-1 ring-ok/20">
                  <p className="text-[13px] text-ink-soft">
                    👥 נוכחים עכשיו: <span className="font-semibold text-ink">{unfreezePrompt.currentHeadcount}</span>
                  </p>
                  <p className="text-[13px] text-ink-soft">
                    📊 תקן נתיבים: <span className="font-semibold text-ink">{unfreezePrompt.requiredStandard}</span>
                    {unfreezePrompt.currentHeadcount >= unfreezePrompt.requiredStandard ? (
                      <span className="mr-1.5 text-ok">✓ יש מספיק!</span>
                    ) : null}
                  </p>
                </div>
                
                {unfreezePrompt.frozenLanes.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[13px] font-medium text-ink">❄️ נתיבים קפואים (פעילים כעת):</p>
                    <ul className="mt-1.5 space-y-1">
                      {unfreezePrompt.frozenLanes.map((frozenLane) => {
                        const lane = data.lanes.find((l) => l.id === frozenLane.laneId)
                        
                        // Check if lane has active hours and if it's currently active
                        const now = new Date()
                        const currentMinutes = now.getHours() * 60 + now.getMinutes()
                        const isInActiveHours = !lane?.activeHours || lane.activeHours.length === 0 || 
                          lane.activeHours.some((span) => {
                            const start = span.start
                            let end = span.end
                            if (end <= start) end += 24 * 60
                            return currentMinutes >= start && currentMinutes < end
                          })
                        
                        // Only show lanes that are currently in their active hours
                        if (!isInActiveHours) return null
                        
                        return (
                          <li
                            key={frozenLane.laneId}
                            className="rounded-lg bg-warn-soft/60 px-2.5 py-1.5 text-[13px] text-ink ring-1 ring-warn/25"
                          >
                            • {lane?.name || '?'} (קפא ב-{new Date(frozenLane.frozenAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })})
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : null}
                
                <p className="mt-4 text-[13px] leading-relaxed text-ink">
                  ❓ <span className="font-medium">לפתוח את הנתיבים הקפואים ולשבץ מחדש?</span>
                </p>
                
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={dismissUnfreezePrompt}
                    className="ui-btn ui-btn-secondary min-h-10 text-[13px]"
                  >
                    ✕ סגור
                  </button>
                  <button
                    type="button"
                    onClick={remindUnfreezeLater}
                    className="ui-btn ui-btn-secondary min-h-10 text-[13px]"
                  >
                    ⏰ הזכר בעוד 10 דק'
                  </button>
                  <button
                    type="button"
                    onClick={keepLanesFrozen}
                    className="ui-btn ui-btn-secondary min-h-10 text-[13px]"
                  >
                    ❌ לא, השאר קפוא
                  </button>
                  <button
                    type="button"
                    onClick={() => void unfreezeAndReassign()}
                    className="ui-btn ui-btn-primary min-h-10 text-[13px]"
                  >
                    ✅ כן, פתח ושבץ
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
