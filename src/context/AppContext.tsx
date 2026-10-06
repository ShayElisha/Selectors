import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { toast } from 'sonner'
import {
  runAssignmentAlgorithm,
  type AssignmentResult,
  type PlacementExplanation,
} from '../algorithm'
import {
  ApiError,
  checkLoginRemote,
  deleteShiftRemote,
  fetchAppData,
  loginRemote,
  postAuditEvent,
  refreshSessionRemote,
  requestPasswordResetRemote,
  resendManagerTempPasswordRemote,
  fetchOrgSettings,
  saveAppDataRemote,
  saveOrgSettings,
  selfHealShiftRemote,
  saveShiftRemote,
  seedAppDataRemote,
  type LoginNextStep,
} from '../api'
import { notify } from '../lib/notify'
import { earlyLeaveCutoff } from '../lib/earlyLeave'
import { rotationOverrideWarning } from '../lib/rotationOverride'
import { planRemoval, removalMinute, type SelfHealPlan } from '../lib/selfHeal'
import { normalizeSignOff } from '../lib/shiftSignOff'
import {
  clearAppDataCache,
  clearDraftStorage,
  clearSession,
  loadAppDataCache,
  loadDraftJson,
  loadSession,
  loadShiftStep,
  saveAppDataCache,
  saveDraftJson,
  saveSession,
  saveShiftStep,
  type AppModule,
  type SessionUser,
} from '../auth'
import {
  findShiftForSlot,
  SHIFT_TYPE_LABELS,
  shiftSlotConflictMessage,
} from '../constants'
import { isAppPath, pathForView, viewFromPath } from '../routes'
import { createSeedData, isDefaultManager } from '../storage'
import {
  clampStaffingStandard,
  DEFAULT_SHIFT_STAFFING,
  effectiveStaffingStandard,
  laneMaxStaffing,
  normalizeStaffingOverrides,
  type StaffingOverrides,
} from '../lib/shiftStaffing'
import {
  computeUnassignedWorkerIds,
  ensureGateManagerLane,
  findGateManagerLane,
  isGateManagerLane,
  normalizeGateManagerId,
  selectorStaff,
  syncGateManagerPlacement,
} from '../lib/gateManager'
import { replaceLeavingWorkerSeat } from '../lib/boardHelpers'
import {
  normalizeBriefingSections,
  normalizeQuestionBank,
  reindexOrders,
} from '../lib/briefings'
import {
  assignSelectorRounds,
  applyLaneActivityHours,
  clearWorkerFromRounds,
  emptySelectorRounds,
  setSelectorCell,
  unassignedSelectorIds,
} from '../lib/selectorRounds'
import { roundCutsForWindows } from '../lib/shiftCatalog'
import {
  assignmentModeOf,
  DEFAULT_ASSIGNMENT_MODES,
  normalizeAssignmentModes,
  usesRounds,
  type AssignmentModes,
} from '../lib/assignmentMode'
import { currentShiftModel, resolveShiftModels, shiftModelAbsoluteEnd, shiftModelById } from '../lib/shiftModels'
import {
  formatBrokerPhone,
  normalizeBrokerPhoneDigits,
  normalizeCustomsBrokers,
} from '../lib/customsBrokers'
import type {
  AppData,
  BriefingSection,
  InspectorQuestion,
  Lane,
  LaneAssignment,
  SelectorRound,
  AssignmentMode,
  ShiftAudience,
  ShiftSchedule,
  ShiftChangeEvent,
  ShiftDrop,
  ShiftSignOff,
  SeatSegment,
  ShiftType,
  StaffingStandard,
  WindowAdjustment,
  View,
  Worker,
  ShiftModel,
  CustomsBroker,
  CustomsBrokerContact,
} from '../types'

function uniqueLabels(values: string[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values ?? []) {
    const label = String(value).trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  return out
}

function normalizeWorkerRoles(w: Worker, fallbackKind: 'inspector' | 'selector'): Worker {
  const isManager = Boolean(w.isManager) || isDefaultManager(w)
  const hasInspector = Object.prototype.hasOwnProperty.call(w, 'isInspector')
  let isInspector = hasInspector ? Boolean(w.isInspector) : !isManager
  if (!isInspector && !isManager) isInspector = true
  const staffKind =
    w.staffKind === 'inspector' || w.staffKind === 'selector' ? w.staffKind : fallbackKind
  const isOrgManager = Boolean(w.isOrgManager)
  return {
    ...w,
    certifications: uniqueLabels(w.certifications),
    isManager: isManager || isOrgManager,
    isInspector,
    staffKind,
    isOrgManager,
  }
}

function normalizeAppData(data: AppData, module: 'selectors' | 'inspectors' = 'selectors'): AppData {
  const fallbackKind = module === 'inspectors' ? 'inspector' : 'selector'
  return {
    ...data,
    workers: data.workers.map((worker) => normalizeWorkerRoles(worker, fallbackKind)),
    lanes: ensureGateManagerLane(data.lanes ?? [], () => uuid()).map((lane) => ({
      ...lane,
      requiredCertifications: uniqueLabels(lane.requiredCertifications),
    })),
    certificationsCatalog: uniqueLabels(data.certificationsCatalog),
    briefingSections: normalizeBriefingSections(data.briefingSections),
    questionBank: normalizeQuestionBank(data.questionBank),
    customsBrokers: Array.isArray(data.customsBrokers) ? data.customsBrokers : [],
  }
}

export type ShiftStep = 'lanes' | 'attendance' | 'board'

export interface ShiftDraft {
  id: string
  date: string
  shiftType: ShiftType
  audience: ShiftAudience
  assignmentMode: AssignmentMode
  activeLaneIds: string[]
  presentWorkerIds: string[]
  /** Designated מנהל שער — present, no lane required */
  gateManagerWorkerId?: string
  assignments: LaneAssignment[]
  /** Selector board: two-hour route rounds */
  rounds: SelectorRound[]
  warnings: string[]
  unassignedWorkerIds: string[]
  /** Filled by auto-assign; cleared on manual board edits */
  explanations: PlacementExplanation[]
  /** Personal hours keyed by worker id. */
  workerWindows: Record<string, string>
  windowAdjustments: Record<string, WindowAdjustment>
  staggerRounds: boolean
  /** Per-shift תקן (1…5); falls back to lane catalog when absent */
  staffingOverrides: StaffingOverrides
  /** Set after a formal close. The board is read-only. */
  signOff?: ShiftSignOff
  frozenLaneIds?: string[]
  seatSegments?: SeatSegment[]
  seatSpan?: { startMinutes: number; endMinutes: number }
  isSelfHealed?: boolean
  shiftEvents?: ShiftChangeEvent[]
  /** Transient glow after an accepted refill. */
  healHighlights?: { laneId: string; tone: 'filled' | 'frozen' }[]
  /** Worker id → clock minutes they left the shift. */
  earlyLeaveAt?: Record<string, number>
  shiftDrops?: ShiftDrop[]
}

interface AppContextValue {
  data: AppData
  loading: boolean
  /** Background refresh while showing cached data */
  refreshing: boolean
  syncing: boolean
  error: string | null
  user: SessionUser | null
  module: AppModule
  setModule: (module: AppModule) => void
  assignmentModes: AssignmentModes
  saveAssignmentModes: (modes: AssignmentModes) => Promise<void>
  roundMinutes: { selectors: number; inspectors: number }
  saveRoundMinutes: (minutes: { selectors: number; inspectors: number }) => Promise<void>
  staggerRounds: { selectors: boolean; inspectors: boolean }
  saveStaggerRounds: (stagger: { selectors: boolean; inspectors: boolean }) => Promise<void>
  orgProfile: { name: string; logo: string }
  saveOrgProfile: (profile: { name: string; logo: string }) => Promise<void>
  login: (
    phone: string,
    password: string,
    opts?: { newPassword?: string; newPasswordConfirm?: string },
  ) => Promise<
    | void
    | 'change_password'
    | { next: 'pending_approval' | 'rejected' | 'suspended' | 'no_modules' | 'await_email'; message?: string }
  >
  /** Phone-only probe: which login UI to show next. */
  checkLogin: (
    phone: string,
  ) => Promise<{ next: LoginNextStep; message?: string }>
  requestPasswordReset: (phone: string) => Promise<string>
  resendManagerTempPassword: (workerId: string) => Promise<void>
  logout: () => void
  view: View
  setView: (v: View) => void
  shiftStep: ShiftStep
  setShiftStep: (s: ShiftStep) => void
  draft: ShiftDraft | null
  /** True only after the in-memory shift differs from its clean baseline (and thus is persisted). */
  draftDirty: boolean
  /** Restore a previous board snapshot (used by the 3s undo toast). */
  restoreDraftSnapshot: (snapshot: ShiftDraft) => void
  startShift: (audience?: ShiftAudience) => void
  /** Discard in-progress shift draft and return home */
  discardDraft: () => void
  updateDraftMeta: (patch: Partial<Pick<ShiftDraft, 'date' | 'shiftType'>>) => void
  toggleLane: (laneId: string) => void
  /** Replace active lane set (and optional per-shift תקן) without touching attendance. */
  applyLaneSelection: (
    laneIds: string[],
    staffingOverrides?: StaffingOverrides,
  ) => void
  /** Replace present worker ids (does not scrub assignments beyond toggleWorker rules). */
  applyPresentSelection: (
    workerIds: string[],
    opts?: {
      gateManagerWorkerId?: string | null
      workerWindows?: Record<string, string>
    },
  ) => void
  /** Set תקן for a lane in the current shift only (does not change the lane catalog). */
  setLaneStaffingStandard: (laneId: string, standard: StaffingStandard) => void
  toggleWorker: (workerId: string) => void
  setWorkerWindow: (workerId: string, windowId: string | null) => void
  setWindowAdjustment: (
    workerId: string,
    patch: { lateMinutes?: number; earlyMinutes?: number },
  ) => void
  /** Mark that a person left the shift at a clock time. Null means they stayed to the end. */
  setEarlyLeave: (workerId: string, minutes: number | null) => void
  recordShiftDrop: (drop: ShiftDrop) => void
  undoShiftDrop: (workerId: string) => void
  /** Add a catalog lane onto the open board without leaving it. */
  addBoardLane: (laneId: string) => void
  /** Activate/deactivate מנהל שער for a manager (at most one per shift). */
  setGateManager: (workerId: string | null) => void
  setAllActiveLanes: (on: boolean) => void
  setAllActiveWorkers: (on: boolean) => void
  runAutoAssign: () => void
  /** Two boards for the open single-placement shift: load fairness and hard-lane experience. */
  previewBoardOptions: () => {
    loadFair: AssignmentResult
    hardExperience: AssignmentResult
  } | null
  /** Replace the open board with a chosen alternative. Does not save. */
  applyBoardOption: (placed: AssignmentResult, label: string) => void
  /** Turn the open inspector board into a full-shift selector round table. */
  commitSelectorBoard: () => void
  /** Open an empty board so managers can place present workers by hand. */
  startManualAssign: () => void
  updateAssignment: (laneId: string, slotIndex: number, workerId: string | null) => void
  /** Set one cell on the selector round table. Same person cannot fill two lanes in one round. */
  updateSelectorCell: (
    roundIndex: number,
    laneId: string,
    slotIndex: number,
    workerId: string | null,
  ) => void
  /** Swap two filled slots between lanes (or within the same lane). */
  swapAssignments: (
    a: { laneId: string; slotIndex: number },
    b: { laneId: string; slotIndex: number },
  ) => void
  /**
   * Remove a worker from the current shift: clears every slot they occupy
   * and drops them from present attendance so save is not blocked.
   */
  removeWorkerFromShift: (workerId: string) => void
  /** Prepare an automatic refill before a seated person leaves. */
  beginRemoval: (workerId: string) => void
  confirmSelfHeal: () => Promise<void>
  editRemovalManually: () => void
  dismissSelfHeal: () => void
  healing: boolean
  healPlan: { healed: SelfHealPlan; manual: SelfHealPlan } | null
  /** Replace one seated person. Other seats stay as they are. */
  replaceLeavingWorker: (leavingId: string, replacementId: string) => void
  /** Drop a lane from the open shift. People who were on it stay present and become unassigned. */
  removeLaneFromShift: (laneId: string) => void
  updateLaneNotes: (laneId: string, notes: string) => void
  addExtraWorkerToLane: (laneId: string, workerId: string) => void
  addSlotToLane: (laneId: string) => void
  saveCurrentShift: () => Promise<void>
  /** Close the open shift with the manager's typed name and lock the board. */
  signCurrentShift: (signature: string) => Promise<void>
  loadShiftFromHistory: (id: string) => void
  deleteHistoryItem: (id: string) => Promise<void>
  addWorker: (w: Omit<Worker, 'id'>) => void
  updateWorker: (w: Worker) => void
  deleteWorker: (id: string) => void
  addLane: (l: Omit<Lane, 'id'>) => void
  updateLane: (l: Lane) => void
  deleteLane: (id: string) => void
  addCertification: (name: string) => void
  removeCertification: (name: string) => void
  upsertBriefingSection: (
    section: Omit<BriefingSection, 'id' | 'updatedAt' | 'order'> & {
      id?: string
      order?: number
    },
  ) => void
  deleteBriefingSection: (id: string) => void
  reorderBriefingSections: (orderedIds: string[]) => void
  upsertInspectorQuestion: (
    question: Omit<InspectorQuestion, 'id' | 'updatedAt' | 'order'> & {
      id?: string
      order?: number
    },
  ) => void
  deleteInspectorQuestion: (id: string) => void
  reorderInspectorQuestions: (orderedIds: string[]) => void
  saveShiftModels: (models: ShiftModel[]) => void
  upsertCustomsBroker: (broker: { id?: string; name: string }) => void
  deleteCustomsBroker: (id: string) => void
  upsertCustomsBrokerContact: (
    brokerId: string,
    contact: { id?: string; name: string; phone: string },
  ) => void
  deleteCustomsBrokerContact: (brokerId: string, contactId: string) => void
  resetToSeed: () => Promise<void>
  refreshFromServer: () => Promise<void>
}

const emptyData: AppData = {
  workers: [],
  lanes: [],
  history: [],
  certificationsCatalog: [],
  briefingSections: [],
  questionBank: [],
  customsBrokers: [],
  shiftModels: [],
  revision: 0,
}

const AppContext = createContext<AppContextValue | null>(null)

function selectorRoundBounds(shiftType: string, models: ShiftModel[] | undefined, inspectors: boolean) {
  const model = shiftModelById(
    resolveShiftModels(models, inspectors ? 'inspectors' : 'selectors'),
    shiftType,
  )
  if (!model) return undefined
  return { start: model.startMinutes, end: shiftModelAbsoluteEnd(model) }
}

function workerIsSeated(
  draft: { assignments: { workerIds: string[] }[]; rounds?: { assignments: { workerIds: string[] }[] }[] },
  workerId: string,
): boolean {
  if (draft.assignments.some((row) => row.workerIds.includes(workerId))) return true
  return (draft.rounds ?? []).some((round) =>
    round.assignments.some((row) => row.workerIds.includes(workerId)),
  )
}

function padAssignments(
  assignments: LaneAssignment[],
  lanes: Lane[],
  activeLaneIds: string[],
  overrides?: StaffingOverrides | null,
): LaneAssignment[] {
  return activeLaneIds.map((laneId) => {
    const lane = lanes.find((l) => l.id === laneId)
    const std = effectiveStaffingStandard(lane, overrides)
    const existing = assignments.find((a) => a.laneId === laneId)
    const filled = [...(existing?.workerIds ?? [])].filter(Boolean)
    const targetLen = Math.max(std, filled.length)
    const padded = [...filled]
    while (padded.length < targetLen) padded.push('')
    return {
      laneId,
      workerIds: padded,
      notes: existing?.notes?.trim() ? existing.notes : undefined,
    }
  })
}

function stripEmpty(assignments: LaneAssignment[]): LaneAssignment[] {
  return assignments.map((a) => ({
    laneId: a.laneId,
    workerIds: a.workerIds.filter(Boolean),
    ...(a.notes?.trim() ? { notes: a.notes.trim() } : {}),
  }))
}

function withGateManagerSync(d: ShiftDraft, lanes: Lane[]): ShiftDraft {
  if (usesRounds(d)) {
    return {
      ...d,
      unassignedWorkerIds: unassignedSelectorIds(
        d.presentWorkerIds,
        d.rounds ?? [],
        d.gateManagerWorkerId,
      ),
    }
  }
  const synced = syncGateManagerPlacement({
    lanes,
    activeLaneIds: d.activeLaneIds,
    assignments: d.assignments,
    gateManagerWorkerId: d.gateManagerWorkerId,
    staffingOverrides: d.staffingOverrides,
  })
  return {
    ...d,
    activeLaneIds: synced.activeLaneIds,
    assignments: synced.assignments,
    unassignedWorkerIds: computeUnassignedWorkerIds(
      d.presentWorkerIds,
      synced.assignments,
      d.gateManagerWorkerId,
    ),
  }
}

function restoreDraft(): ShiftDraft | null {
  try {
    const raw = loadDraftJson()
    if (!raw) return null
    const parsed = JSON.parse(raw) as ShiftDraft
    if (!parsed?.id || !Array.isArray(parsed.activeLaneIds)) return null
    return {
      ...parsed,
      audience: parsed.audience === 'selector' ? 'selector' : 'inspector',
      assignmentMode: assignmentModeOf(parsed),
      rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
      workerWindows:
        parsed.workerWindows && typeof parsed.workerWindows === 'object'
          ? parsed.workerWindows
          : {},
      windowAdjustments:
        parsed.windowAdjustments && typeof parsed.windowAdjustments === 'object'
          ? parsed.windowAdjustments
          : {},
      staggerRounds: Boolean(parsed.staggerRounds),
      signOff: normalizeSignOff(parsed.signOff),
      explanations: Array.isArray(parsed.explanations) ? parsed.explanations : [],
      staffingOverrides: normalizeStaffingOverrides(parsed.staffingOverrides),
      gateManagerWorkerId: parsed.gateManagerWorkerId?.trim() || undefined,
    }
  } catch {
    return null
  }
}

function restoreStep(): ShiftStep {
  const s = loadShiftStep()
  if (s === 'lanes' || s === 'attendance' || s === 'board') return s
  return 'lanes'
}

/** Stable snapshot used to detect whether the user changed the current shift. */
function snapshotDraft(d: ShiftDraft): string {
  return JSON.stringify({
    id: d.id,
    date: d.date,
    shiftType: d.shiftType,
    audience: d.audience ?? 'inspector',
    assignmentMode: assignmentModeOf(d),
    rounds: d.rounds ?? [],
    workerWindows: d.workerWindows ?? {},
    windowAdjustments: d.windowAdjustments ?? {},
    staggerRounds: Boolean(d.staggerRounds),
    activeLaneIds: d.activeLaneIds,
    presentWorkerIds: d.presentWorkerIds,
    gateManagerWorkerId: d.gateManagerWorkerId ?? '',
    assignments: d.assignments.map((a) => ({
      laneId: a.laneId,
      workerIds: a.workerIds,
      notes: a.notes?.trim() ?? '',
    })),
    warnings: d.warnings,
    signOff: d.signOff ?? null,
    unassignedWorkerIds: d.unassignedWorkerIds,
    explanations: d.explanations ?? [],
    staffingOverrides: d.staffingOverrides ?? {},
  })
}

export function AppProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const initialCache = useMemo(() => {
    const cached = loadAppDataCache()
    return cached ? normalizeAppData(cached, loadSession()?.module === 'inspectors' ? 'inspectors' : 'selectors') : null
  }, [])
  const [data, setData] = useState<AppData>(() => initialCache ?? emptyData)
  const [loading, setLoading] = useState(() => !initialCache)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(() => loadSession())
  const [assignmentModes, setAssignmentModes] = useState<AssignmentModes>(
    DEFAULT_ASSIGNMENT_MODES,
  )
  const [roundMinutes, setRoundMinutes] = useState({ selectors: 120, inspectors: 120 })
  const [staggerRoundsSetting, setStaggerRoundsSetting] = useState({
    selectors: false,
    inspectors: false,
  })
  const [orgProfile, setOrgProfile] = useState({ name: '', logo: '' })
  const roundMinutesRef = useRef(roundMinutes)
  roundMinutesRef.current = roundMinutes
  const staggerRef = useRef(staggerRoundsSetting)
  staggerRef.current = staggerRoundsSetting
  const view = viewFromPath(location.pathname)
  const [shiftStep, setShiftStepState] = useState<ShiftStep>(() => restoreStep())
  const [draft, setDraftState] = useState<ShiftDraft | null>(() => restoreDraft())
  const setDraft = useCallback<Dispatch<SetStateAction<ShiftDraft | null>>>((action) => {
    setDraftState((current) => {
      const next = typeof action === 'function' ? action(current) : action
      if (current?.signOff?.signedAt && next && next.id === current.id) {
        if (
          next.signOff?.signedAt &&
          next.signOff.signedAt !== current.signOff.signedAt
        ) {
          return { ...current, signOff: next.signOff }
        }
        return current
      }
      return next
    })
  }, [])
  /** Restored drafts were already persisted → treat as dirty until discarded/saved clean. */
  const [draftDirty, setDraftDirty] = useState(() => restoreDraft() != null)
  const draftBaselineRef = useRef<string | null>(null)
  const beginRemovalRef = useRef<(workerId: string) => void>(() => {})
  const [healing, setHealing] = useState(false)
  const [healPlan, setHealPlan] = useState<{
    healed: SelfHealPlan
    manual: SelfHealPlan
  } | null>(null)
  const laneHoursKey = data.lanes
    .map(
      (lane) =>
        `${lane.id}:${(lane.activeHours ?? [])
          .map((span) => `${span.start}-${span.end}`)
          .join(',')}`,
    )
    .join('|')

  useEffect(() => {
    setDraft((current) => {
      if (!current?.rounds?.length) return current
      const applied = applyLaneActivityHours(
        current.rounds,
        data.lanes,
        current.warnings,
        current.staffingOverrides,
      )
      if (!applied.changed) return current
      return {
        ...current,
        rounds: applied.rounds,
        warnings: applied.warnings,
      }
    })
  }, [laneHoursKey, draft?.id, data.lanes])

  const dataRef = useRef(data)
  dataRef.current = data
  const syncTimer = useRef<number | null>(null)
  const pendingSaveRef = useRef<AppData | null>(null)
  const persistInFlightRef = useRef(false)
  const persistFlightRef = useRef<Promise<void>>(Promise.resolve())
  const skipNextSync = useRef(true)
  const userRef = useRef(user)
  userRef.current = user

  const adoptCleanDraft = useCallback((next: ShiftDraft) => {
    draftBaselineRef.current = snapshotDraft(next)
    setDraftDirty(false)
    setDraft(next)
  }, [])

  const restoreDraftSnapshot = useCallback((snapshot: ShiftDraft) => {
    setDraft(JSON.parse(JSON.stringify(snapshot)) as ShiftDraft)
  }, [])

  const applyRemoteData = useCallback((remote: AppData) => {
    const next = normalizeAppData(
      remote,
      loadSession()?.module === 'inspectors' ? 'inspectors' : 'selectors',
    )
    skipNextSync.current = true
    dataRef.current = next
    setData(next)
    saveAppDataCache(next)
    return next
  }, [])

  const setView = useCallback(
    (v: View) => {
      navigate(pathForView(v))
    },
    [navigate],
  )

  const setShiftStep = useCallback((s: ShiftStep) => {
    setShiftStepState(s)
  }, [])

  // Persist draft only after a real edit vs. the clean baseline.
  useEffect(() => {
    if (!draft) {
      setDraftDirty(false)
      draftBaselineRef.current = null
      clearDraftStorage()
      return
    }
    const baseline = draftBaselineRef.current
    const dirty = baseline === null || snapshotDraft(draft) !== baseline
    setDraftDirty(dirty)
    if (dirty) {
      saveDraftJson(JSON.stringify(draft))
      saveShiftStep(shiftStep)
    } else {
      clearDraftStorage()
    }
  }, [draft, shiftStep])

  // Leaving the shift flow without edits should not keep a phantom draft in memory.
  useEffect(() => {
    const onShift =
      location.pathname === '/shift' || location.pathname.startsWith('/shift/')
    const loadingHistoryItem = /^\/history\/[^/]+\/?$/.test(location.pathname)
    if (onShift || loadingHistoryItem || !draft) return
    const baseline = draftBaselineRef.current
    if (baseline !== null && snapshotDraft(draft) === baseline) {
      setDraft(null)
      clearDraftStorage()
      setShiftStepState('lanes')
    }
  }, [location.pathname, draft])

  const handleAuthFailure = useCallback(() => {
    clearSession()
    clearAppDataCache()
    setUser(null)
    draftBaselineRef.current = null
    setDraftDirty(false)
    setDraft(null)
    clearDraftStorage()
    setData(emptyData)
    navigate('/login', { replace: true })
  }, [navigate])

  /**
   * Serialized persist with fresh revision on each attempt.
   * Fixes false 409s when debounced saves overlap (same user, stale expectedRevision).
   */
  const drainPersist = useCallback(async () => {
    if (persistInFlightRef.current) {
      await persistFlightRef.current
      return
    }
    persistInFlightRef.current = true
    let resolveFlight: () => void = () => undefined
    let rejectFlight: (err: unknown) => void = () => undefined
    const flight = new Promise<void>((resolve, reject) => {
      resolveFlight = resolve
      rejectFlight = reject
    })
    persistFlightRef.current = flight
    setSyncing(true)
    let failed: unknown = null
    try {
      let retries409 = 0
      const MAX_409_RETRIES = 3
      while (pendingSaveRef.current) {
        const snapshot = pendingSaveRef.current
        pendingSaveRef.current = null
        const expectedRevision = dataRef.current.revision ?? 0
        try {
          const saved = await saveAppDataRemote({
            ...snapshot,
            revision: expectedRevision,
          })
          skipNextSync.current = true
          dataRef.current = saved
          setData(saved)
          saveAppDataCache(saved)
          setError(null)
          retries409 = 0
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            handleAuthFailure()
            throw e
          }
          if (e instanceof ApiError && e.status === 409 && e.current) {
            const server = normalizeAppData(
              e.current,
              loadSession()?.module === 'inspectors' ? 'inspectors' : 'selectors',
            )
            const merged: AppData = {
              ...snapshot,
              revision: server.revision ?? 0,
            }
            skipNextSync.current = true
            dataRef.current = merged
            setData(merged)
            saveAppDataCache(merged)
            retries409 += 1
            if (retries409 <= MAX_409_RETRIES) {
              pendingSaveRef.current = merged
              continue
            }
            dataRef.current = server
            setData(server)
            saveAppDataCache(server)
            setError(e.message)
            throw e
          }
          const msg = e instanceof Error ? e.message : 'שגיאת שמירה לשרת'
          setError(msg)
          throw e
        }
      }
    } catch (e) {
      failed = e
    } finally {
      persistInFlightRef.current = false
      setSyncing(false)
    }
    if (failed) {
      rejectFlight(failed)
      throw failed
    }
    if (pendingSaveRef.current) {
      try {
        await drainPersist()
      } catch (e) {
        rejectFlight(e)
        throw e
      }
    }
    resolveFlight()
  }, [handleAuthFailure])

  const queuePersist = useCallback(
    (next: AppData) => {
      pendingSaveRef.current = next
      if (syncTimer.current) window.clearTimeout(syncTimer.current)
      syncTimer.current = window.setTimeout(() => {
        void drainPersist().catch(() => undefined)
      }, 400)
    },
    [drainPersist],
  )

  const flushPersist = useCallback(async () => {
    if (syncTimer.current) {
      window.clearTimeout(syncTimer.current)
      syncTimer.current = null
    }
    await drainPersist()
  }, [drainPersist])

  const readServerRevision = useCallback(async () => {
    const remote = await fetchAppData(userRef.current?.module ?? undefined)
    if (remote && 'unchanged' in remote && remote.unchanged) {
      return remote.revision
    }
    const fresh = applyRemoteData(remote as AppData)
    return fresh.revision ?? 0
  }, [applyRemoteData])

  const runWithFreshRevision = useCallback(
    async <T,>(action: (revision: number) => Promise<T>): Promise<T> => {
      await flushPersist()
      let revision = dataRef.current.revision ?? 0
      let lastError: unknown = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await action(revision)
        } catch (e) {
          lastError = e
          if (e instanceof ApiError && e.status === 401) {
            handleAuthFailure()
            throw e
          }
          if (!(e instanceof ApiError) || e.status !== 409) throw e
          const remote = e.current
            ? applyRemoteData(e.current)
            : null
          const next = remote
            ? (remote.revision ?? 0)
            : await readServerRevision()
          if (next === revision && attempt > 0) break
          revision = next
        }
      }
      throw lastError instanceof Error ? lastError : new Error('הפעולה נכשלה')
    },
    [flushPersist, handleAuthFailure, applyRemoteData, readServerRevision],
  )

  const patchData = useCallback(
    (updater: (prev: AppData) => AppData) => {
      setData((prev) => {
        const next = updater(prev)
        dataRef.current = next
        queuePersist(next)
        return next
      })
    },
    [queuePersist],
  )

  const refreshFromServer = useCallback(async () => {
    if (!userRef.current?.token) {
      setLoading(false)
      setRefreshing(false)
      return
    }
    const hasLocal =
      dataRef.current.workers.length > 0 || dataRef.current.lanes.length > 0
    if (hasLocal) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const knownRevision = hasLocal ? dataRef.current.revision : undefined
      const remote = await fetchAppData(
        userRef.current?.module ?? undefined,
        knownRevision,
      )
      if (remote && 'unchanged' in remote && remote.unchanged) {
        return
      }
      applyRemoteData(remote as AppData)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        handleAuthFailure()
        return
      }
      setError(e instanceof Error ? e.message : 'לא ניתן להתחבר לשרת')
      if (dataRef.current.workers.length === 0) {
        setData(createSeedData())
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [handleAuthFailure, applyRemoteData])

  const checkLogin = useCallback(async (phone: string) => {
    const result = await checkLoginRemote(phone)
    return { next: result.next, message: result.message }
  }, [])

  const login = useCallback(
    async (
      phone: string,
      password: string,
      opts?: { newPassword?: string; newPasswordConfirm?: string },
    ) => {
      const session = await loginRemote(phone, password, opts)
      if ('next' in session && session.next) {
        if (session.next === 'change_password') return 'change_password'
        if (
          session.next === 'pending_approval' ||
          session.next === 'rejected' ||
          session.next === 'suspended' ||
          session.next === 'no_modules' ||
          session.next === 'await_email'
        ) {
          return { next: session.next, message: session.message }
        }
      }
      if (!('token' in session) || !session.token) {
        throw new Error(
          'message' in session && session.message
            ? session.message
            : 'לא התקבל טוקן התחברות',
        )
      }
      saveSession(session)
      setUser(session)
      navigate(session.role === 'super_admin' ? '/admin' : '/', { replace: true })
    },
    [navigate],
  )

  const requestPasswordReset = useCallback(async (phone: string) => {
    const result = await requestPasswordResetRemote(phone)
    return result.message || 'אם המספר רשום, נשלח מייל עם סיסמה זמנית.'
  }, [])

  const resendManagerTempPassword = useCallback(async (workerId: string) => {
    await resendManagerTempPasswordRemote(workerId)
  }, [])

  const logout = useCallback(() => {
    clearAppDataCache()
    clearSession()
    clearDraftStorage()
    setUser(null)
    setAssignmentModes(DEFAULT_ASSIGNMENT_MODES)
    draftBaselineRef.current = null
    setDraftDirty(false)
    setDraft(null)
    setData(emptyData)
    navigate('/login', { replace: true })
  }, [navigate])

  const setModule = useCallback(
    (next: AppModule) => {
      if (!user || user.role !== 'org_manager' || user.module === next) return
      if (!user.modules[next]) return
      if (
        draftDirty &&
        !window.confirm('לעבור למודול האחר? הטיוטה הפתוחה תוסר.')
      ) {
        return
      }
      const updated = { ...user, module: next }
      clearAppDataCache()
      saveSession(updated)
      clearDraftStorage()
      draftBaselineRef.current = null
      setDraftDirty(false)
      setDraft(null)
      setData(emptyData)
      setUser(updated)
      navigate('/', { replace: true })
    },
    [draftDirty, navigate, user],
  )

  useEffect(() => {
    if (!user?.token || user.role !== 'org_manager') return
    let cancelled = false
    void fetchOrgSettings()
      .then((settings) => {
        if (!cancelled) {
          setAssignmentModes(normalizeAssignmentModes(settings.assignmentModes))
          if (settings.roundMinutes) {
            setRoundMinutes({
              selectors: Number(settings.roundMinutes.selectors) || 120,
              inspectors: Number(settings.roundMinutes.inspectors) || 120,
            })
          }
          if (settings.staggerRounds) {
            setStaggerRoundsSetting({
              selectors: settings.staggerRounds.selectors === true,
              inspectors: settings.staggerRounds.inspectors === true,
            })
          }
          if (settings.organization) setOrgProfile(settings.organization)
        }
      })
      .catch(() => {
        /* keep the built-in defaults until the next successful read */
      })
    return () => {
      cancelled = true
    }
  }, [user?.token, user?.role])

  const saveRoundMinutes = useCallback(
    async (minutes: { selectors: number; inspectors: number }) => {
      const saved = await saveOrgSettings({
        assignmentModes,
        roundMinutes: minutes,
      })
      if (saved.roundMinutes) {
        setRoundMinutes({
          selectors: Number(saved.roundMinutes.selectors) || 120,
          inspectors: Number(saved.roundMinutes.inspectors) || 120,
        })
      }
    },
    [assignmentModes],
  )

  const saveStaggerRounds = useCallback(
    async (stagger: { selectors: boolean; inspectors: boolean }) => {
      const saved = await saveOrgSettings({
        assignmentModes,
        roundMinutes,
        staggerRounds: stagger,
      })
      if (saved.staggerRounds) {
        setStaggerRoundsSetting({
          selectors: saved.staggerRounds.selectors === true,
          inspectors: saved.staggerRounds.inspectors === true,
        })
      }
    },
    [assignmentModes, roundMinutes],
  )

  const saveOrgProfile = useCallback(
    async (profile: { name: string; logo: string }) => {
      const saved = await saveOrgSettings({ profile })
      if (saved.organization) {
        setOrgProfile(saved.organization)
        setUser((current) => {
          if (!current) return current
          const next = { ...current, orgName: saved.organization!.name }
          saveSession(next)
          return next
        })
      }
    },
    [],
  )

  const saveAssignmentModes = useCallback(async (modes: AssignmentModes) => {
    const saved = await saveOrgSettings({
      assignmentModes: normalizeAssignmentModes(modes),
      roundMinutes,
    })
    setAssignmentModes(normalizeAssignmentModes(saved.assignmentModes))
    if (saved.roundMinutes) {
      setRoundMinutes({
        selectors: Number(saved.roundMinutes.selectors) || 120,
        inspectors: Number(saved.roundMinutes.inspectors) || 120,
      })
    }
  }, [])

  useEffect(() => {
    if (!user?.token || user.role !== 'org_manager') return
    let stop = false
    const tick = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      try {
        const fresh = await refreshSessionRemote()
        if (stop) return
        const prev = loadSession()
        const module =
          prev?.module && fresh.modules?.[prev.module] ? prev.module : fresh.module
        const next = { ...fresh, token: fresh.token, module }
        const changed =
          Boolean(prev?.isOrgManager) !== Boolean(next.isOrgManager) ||
          Boolean(prev?.modules.selectors) !== Boolean(next.modules?.selectors) ||
          Boolean(prev?.modules.inspectors) !== Boolean(next.modules?.inspectors) ||
          prev?.module !== next.module
        saveSession(next)
        if (changed) setUser(next)
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) handleAuthFailure()
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 20000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [user?.token, user?.role, handleAuthFailure])

  useEffect(() => {
    if (!user?.token || user.role !== 'org_manager') {
      setLoading(false)
      setRefreshing(false)
      return
    }
    void refreshFromServer()
  }, [user?.token, user?.role, user?.module, refreshFromServer])

  // Redirect unauthenticated users away from app routes. Unknown paths stay on the 404 page.
  useEffect(() => {
    const path = location.pathname.replace(/\/+$/, '') || '/'
    const isPublic =
      path === '/login' ||
      path === '/privacy' ||
      path === '/register' ||
      path === '/help' ||
      path === '/report' ||
      path === '/algorithm'
    if (!isPublic && !isAppPath(path)) return
    if (!user && !isPublic) {
      navigate('/login', { replace: true })
    }
    if (user?.role === 'super_admin' && path !== '/admin' && !isPublic) {
      navigate('/admin', { replace: true })
    }
    if (
      user?.role === 'org_manager' &&
      (path === '/login' || path === '/register' || path === '/admin')
    ) {
      navigate('/', { replace: true })
    }
  }, [user, location.pathname, navigate])

  // Deep-link: /history/:id → load shift
  useEffect(() => {
    const m = location.pathname.match(/^\/history\/([^/]+)\/?$/)
    if (!m || !user || loading) return
    const id = decodeURIComponent(m[1])
    const item = data.history.find((h) => h.id === id)
    if (!item) return
    const gateManagerWorkerId = normalizeGateManagerId(
      item.gateManagerWorkerId,
      item.presentWorkerIds,
      data.workers,
    )
    adoptCleanDraft(
      withGateManagerSync(
        {
          id: item.id,
          date: item.date,
          shiftType: item.shiftType,
          audience: item.audience === 'selector' ? 'selector' : 'inspector',
          assignmentMode: assignmentModeOf(item),
          activeLaneIds: item.activeLaneIds,
          presentWorkerIds: item.presentWorkerIds,
          gateManagerWorkerId,
          assignments: padAssignments(
            item.assignments,
            data.lanes,
            item.activeLaneIds,
            item.staffingOverrides,
          ),
          rounds:
            usesRounds(item) && Array.isArray(item.rounds) ? item.rounds : [],
          workerWindows: item.workerWindows ?? {},
          windowAdjustments: item.windowAdjustments ?? {},
          staggerRounds: Boolean(item.staggerRounds),
          earlyLeaveAt: item.earlyLeaveAt,
          shiftDrops: item.shiftDrops,
          signOff: normalizeSignOff(item.signOff),
          frozenLaneIds: item.frozenLaneIds,
          seatSegments: item.seatSegments,
          seatSpan: item.seatSpan,
          isSelfHealed: item.isSelfHealed,
          shiftEvents: item.shiftEvents,
          warnings: [],
          unassignedWorkerIds: [],
          explanations: Array.isArray(item.explanations) ? item.explanations : [],
          staffingOverrides: normalizeStaffingOverrides(item.staffingOverrides),
        },
        data.lanes,
      ),
    )
    setShiftStep('board')
    navigate('/shift', { replace: true })
  }, [
    location.pathname,
    user,
    loading,
    data.history,
    data.lanes,
    navigate,
    setShiftStep,
    adoptCleanDraft,
  ])

  const toSchedule = useCallback((d: ShiftDraft): ShiftSchedule => {
    const now = new Date().toISOString()
    const overrides = normalizeStaffingOverrides(d.staffingOverrides)
    const gateManagerWorkerId = d.gateManagerWorkerId?.trim() || undefined
    return {
      id: d.id,
      date: d.date,
      shiftType: d.shiftType,
      activeLaneIds: d.activeLaneIds,
      presentWorkerIds: d.presentWorkerIds,
      ...(gateManagerWorkerId ? { gateManagerWorkerId } : {}),
      assignmentMode: usesRounds(d) ? 'rounds' : 'single',
      assignments: usesRounds(d) ? [] : stripEmpty(d.assignments),
      ...(d.audience === 'selector' ? { audience: 'selector' as const } : {}),
      ...(usesRounds(d)
        ? {
            rounds: d.rounds ?? [],
            ...(Object.keys(d.workerWindows ?? {}).length > 0
              ? { workerWindows: d.workerWindows }
              : {}),
            ...(Object.keys(d.windowAdjustments ?? {}).length > 0
              ? { windowAdjustments: d.windowAdjustments }
              : {}),
            ...(d.staggerRounds ? { staggerRounds: true } : {}),
          }
        : {}),
      ...(Object.keys(overrides).length > 0
        ? { staffingOverrides: overrides }
        : {}),
      explanations: (d.explanations ?? [])
        .filter(
          (item) =>
            item.laneId &&
            item.workerId &&
            Array.isArray(item.reasons) &&
            item.reasons.length > 0,
        )
        .map((item) => ({
          laneId: item.laneId,
          workerId: item.workerId,
          reasons: item.reasons,
        })),
      ...(d.earlyLeaveAt && Object.keys(d.earlyLeaveAt).length > 0
        ? { earlyLeaveAt: d.earlyLeaveAt }
        : {}),
      ...(d.shiftDrops?.length ? { shiftDrops: d.shiftDrops } : {}),
      ...(d.signOff?.signedAt ? { signOff: d.signOff } : {}),
      ...(d.isSelfHealed ? { isSelfHealed: true } : {}),
      ...(d.seatSegments?.length
        ? { seatSegments: d.seatSegments, seatSpan: d.seatSpan }
        : {}),
      ...(d.frozenLaneIds?.length ? { frozenLaneIds: d.frozenLaneIds } : {}),
      ...(d.shiftEvents?.length ? { shiftEvents: d.shiftEvents } : {}),
      createdAt: now,
      updatedAt: now,
    }
  }, [])

  const startShift = useCallback((audience: ShiftAudience = 'inspector') => {
    const inspectors = user?.module === 'inspectors'
    const lockedAudience: ShiftAudience = inspectors ? 'inspector' : audience
    const assignmentMode =
      assignmentModes[inspectors ? 'inspectors' : 'selectors']
    const models = resolveShiftModels(
      data.shiftModels,
      inspectors ? 'inspectors' : 'selectors',
    )
    const catalog = models.map((model) => model.id as ShiftType)
    const clock = currentShiftModel(models)
    const shiftType = catalog.includes(clock.model.id as ShiftType)
      ? (clock.model.id as ShiftType)
      : (catalog[0] ?? 'morning')

    adoptCleanDraft({
      id: uuid(),
      date: clock.date,
      shiftType,
      audience: lockedAudience,
      assignmentMode,
      activeLaneIds: [],
      presentWorkerIds: [],
      assignments: [],
      rounds: [],
      workerWindows: {},
      windowAdjustments: {},
      staggerRounds:
        staggerRef.current[inspectors ? 'inspectors' : 'selectors'],
      warnings: [],
      unassignedWorkerIds: [],
      explanations: [],
      staffingOverrides: {},
    })
    setShiftStep('lanes')
    setView('shift')
  }, [adoptCleanDraft, assignmentModes, data.shiftModels, setShiftStep, setView, user?.module])

  const discardDraft = useCallback(() => {
    draftBaselineRef.current = null
    setDraftDirty(false)
    setDraft(null)
    clearDraftStorage()
    setShiftStep('lanes')
    setView('home')
  }, [setShiftStep, setView])

  const updateDraftMeta = useCallback(
    (patch: Partial<Pick<ShiftDraft, 'date' | 'shiftType'>>) => {
      setDraft((d) => {
        if (!d) return d
        const typeChanged =
          patch.shiftType != null && patch.shiftType !== d.shiftType
        const dateChanged = patch.date != null && patch.date !== d.date
        if (!typeChanged && !dateChanged) return { ...d, ...patch }
        return {
          ...d,
          ...patch,
          id: uuid(),
          signOff: undefined,
          assignments: [],
          rounds: [],
          explanations: [],
          warnings: [],
          unassignedWorkerIds: [],
          presentWorkerIds: [],
          workerWindows: {},
          windowAdjustments: {},
          gateManagerWorkerId: undefined,
        }
      })
    },
    [],
  )

  const toggleLane = useCallback((laneId: string) => {
    setDraft((d) => {
      if (!d) return d
      const has = d.activeLaneIds.includes(laneId)
      const lane = data.lanes.find((l) => l.id === laneId)
      const turningOffGate = has && lane && isGateManagerLane(lane)
      const activeLaneIds = has
        ? d.activeLaneIds.filter((id) => id !== laneId)
        : [...d.activeLaneIds, laneId]
      return withGateManagerSync(
        {
          ...d,
          activeLaneIds,
          ...(turningOffGate ? { gateManagerWorkerId: undefined } : {}),
        },
        data.lanes,
      )
    })
  }, [data.lanes])

  const applyLaneSelection = useCallback(
    (laneIds: string[], staffingOverrides?: StaffingOverrides) => {
      setDraft((d) => {
        if (!d) return d
        const known = new Set(data.lanes.map((l) => l.id))
        let activeLaneIds = laneIds.filter((id) => known.has(id))
        const nextOverrides =
          staffingOverrides != null
            ? normalizeStaffingOverrides(staffingOverrides)
            : d.staffingOverrides
        const gateLane = findGateManagerLane(data.lanes)
        // Keep gate station active when a gate manager is designated.
        if (
          d.gateManagerWorkerId &&
          gateLane &&
          !activeLaneIds.includes(gateLane.id)
        ) {
          activeLaneIds = [...activeLaneIds, gateLane.id]
        }
        return withGateManagerSync(
          {
            ...d,
            activeLaneIds,
            staffingOverrides: nextOverrides,
            assignments: padAssignments(
              d.assignments,
              data.lanes,
              activeLaneIds,
              nextOverrides,
            ),
          },
          data.lanes,
        )
      })
    },
    [data.lanes],
  )

  const applyPresentSelection = useCallback(
    (
      workerIds: string[],
      opts?: {
        gateManagerWorkerId?: string | null
        workerWindows?: Record<string, string>
      },
    ) => {
      setDraft((d) => {
        if (!d) return d
        const known = new Set(
          data.workers
            .filter((w) => w.status === 'active' && w.isInspector)
            .map((w) => w.id),
        )
        let presentWorkerIds = workerIds.filter((id) => known.has(id))
        const gateManagerWorkerId = normalizeGateManagerId(
          opts?.gateManagerWorkerId !== undefined
            ? opts.gateManagerWorkerId
            : d.gateManagerWorkerId,
          presentWorkerIds,
          data.workers,
        )
        if (
          gateManagerWorkerId &&
          !presentWorkerIds.includes(gateManagerWorkerId)
        ) {
          presentWorkerIds = [...presentWorkerIds, gateManagerWorkerId]
        }
        const presentSet = new Set(presentWorkerIds)
        const overrides = d.staffingOverrides
        const assignments = padAssignments(
          d.assignments,
          data.lanes,
          d.activeLaneIds,
          overrides,
        ).map((a) => {
          const workerIdsNext = a.workerIds.map((id) =>
            id && presentSet.has(id) ? id : '',
          )
          const lane = data.lanes.find((l) => l.id === a.laneId)
          const std = effectiveStaffingStandard(lane, overrides)
          while (
            workerIdsNext.length > std &&
            !workerIdsNext[workerIdsNext.length - 1]
          ) {
            workerIdsNext.pop()
          }
          return { ...a, workerIds: workerIdsNext }
        })
        return withGateManagerSync(
          {
            ...d,
            presentWorkerIds,
            gateManagerWorkerId,
            assignments,
            ...(opts?.workerWindows ? { workerWindows: opts.workerWindows } : {}),
          },
          data.lanes,
        )
      })
    },
    [data.lanes, data.workers],
  )

  const setLaneStaffingStandard = useCallback(
    (laneId: string, standard: StaffingStandard) => {
      setDraft((d) => {
        if (!d) return d
        const catalog = data.lanes.find((l) => l.id === laneId)
        const max = laneMaxStaffing(catalog)
        const clamped = clampStaffingStandard(standard)
        const nextValue = (clamped > max ? max : clamped) as StaffingStandard
        const nextOverrides = { ...normalizeStaffingOverrides(d.staffingOverrides) }
        // Default shift תקן is 1 — only persist overrides above the default.
        if (nextValue === DEFAULT_SHIFT_STAFFING) {
          delete nextOverrides[laneId]
        } else {
          nextOverrides[laneId] = nextValue
        }
        return {
          ...d,
          staffingOverrides: nextOverrides,
          assignments: padAssignments(
            d.assignments,
            data.lanes,
            d.activeLaneIds,
            nextOverrides,
          ),
        }
      })
    },
    [data.lanes],
  )

  const toggleWorker = useCallback((workerId: string) => {
    if (
      draft &&
      !draft.signOff?.signedAt &&
      draft.presentWorkerIds.includes(workerId) &&
      workerIsSeated(draft, workerId)
    ) {
      beginRemovalRef.current(workerId)
      return
    }
    setDraft((d) => {
      if (!d) return d
      const has = d.presentWorkerIds.includes(workerId)
      if (!has) {
        const next = {
          ...d,
          presentWorkerIds: [...d.presentWorkerIds, workerId],
        }
        if (usesRounds(d)) {
          return withGateManagerSync(next, data.lanes)
        }
        return {
          ...next,
          unassignedWorkerIds: computeUnassignedWorkerIds(
            next.presentWorkerIds,
            d.assignments,
            d.gateManagerWorkerId,
          ),
        }
      }
      const presentWorkerIds = d.presentWorkerIds.filter((id) => id !== workerId)
      const gateManagerWorkerId =
        d.gateManagerWorkerId === workerId ? undefined : d.gateManagerWorkerId
      const overrides = d.staffingOverrides
      const assignments = padAssignments(
        d.assignments,
        data.lanes,
        d.activeLaneIds,
        overrides,
      ).map((a) => {
        const workerIds = a.workerIds.map((id) => (id === workerId ? '' : id))
        const lane = data.lanes.find((l) => l.id === a.laneId)
        const std = effectiveStaffingStandard(lane, overrides)
        while (workerIds.length > std && !workerIds[workerIds.length - 1]) {
          workerIds.pop()
        }
        return { ...a, workerIds }
      })
      return withGateManagerSync(
        {
          ...d,
          presentWorkerIds,
          gateManagerWorkerId,
          assignments,
          rounds: usesRounds(d)
            ? clearWorkerFromRounds(d.rounds ?? [], workerId)
            : [],
        },
        data.lanes,
      )
    })
  }, [data.lanes, draft])

  const setGateManager = useCallback(
    (workerId: string | null) => {
      setDraft((d) => {
        if (!d) return d
        const dropManagerOnlyIfNeeded = (
          present: string[],
          prevGateId: string | undefined,
        ) => {
          if (!prevGateId || prevGateId === workerId) return present
          const prev = data.workers.find((w) => w.id === prevGateId)
          if (prev && prev.isManager && !prev.isInspector) {
            return present.filter((id) => id !== prevGateId)
          }
          return present
        }

        if (!workerId) {
          const presentWorkerIds = dropManagerOnlyIfNeeded(
            d.presentWorkerIds,
            d.gateManagerWorkerId,
          )
          return withGateManagerSync(
            {
              ...d,
              presentWorkerIds,
              gateManagerWorkerId: undefined,
            },
            data.lanes,
          )
        }
        const worker = data.workers.find((w) => w.id === workerId)
        if (
          !worker ||
          worker.status !== 'active' ||
          !worker.isManager ||
          !worker.isInspector
        ) {
          return d
        }
        let presentWorkerIds = dropManagerOnlyIfNeeded(
          d.presentWorkerIds,
          d.gateManagerWorkerId,
        )
        if (!presentWorkerIds.includes(workerId)) {
          presentWorkerIds = [...presentWorkerIds, workerId]
        }
        return withGateManagerSync(
          {
            ...d,
            presentWorkerIds,
            gateManagerWorkerId: workerId,
            rounds: clearWorkerFromRounds(d.rounds ?? [], workerId),
          },
          data.lanes,
        )
      })
    },
    [data.lanes, data.workers],
  )

  const setAllActiveLanes = useCallback(
    (on: boolean) => {
      setDraft((d) => {
        if (!d) return d
        if (!on) {
          return withGateManagerSync(
            {
              ...d,
              activeLaneIds: [],
              // Clearing all lanes also clears gate-manager designation.
              gateManagerWorkerId: undefined,
            },
            data.lanes,
          )
        }
        return withGateManagerSync(
          {
            ...d,
            activeLaneIds: data.lanes
              .filter((l) => !isGateManagerLane(l))
              .map((l) => l.id),
          },
          data.lanes,
        )
      })
    },
    [data.lanes],
  )

  const setAllActiveWorkers = useCallback(
    (on: boolean) => {
      setDraft((d) => {
        if (!d) return d
        if (!on) {
          return withGateManagerSync(
            {
              ...d,
              presentWorkerIds: [],
              gateManagerWorkerId: undefined,
            },
            data.lanes,
          )
        }
        const presentWorkerIds = data.workers
          .filter((w) => w.status === 'active' && w.isInspector)
          .map((w) => w.id)
        // Keep existing gate manager if still present / re-add them.
        let gateManagerWorkerId = normalizeGateManagerId(
          d.gateManagerWorkerId,
          [...presentWorkerIds, d.gateManagerWorkerId].filter(Boolean) as string[],
          data.workers,
        )
        const nextPresent =
          gateManagerWorkerId && !presentWorkerIds.includes(gateManagerWorkerId)
            ? [...presentWorkerIds, gateManagerWorkerId]
            : presentWorkerIds
        gateManagerWorkerId = normalizeGateManagerId(
          gateManagerWorkerId,
          nextPresent,
          data.workers,
        )
        return withGateManagerSync(
          {
            ...d,
            presentWorkerIds: nextPresent,
            gateManagerWorkerId,
          },
          data.lanes,
        )
      })
    },
    [data.lanes, data.workers],
  )

  const commitSelectorBoard = useCallback(() => {
    setDraft((d) => {
      if (!d || !usesRounds(d) || (d.rounds?.length ?? 0) > 0) return d
      const present = selectorStaff(
        data.workers,
        d.presentWorkerIds,
        d.gateManagerWorkerId,
      )
      const result = assignSelectorRounds({
        shiftType: d.shiftType,
        bounds: selectorRoundBounds(
          d.shiftType,
          data.shiftModels,
          user?.module === 'inspectors',
        ),
        roundMinutes:
          roundMinutesRef.current[
            user?.module === 'inspectors' ? 'inspectors' : 'selectors'
          ],
        stagger:
          staggerRef.current[
            user?.module === 'inspectors' ? 'inspectors' : 'selectors'
          ],
        windowAdjustments: d.windowAdjustments,
        lanes: data.lanes,
        activeLaneIds: d.activeLaneIds,
        workers: present,
        overrides: d.staffingOverrides,
        workerWindows: d.workerWindows,
      })
      return withGateManagerSync(
        {
          ...d,
          audience: user?.module === 'inspectors' ? 'inspector' : 'selector',
          assignmentMode: 'rounds',
          assignments: [],
          rounds: result.rounds,
          warnings: result.warnings,
          explanations: [],
        },
        data.lanes,
      )
    })
  }, [data.history, data.lanes, data.shiftModels, data.workers, user?.module])

  const setWorkerWindow = useCallback(
    (workerId: string, windowId: string | null) => {
      setDraft((d) => {
        if (!d) return d
        const workerWindows = { ...(d.workerWindows ?? {}) }
        if (!windowId) delete workerWindows[workerId]
        else workerWindows[workerId] = windowId
        const next = { ...d, workerWindows }
        if (!usesRounds(d) || (d.rounds?.length ?? 0) === 0) return next
        const present = selectorStaff(
          data.workers,
          d.presentWorkerIds,
          d.gateManagerWorkerId,
        )
        const result = assignSelectorRounds({
          shiftType: d.shiftType,
          bounds: selectorRoundBounds(
            d.shiftType,
            data.shiftModels,
            user?.module === 'inspectors',
          ),
          roundMinutes:
            roundMinutesRef.current[
              user?.module === 'inspectors' ? 'inspectors' : 'selectors'
            ],
          stagger:
            staggerRef.current[
              user?.module === 'inspectors' ? 'inspectors' : 'selectors'
            ],
          windowAdjustments: d.windowAdjustments,
          lanes: data.lanes,
          activeLaneIds: d.activeLaneIds,
          workers: present,
          overrides: d.staffingOverrides,
          workerWindows,
        })
        return withGateManagerSync(
          {
            ...next,
            audience: user?.module === 'inspectors' ? 'inspector' : 'selector',
            assignmentMode: 'rounds',
            rounds: result.rounds,
            warnings: result.warnings,
          },
          data.lanes,
        )
      })
    },
    [data.history, data.lanes, data.shiftModels, data.workers, user?.module],
  )

  const setWindowAdjustment = useCallback(
    (
      workerId: string,
      patch: { lateMinutes?: number; earlyMinutes?: number },
    ) => {
      setDraft((d) => {
        if (!d) return d
        const current = d.windowAdjustments?.[workerId] ?? {}
        const lateMinutes = patch.lateMinutes ?? current.lateMinutes ?? 0
        const earlyMinutes = patch.earlyMinutes ?? current.earlyMinutes ?? 0
        const windowAdjustments = { ...(d.windowAdjustments ?? {}) }
        if (!lateMinutes && !earlyMinutes) delete windowAdjustments[workerId]
        else windowAdjustments[workerId] = { lateMinutes, earlyMinutes }
        return { ...d, windowAdjustments }
      })
    },
    [],
  )

  const setEarlyLeave = useCallback((workerId: string, minutes: number | null) => {
    setDraft((d) => {
      if (!d) return d
      const earlyLeaveAt = { ...(d.earlyLeaveAt ?? {}) }
      if (minutes == null) delete earlyLeaveAt[workerId]
      else earlyLeaveAt[workerId] = minutes
      const cutoff = minutes == null ? null : earlyLeaveCutoff(d.shiftType, minutes)
      const rounds =
        cutoff == null || !usesRounds(d)
          ? d.rounds
          : (d.rounds ?? []).map((round) =>
              round.startMinutes < cutoff
                ? round
                : {
                    ...round,
                    assignments: round.assignments.map((row) => ({
                      ...row,
                      workerIds: row.workerIds.map((id) => (id === workerId ? '' : id)),
                    })),
                  },
            )
      return { ...d, earlyLeaveAt, rounds }
    })
  }, [])

  const recordShiftDrop = useCallback((drop: ShiftDrop) => {
    setDraft((d) => {
      if (!d) return d
      const reason = drop.reason.trim()
      if (!reason) return d
      const shiftDrops = [
        ...(d.shiftDrops ?? []).filter((item) => item.workerId !== drop.workerId),
        { ...drop, reason },
      ]
      const earlyLeaveAt = { ...(d.earlyLeaveAt ?? {}) }
      if (drop.kind === 'leave') {
        earlyLeaveAt[drop.workerId] = drop.minutes
      } else {
        delete earlyLeaveAt[drop.workerId]
      }
      const removed = drop.kind === 'cancel' || drop.kind === 'noshow'
      const cutoff =
        drop.kind === 'leave' ? earlyLeaveCutoff(d.shiftType, drop.minutes) : null
      const clearFromRounds = (rounds: typeof d.rounds, from: number | null) =>
        (rounds ?? []).map((round) =>
          from != null && round.startMinutes < from
            ? round
            : {
                ...round,
                assignments: round.assignments.map((row) => ({
                  ...row,
                  workerIds: row.workerIds.map((id) => (id === drop.workerId ? '' : id)),
                })),
              },
        )
      const rounds = removed
        ? clearFromRounds(d.rounds, null)
        : cutoff == null || !usesRounds(d)
          ? d.rounds
          : clearFromRounds(d.rounds, cutoff)
      const assignments = removed
        ? d.assignments.map((row) => ({
            ...row,
            workerIds: row.workerIds.map((id) => (id === drop.workerId ? '' : id)),
          }))
        : d.assignments
      const presentWorkerIds = removed
        ? d.presentWorkerIds.filter((id) => id !== drop.workerId)
        : d.presentWorkerIds
      const gateManagerWorkerId =
        removed && d.gateManagerWorkerId === drop.workerId
          ? undefined
          : d.gateManagerWorkerId
      return {
        ...d,
        shiftDrops,
        earlyLeaveAt,
        rounds,
        assignments,
        presentWorkerIds,
        gateManagerWorkerId,
      }
    })
  }, [])

  const undoShiftDrop = useCallback((workerId: string) => {
    setDraft((d) => {
      if (!d) return d
      const existing = d.shiftDrops?.find((item) => item.workerId === workerId)
      if (!existing) return d
      const shiftDrops = (d.shiftDrops ?? []).filter((item) => item.workerId !== workerId)
      const earlyLeaveAt = { ...(d.earlyLeaveAt ?? {}) }
      delete earlyLeaveAt[workerId]
      const presentWorkerIds =
        (existing.kind === 'cancel' || existing.kind === 'noshow') &&
        !d.presentWorkerIds.includes(workerId)
          ? [...d.presentWorkerIds, workerId]
          : d.presentWorkerIds
      return { ...d, shiftDrops, earlyLeaveAt, presentWorkerIds }
    })
  }, [])

  const addBoardLane = useCallback((laneId: string) => {
    setDraft((d) => {
      if (!d || d.activeLaneIds.includes(laneId)) return d
      const lane = data.lanes.find((item) => item.id === laneId)
      if (!lane || isGateManagerLane(lane)) return d
      const activeLaneIds = [...d.activeLaneIds, laneId]
      const staffing = effectiveStaffingStandard(lane, d.staffingOverrides)
      const empty = Array.from({ length: staffing }, () => '')
      const rounds = usesRounds(d)
        ? (d.rounds ?? []).map((round) => ({
            ...round,
            assignments: [
              ...round.assignments.filter((row) => row.laneId !== laneId),
              { laneId, workerIds: [...empty] },
            ],
          }))
        : d.rounds
      return withGateManagerSync(
        {
          ...d,
          activeLaneIds,
          assignments: padAssignments(
            d.assignments,
            data.lanes,
            activeLaneIds,
            d.staffingOverrides,
          ),
          rounds,
        },
        data.lanes,
      )
    })
  }, [data.lanes])

  const runAutoAssign = useCallback(() => {
    setDraft((d) => {
      if (!d) return d
      if (!usesRounds(d)) {
        const activeLanes = data.lanes
          .filter(
            (lane) =>
              d.activeLaneIds.includes(lane.id) && !isGateManagerLane(lane),
          )
          .map((lane) => ({
            ...lane,
            staffingStandard: effectiveStaffingStandard(lane, d.staffingOverrides),
          }))
        const presentWorkers = data.workers.filter(
          (worker) =>
            d.presentWorkerIds.includes(worker.id) &&
            worker.id !== d.gateManagerWorkerId &&
            worker.status === 'active',
        )
        const placed = runAssignmentAlgorithm(
          activeLanes,
          presentWorkers,
          data.history,
          data.lanes,
          { date: d.date, shiftType: d.shiftType },
        )
        const filled = placed.assignments.reduce(
          (count, row) => count + row.workerIds.filter(Boolean).length,
          0,
        )
        void postAuditEvent(
          'auto_assign',
          `${d.date} · ${SHIFT_TYPE_LABELS[d.shiftType]} · שיבוץ אחד למשמרת · ${filled} שיבוצים${
            placed.warnings[0] ? ` · ${placed.warnings[0]}` : ''
          }`,
        )
        return withGateManagerSync(
          {
            ...d,
            assignmentMode: 'single',
            rounds: [],
            assignments: padAssignments(
              placed.assignments,
              data.lanes,
              d.activeLaneIds,
              d.staffingOverrides,
            ),
            warnings: placed.warnings,
            explanations: placed.explanations,
          },
          data.lanes,
        )
      }
      const present = selectorStaff(
        data.workers,
        d.presentWorkerIds,
        d.gateManagerWorkerId,
      )
      const result = assignSelectorRounds({
        shiftType: d.shiftType,
        bounds: selectorRoundBounds(
          d.shiftType,
          data.shiftModels,
          user?.module === 'inspectors',
        ),
        roundMinutes:
          roundMinutesRef.current[
            user?.module === 'inspectors' ? 'inspectors' : 'selectors'
          ],
        stagger:
          staggerRef.current[
            user?.module === 'inspectors' ? 'inspectors' : 'selectors'
          ],
        windowAdjustments: d.windowAdjustments,
        lanes: data.lanes,
        activeLaneIds: d.activeLaneIds,
        workers: present,
        overrides: d.staffingOverrides,
        workerWindows: d.workerWindows,
      })
      const filled = result.rounds.reduce(
        (n, r) =>
          n +
          r.assignments.reduce(
            (m, a) => m + a.workerIds.filter(Boolean).length,
            0,
          ),
        0,
      )
      void postAuditEvent(
        'auto_assign',
        `${d.date} · ${SHIFT_TYPE_LABELS[d.shiftType]} · ${result.rounds.length} סבבים · ${filled} שיבוצים${
          result.warnings[0] ? ` · ${result.warnings[0]}` : ''
        }`,
      )
      return withGateManagerSync(
        {
          ...d,
          audience: user?.module === 'inspectors' ? 'inspector' : 'selector',
          assignmentMode: 'rounds',
          assignments: [],
          rounds: result.rounds,
          warnings: result.warnings,
          explanations: [],
        },
        data.lanes,
      )
    })
    setShiftStep('board')
  }, [data.history, data.lanes, data.shiftModels, data.workers, user?.module])

  const previewBoardOptions = useCallback(() => {
    if (!draft || draft.signOff?.signedAt || usesRounds(draft)) return null
    const activeLanes = data.lanes
      .filter(
        (lane) =>
          draft.activeLaneIds.includes(lane.id) && !isGateManagerLane(lane),
      )
      .map((lane) => ({
        ...lane,
        staffingStandard: effectiveStaffingStandard(lane, draft.staffingOverrides),
      }))
    const presentWorkers = data.workers.filter(
      (worker) =>
        draft.presentWorkerIds.includes(worker.id) &&
        worker.id !== draft.gateManagerWorkerId &&
        worker.status === 'active',
    )
    if (activeLanes.length === 0 || presentWorkers.length === 0) return null
    const shared = { date: draft.date, shiftType: draft.shiftType }
    return {
      loadFair: runAssignmentAlgorithm(
        activeLanes,
        presentWorkers,
        data.history,
        data.lanes,
        { ...shared, objective: 'loadFair' },
      ),
      hardExperience: runAssignmentAlgorithm(
        activeLanes,
        presentWorkers,
        data.history,
        data.lanes,
        { ...shared, objective: 'hardExperience' },
      ),
    }
  }, [data.history, data.lanes, data.workers, draft])

  const applyBoardOption = useCallback(
    (placed: AssignmentResult, label: string) => {
      if (!draft || draft.signOff?.signedAt || usesRounds(draft)) return
      const filled = placed.assignments.reduce(
        (count, row) => count + row.workerIds.filter(Boolean).length,
        0,
      )
      void postAuditEvent(
        'auto_assign',
        `${draft.date} · ${SHIFT_TYPE_LABELS[draft.shiftType]} · חלופה ${label} · ${filled} שיבוצים`,
      )
      setDraft((current) => {
        if (!current || current.signOff?.signedAt || usesRounds(current)) return current
        return withGateManagerSync(
          {
            ...current,
            assignmentMode: 'single',
            rounds: [],
            assignments: padAssignments(
              placed.assignments,
              data.lanes,
              current.activeLaneIds,
              current.staffingOverrides,
            ),
            warnings: placed.warnings,
            explanations: placed.explanations,
          },
          data.lanes,
        )
      })
      setShiftStep('board')
    },
    [data.lanes, draft, setShiftStep],
  )

  const startManualAssign = useCallback(() => {
    setDraft((d) => {
      if (!d) return d
      if (usesRounds(d)) {
        void postAuditEvent(
          'manual_assign',
          `${d.date} · ${SHIFT_TYPE_LABELS[d.shiftType]} · סלקטורים · טבלת סבבים ריקה · ${d.activeLaneIds.length} נתיבים · ${d.presentWorkerIds.length} נוכחים`,
        )
        return withGateManagerSync(
          {
            ...d,
            assignmentMode: 'rounds',
            assignments: [],
            rounds: emptySelectorRounds(
              d.shiftType,
              data.lanes,
              d.activeLaneIds,
              d.staffingOverrides,
              roundCutsForWindows(
                d.shiftType,
                d.presentWorkerIds.map((id) => d.workerWindows?.[id]),
              ),
              d.presentWorkerIds.map((id) => d.workerWindows?.[id]),
              roundMinutesRef.current[
                user?.module === 'inspectors' ? 'inspectors' : 'selectors'
              ],
            ),
            warnings: [],
            explanations: [],
          },
          data.lanes,
        )
      }
      void postAuditEvent(
        'manual_assign',
        `${d.date} · ${SHIFT_TYPE_LABELS[d.shiftType]} · לוח ריק לעריכה ידנית · ${d.activeLaneIds.length} נתיבים · ${d.presentWorkerIds.length} נוכחים`,
      )
      const notesByLane = new Map(
        d.assignments
          .filter((a) => a.notes?.trim())
          .map((a) => [a.laneId, a.notes!] as const),
      )
      const empty = padAssignments(
        [],
        data.lanes,
        d.activeLaneIds,
        d.staffingOverrides,
      ).map((a) =>
        notesByLane.has(a.laneId) ? { ...a, notes: notesByLane.get(a.laneId) } : a,
      )
      return withGateManagerSync(
        {
          ...d,
          assignmentMode: 'single',
          rounds: [],
          assignments: empty,
          warnings: [],
          explanations: [],
        },
        data.lanes,
      )
    })
    setShiftStep('board')
  }, [data.lanes])

  const updateAssignment = useCallback(
    (laneId: string, slotIndex: number, workerId: string | null) => {
      setDraft((d) => {
        if (!d) return d
        const padded = padAssignments(d.assignments, data.lanes, d.activeLaneIds, d.staffingOverrides).map(
          (a) => ({ ...a, workerIds: [...a.workerIds] }),
        )

        const lane = data.lanes.find((l) => l.id === laneId)
        const laneLabel = lane?.name || laneId
        const prevId = padded.find((a) => a.laneId === laneId)?.workerIds[slotIndex] || ''
        const prevName = prevId
          ? data.workers.find((w) => w.id === prevId)?.fullName || prevId
          : '(ריק)'
        const nextName = workerId
          ? data.workers.find((w) => w.id === workerId)?.fullName || workerId
          : '(ריק)'

        // Where was the incoming worker before (if any)?
        let fromLaneLabel: string | null = null
        if (workerId) {
          for (const a of padded) {
            if (a.workerIds.includes(workerId)) {
              fromLaneLabel =
                data.lanes.find((l) => l.id === a.laneId)?.name || a.laneId
              break
            }
          }
        }

        if (workerId) {
          for (const a of padded) {
            a.workerIds = a.workerIds.map((id) => (id === workerId ? '' : id))
          }
        }

        const target = padded.find((a) => a.laneId === laneId)
        if (target) {
          target.workerIds[slotIndex] = workerId ?? ''
          const std = effectiveStaffingStandard(lane, d.staffingOverrides)
          while (
            target.workerIds.length > std &&
            !target.workerIds[target.workerIds.length - 1]
          ) {
            target.workerIds.pop()
          }
        }

        if (prevId !== (workerId ?? '') && workerId && lane && !isGateManagerLane(lane)) {
          const seated = new Set(
            padded.flatMap((row) => row.workerIds.filter((id) => id && id !== workerId)),
          )
          const warning = rotationOverrideWarning({
            lane,
            worker: data.workers.find((item) => item.id === workerId) ?? {
              id: workerId,
              fullName: nextName,
              phone: '',
              certifications: [],
              status: 'active',
              isInspector: true,
              isManager: false,
            },
            alternatives: data.workers.filter(
              (item) => d.presentWorkerIds.includes(item.id) && !seated.has(item.id),
            ),
            history: data.history,
            lanes: data.lanes,
            shiftType: d.shiftType,
            date: d.date,
          })
          if (warning) notify.warning('השינוי פוגע ברוטציה', warning)
        }

        if (prevId !== (workerId ?? '')) {
          const bits = [`${laneLabel}: ${prevName} → ${nextName}`]
          if (fromLaneLabel && workerId) {
            bits.push(`${nextName} עבר מ${fromLaneLabel}`)
          }
          if (prevId && workerId && fromLaneLabel) {
            // potential displacement already captured as slot replace
          }
          void postAuditEvent(
            'manual_assign',
            `${d.date} · ${SHIFT_TYPE_LABELS[d.shiftType]} · ${bits.join(' · ')}`,
          )
        }

        return withGateManagerSync(
          {
            ...d,
            assignments: padded,
          },
          data.lanes,
        )
      })
    },
    [data.history, data.lanes, data.workers],
  )

  const updateSelectorCell = useCallback(
    (
      roundIndex: number,
      laneId: string,
      slotIndex: number,
      workerId: string | null,
    ) => {
      if (!workerId && draft) {
        const seated = draft.rounds?.[roundIndex]?.assignments.find(
          (row) => row.laneId === laneId,
        )?.workerIds[slotIndex]
        if (seated) {
          beginRemovalRef.current(seated)
          return
        }
      }
      setDraft((d) => {
        if (!d || !usesRounds(d)) return d
        const rounds = setSelectorCell(
          d.rounds ?? [],
          roundIndex,
          laneId,
          slotIndex,
          workerId,
        )
        if (rounds === (d.rounds ?? []) && workerId) {
          notify.error('אי אפשר לשבת באותו נתיב בשני סבבים רצופים')
          return d
        }
        return withGateManagerSync(
          {
            ...d,
            rounds,
            explanations: [],
          },
          data.lanes,
        )
      })
    },
    [data.lanes, draft],
  )

  const swapAssignments = useCallback(
    (
      a: { laneId: string; slotIndex: number },
      b: { laneId: string; slotIndex: number },
    ) => {
      setDraft((d) => {
        if (!d) return d
        if (a.laneId === b.laneId && a.slotIndex === b.slotIndex) return d
        const gateLane = findGateManagerLane(data.lanes)
        if (
          gateLane &&
          (a.laneId === gateLane.id || b.laneId === gateLane.id)
        ) {
          // Gate-manager station is locked to the designated manager.
          return d
        }
        const padded = padAssignments(d.assignments, data.lanes, d.activeLaneIds, d.staffingOverrides).map(
          (row) => ({ ...row, workerIds: [...row.workerIds] }),
        )
        const laneA = padded.find((row) => row.laneId === a.laneId)
        const laneB = padded.find((row) => row.laneId === b.laneId)
        if (!laneA || !laneB) return d
        while (laneA.workerIds.length <= a.slotIndex) laneA.workerIds.push('')
        while (laneB.workerIds.length <= b.slotIndex) laneB.workerIds.push('')
        const idA = laneA.workerIds[a.slotIndex] || ''
        const idB = laneB.workerIds[b.slotIndex] || ''
        laneA.workerIds[a.slotIndex] = idB
        laneB.workerIds[b.slotIndex] = idA

        const nameOf = (id: string) =>
          id ? data.workers.find((w) => w.id === id)?.fullName || id : '(ריק)'
        const labelOf = (laneId: string) =>
          data.lanes.find((l) => l.id === laneId)?.name || laneId

        void postAuditEvent(
          'manual_swap',
          `${d.date} · ${SHIFT_TYPE_LABELS[d.shiftType]} · ${nameOf(idA)} ↔ ${nameOf(idB)} (${labelOf(a.laneId)} ↔ ${labelOf(b.laneId)})`,
        )

        const trimTrailing = (row: (typeof padded)[number]) => {
          const lane = data.lanes.find((l) => l.id === row.laneId)
          const std = effectiveStaffingStandard(lane, d.staffingOverrides)
          while (
            row.workerIds.length > std &&
            !row.workerIds[row.workerIds.length - 1]
          ) {
            row.workerIds.pop()
          }
        }
        trimTrailing(laneA)
        trimTrailing(laneB)

        return withGateManagerSync(
          {
            ...d,
            assignments: padded,
          },
          data.lanes,
        )
      })
    },
    [data.lanes, data.workers],
  )

  const laneNoteAuditTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const laneNoteBaselineRef = useRef<Map<string, string>>(new Map())
  const updateLaneNotes = useCallback(
    (laneId: string, notes: string) => {
      setDraft((d) => {
        if (!d) return d
        const prevNote =
          d.assignments.find((a) => a.laneId === laneId)?.notes?.trim() || ''
        // Preserve internal/trailing newlines while typing (trim() would eat Enter).
        const normalized = notes.replace(/\r\n/g, '\n')
        const nextNote = normalized.trim() === '' ? '' : normalized
        const padded = padAssignments(d.assignments, data.lanes, d.activeLaneIds, d.staffingOverrides).map(
          (a) =>
            a.laneId === laneId
              ? { ...a, notes: nextNote ? nextNote : undefined }
              : a,
        )

        if (prevNote !== nextNote.trim()) {
          if (!laneNoteBaselineRef.current.has(laneId)) {
            laneNoteBaselineRef.current.set(laneId, prevNote)
          }
          const laneLabel =
            data.lanes.find((l) => l.id === laneId)?.name || laneId
          const date = d.date
          const shiftType = d.shiftType
          if (laneNoteAuditTimer.current) clearTimeout(laneNoteAuditTimer.current)
          laneNoteAuditTimer.current = setTimeout(() => {
            const baseline = laneNoteBaselineRef.current.get(laneId) ?? ''
            laneNoteBaselineRef.current.delete(laneId)
            if (baseline === nextNote.trim()) return
            let detail: string
            const shown = nextNote.trim()
            if (!baseline && shown) {
              detail = `${date} · ${SHIFT_TYPE_LABELS[shiftType]} · ${laneLabel}: נוספה הערה «${shown}»`
            } else if (baseline && !shown) {
              detail = `${date} · ${SHIFT_TYPE_LABELS[shiftType]} · ${laneLabel}: הוסרה הערה «${baseline}»`
            } else {
              detail = `${date} · ${SHIFT_TYPE_LABELS[shiftType]} · ${laneLabel}: «${baseline}» → «${shown}»`
            }
            void postAuditEvent('lane_note', detail)
          }, 1200)
        }

        return { ...d, assignments: padded }
      })
    },
    [data.lanes],
  )

  const replaceLeavingWorker = useCallback(
    (leavingId: string, replacementId: string) => {
      setDraft((d) => {
        if (!d || usesRounds(d)) return d
        const next = replaceLeavingWorkerSeat({
          leavingId,
          replacementId,
          assignments: d.assignments,
          presentWorkerIds: d.presentWorkerIds,
          gateManagerWorkerId: d.gateManagerWorkerId,
        })
        if (!next) return d
        const leavingName =
          data.workers.find((worker) => worker.id === leavingId)?.fullName || leavingId
        const nextName =
          data.workers.find((worker) => worker.id === replacementId)?.fullName ||
          replacementId
        const laneId = d.assignments.find((row) =>
          row.workerIds.includes(leavingId),
        )?.laneId
        const laneName = data.lanes.find((lane) => lane.id === laneId)?.name || laneId || ''
        void postAuditEvent(
          'manual_assign',
          `${d.date} · ${SHIFT_TYPE_LABELS[d.shiftType]} · החלפה באמצע משמרת · ${laneName}: ${leavingName} → ${nextName}`,
        )
        return withGateManagerSync(
          {
            ...d,
            assignments: next.assignments,
            presentWorkerIds: next.presentWorkerIds,
            gateManagerWorkerId: next.gateManagerWorkerId,
          },
          data.lanes,
        )
      })
    },
    [data.lanes, data.workers],
  )

  const addExtraWorkerToLane = useCallback(
    (laneId: string, workerId: string) => {
      setDraft((d) => {
        if (!d) return d
        const padded = padAssignments(d.assignments, data.lanes, d.activeLaneIds, d.staffingOverrides).map(
          (a) => ({
            ...a,
            workerIds: a.workerIds.filter((id) => id !== workerId),
          }),
        )
        const target = padded.find((a) => a.laneId === laneId)
        if (!target) return d
        target.workerIds.push(workerId)

        return {
          ...d,
          assignments: padded,
          unassignedWorkerIds: computeUnassignedWorkerIds(
            d.presentWorkerIds,
            padded,
            d.gateManagerWorkerId,
          ),
        }
      })
    },
    [data.lanes],
  )

  const addSlotToLane = useCallback(
    (laneId: string) => {
      setDraft((d) => {
        if (!d) return d
        const padded = padAssignments(d.assignments, data.lanes, d.activeLaneIds, d.staffingOverrides).map(
          (a) => ({ ...a, workerIds: [...a.workerIds] }),
        )
        const target = padded.find((a) => a.laneId === laneId)
        if (!target) return d
        target.workerIds.push('')
        return { ...d, assignments: padded }
      })
    },
    [data.lanes],
  )

  const removeWorkerFromShift = useCallback(
    (workerId: string) => {
      setDraft((d) => {
        if (!d) return d
        const presentWorkerIds = d.presentWorkerIds.filter((id) => id !== workerId)
        const gateManagerWorkerId =
          d.gateManagerWorkerId === workerId ? undefined : d.gateManagerWorkerId
        const assignments = padAssignments(d.assignments, data.lanes, d.activeLaneIds, d.staffingOverrides).map(
          (a) => {
            const workerIds = a.workerIds.map((id) => (id === workerId ? '' : id))
            const lane = data.lanes.find((l) => l.id === a.laneId)
            const std = effectiveStaffingStandard(lane, d.staffingOverrides)
            while (workerIds.length > std && !workerIds[workerIds.length - 1]) {
              workerIds.pop()
            }
            return { ...a, workerIds }
          },
        )
        return withGateManagerSync(
          {
            ...d,
            presentWorkerIds,
            gateManagerWorkerId,
            assignments,
            rounds: usesRounds(d)
              ? clearWorkerFromRounds(d.rounds ?? [], workerId)
              : [],
          },
          data.lanes,
        )
      })
    },
    [data.lanes],
  )

  const applyHealPlan = useCallback(
    (plan: SelfHealPlan, persist: boolean) => {
      const current = draft
      if (!current) return
      const eventId = uuid()
      const event: ShiftChangeEvent | null = persist
        ? {
            id: eventId,
            at: new Date().toISOString(),
            atMinutes: plan.atMinutes,
            removedWorkerId: plan.removedWorkerId,
            summary: plan.summary,
            lines: plan.lines,
            moves: plan.moves,
          }
        : null
      const next: ShiftDraft = {
        ...current,
        presentWorkerIds: plan.presentWorkerIds,
        gateManagerWorkerId: plan.gateManagerWorkerId,
        assignments: plan.assignments,
        rounds: plan.rounds,
        frozenLaneIds: plan.frozenLaneIds,
        seatSegments: plan.seatSegments ?? current.seatSegments,
        seatSpan: plan.seatSpan ?? current.seatSpan,
        isSelfHealed: persist ? true : current.isSelfHealed,
        shiftEvents: event ? [...(current.shiftEvents ?? []), event] : current.shiftEvents,
        healHighlights: plan.highlights,
        explanations: [
          ...(current.explanations ?? []),
          ...plan.lines.map((line) => ({
            laneId: plan.moves[0]?.toLaneId || plan.highlights[0]?.laneId || current.activeLaneIds[0] || '',
            workerId: plan.moves[0]?.workerId || plan.removedWorkerId,
            reasons: [line],
          })),
        ].filter((item) => item.laneId && item.reasons.length),
      }
      setDraft(next)
      setHealPlan(null)
      if (!dataRef.current.history.some((shift) => shift.id === current.id)) return
      void (async () => {
        try {
          const saved = await runWithFreshRevision((revision) =>
            selfHealShiftRemote(
              current.id,
              {
                eventId,
                removedWorkerId: plan.removedWorkerId,
                atMinutes: plan.atMinutes,
                summary: plan.summary,
                lines: plan.lines,
                moves: plan.moves,
                assignments: next.assignments,
                rounds: next.rounds,
                presentWorkerIds: next.presentWorkerIds,
                gateManagerWorkerId: next.gateManagerWorkerId,
                seatSegments: next.seatSegments,
                seatSpan: next.seatSpan,
                frozenLaneIds: next.frozenLaneIds,
                explanations: next.explanations,
              },
              revision,
            ),
          )
          skipNextSync.current = true
          dataRef.current = saved
          setData(saved)
          saveAppDataCache(saved)
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) {
            setError(error instanceof Error ? error.message : 'שמירת השיקום נכשלה')
          }
        }
      })()
    },
    [draft, runWithFreshRevision],
  )

  const beginRemoval = useCallback(
    (workerId: string) => {
      const current = draft
      if (!current || current.signOff?.signedAt) return
      if (!workerIsSeated(current, workerId)) {
        removeWorkerFromShift(workerId)
        return
      }
      setHealing(true)
      const toastId = toast.loading('מחשב שיבוץ חליפי אופטימלי...')
      window.setTimeout(() => {
        try {
          const inspectors = user?.module === 'inspectors'
          const bounds = selectorRoundBounds(
            current.shiftType,
            data.shiftModels,
            Boolean(inspectors),
          )
          const start = bounds?.start ?? 6 * 60
          const end = bounds?.end ?? start + 8 * 60
          const plan = planRemoval({
            draft: {
              ...current,
              assignments: current.assignments ?? [],
              rounds: current.rounds ?? [],
            },
            workerId,
            workers: data.workers,
            lanes: data.lanes,
            history: data.history,
            startMinutes: start,
            endMinutes: end,
            atMinutes: removalMinute({
              shiftDate: current.date,
              startMinutes: start,
              endMinutes: end,
            }),
            rounds: usesRounds(current),
            roundMinutes:
              roundMinutesRef.current[inspectors ? 'inspectors' : 'selectors'],
            bounds,
          })
          setHealPlan(plan)
        } catch (error) {
          notify.error(
            'לא הצלחתי לחשב מחליף',
            error instanceof Error ? error.message : 'האדם הוסר מהלוח. אפשר לערוך ידנית.',
          )
          removeWorkerFromShift(workerId)
        } finally {
          setHealing(false)
          toast.dismiss(toastId)
        }
      }, 40)
    },
    [data.history, data.lanes, data.shiftModels, data.workers, draft, removeWorkerFromShift, user?.module],
  )
  beginRemovalRef.current = beginRemoval

  const confirmSelfHeal = useCallback(async () => {
    if (!healPlan) return
    applyHealPlan(healPlan.healed, true)
  }, [applyHealPlan, healPlan])

  const editRemovalManually = useCallback(() => {
    if (!healPlan) return
    applyHealPlan(healPlan.manual, false)
  }, [applyHealPlan, healPlan])

  const dismissSelfHeal = useCallback(() => {
    setHealPlan(null)
  }, [])

  const removeLaneFromShift = useCallback(
    (laneId: string) => {
      setDraft((d) => {
        if (!d) return d
        const lane = data.lanes.find((item) => item.id === laneId)
        if (!lane || isGateManagerLane(lane)) return d
        const staffingOverrides = { ...d.staffingOverrides }
        delete staffingOverrides[laneId]
        return withGateManagerSync(
          {
            ...d,
            activeLaneIds: d.activeLaneIds.filter((id) => id !== laneId),
            assignments: d.assignments.filter((row) => row.laneId !== laneId),
            staffingOverrides,
            explanations: (d.explanations ?? []).filter((item) => item.laneId !== laneId),
            rounds: (d.rounds ?? []).map((round) => ({
              ...round,
              assignments: round.assignments.filter((row) => row.laneId !== laneId),
            })),
          },
          data.lanes,
        )
      })
    },
    [data.lanes],
  )

  const saveCurrentShift = useCallback(async () => {
    if (!draft) return
    if (draft.signOff?.signedAt) {
      const message = 'המשמרת נסגרה וננעלה. לא ניתן לערוך אותה.'
      setError(message)
      throw new Error(message)
    }
    const synced = withGateManagerSync(draft, dataRef.current.lanes)
    if (
      synced.activeLaneIds !== draft.activeLaneIds ||
      synced.assignments !== draft.assignments ||
      synced.unassignedWorkerIds !== draft.unassignedWorkerIds
    ) {
      setDraft(synced)
    }
    const slotConflict = findShiftForSlot(
      dataRef.current.history,
      synced.date,
      synced.shiftType,
      synced.id,
      synced.audience,
    )
    if (slotConflict) {
      const message = shiftSlotConflictMessage(synced.date, synced.shiftType)
      setError(message)
      throw new Error(message)
    }
    const unassigned = synced.unassignedWorkerIds
    if (!usesRounds(synced) && unassigned.length > 0) {
      const message = `לא ניתן לשמור — נשארו ${unassigned.length} אנשים שלא שובצו לעמדה`
      setError(message)
      throw new Error(message)
    }
    const schedule = toSchedule(synced)
    setSyncing(true)
    setError(null)
    try {
      const saved = await runWithFreshRevision((revision) =>
        saveShiftRemote(schedule, revision),
      )
      skipNextSync.current = true
      dataRef.current = saved
      setData(saved)
      saveAppDataCache(saved)
      draftBaselineRef.current = snapshotDraft(synced)
      setDraftDirty(false)
      clearDraftStorage()
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        setError(e instanceof Error ? e.message : 'שמירת השיבוץ נכשלה')
      }
      throw e
    } finally {
      setSyncing(false)
    }
  }, [draft, toSchedule, runWithFreshRevision])

  const signCurrentShift = useCallback(
    async (signature: string) => {
      if (!draft || draft.signOff?.signedAt) return
      const synced = withGateManagerSync(draft, dataRef.current.lanes)
      const slotConflict = findShiftForSlot(
        dataRef.current.history,
        synced.date,
        synced.shiftType,
        synced.id,
        synced.audience,
      )
      if (slotConflict) {
        const message = shiftSlotConflictMessage(synced.date, synced.shiftType)
        setError(message)
        throw new Error(message)
      }
      if (!usesRounds(synced) && synced.unassignedWorkerIds.length > 0) {
        const message = `לא ניתן לסגור — נשארו ${synced.unassignedWorkerIds.length} אנשים שלא שובצו לעמדה`
        setError(message)
        throw new Error(message)
      }
      const pending: ShiftDraft = {
        ...synced,
        signOff: {
          signedAt: new Date().toISOString(),
          signerName: user?.fullName?.trim() || signature.trim(),
          signerId: user?.id ?? '',
          signature: signature.trim(),
        },
      }
      const schedule = toSchedule(pending)
      setSyncing(true)
      setError(null)
      try {
        const saved = await runWithFreshRevision((revision) =>
          saveShiftRemote(schedule, revision),
        )
        const stored = saved.history.find((shift) => shift.id === pending.id)
        const closed: ShiftDraft = {
          ...pending,
          signOff: normalizeSignOff(stored?.signOff) ?? pending.signOff,
        }
        skipNextSync.current = true
        dataRef.current = saved
        setData(saved)
        saveAppDataCache(saved)
        draftBaselineRef.current = snapshotDraft(closed)
        setDraft(closed)
        setDraftDirty(false)
        clearDraftStorage()
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) {
          setError(e instanceof Error ? e.message : 'סגירת המשמרת נכשלה')
        }
        throw e
      } finally {
        setSyncing(false)
      }
    },
    [draft, toSchedule, runWithFreshRevision, user?.fullName, user?.id],
  )

  const loadShiftFromHistory = useCallback(
    (id: string) => {
      navigate(`/history/${encodeURIComponent(id)}`)
    },
    [navigate],
  )

  const deleteHistoryItem = useCallback(async (id: string) => {
    setSyncing(true)
    try {
      const saved = await runWithFreshRevision(async (revision) => {
        const next = await deleteShiftRemote(id, revision)
        if (!next.history.some((shift) => shift.id === id)) return next
        return next
      })
      skipNextSync.current = true
      dataRef.current = saved
      setData(saved)
      saveAppDataCache(saved)
      setError(null)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        setError(e instanceof Error ? e.message : 'מחיקה נכשלה')
      }
    } finally {
      setSyncing(false)
    }
  }, [runWithFreshRevision])

  const addWorker = useCallback(
    (w: Omit<Worker, 'id'>) => {
      patchData((prev) => ({
        ...prev,
        workers: [
          ...prev.workers,
          {
            ...w,
            id: uuid(),
            isManager: Boolean(w.isManager),
            isInspector: Boolean(w.isInspector) || !Boolean(w.isManager),
          },
        ],
      }))
    },
    [patchData],
  )

  const updateWorker = useCallback(
    (w: Worker) => {
      patchData((prev) => ({
        ...prev,
        workers: prev.workers.map((x) => (x.id === w.id ? w : x)),
      }))
    },
    [patchData],
  )

  const deleteWorker = useCallback(
    (id: string) => {
      patchData((prev) => ({
        ...prev,
        workers: prev.workers.filter((w) => w.id !== id),
      }))
    },
    [patchData],
  )

  const addLane = useCallback(
    (l: Omit<Lane, 'id'>) => {
      if (isGateManagerLane(l)) return
      patchData((prev) => ({
        ...prev,
        lanes: [
          ...prev.lanes,
          {
            ...l,
            id: uuid(),
            staffingStandard: clampStaffingStandard(l.staffingStandard),
          },
        ],
      }))
    },
    [patchData],
  )

  const updateLane = useCallback(
    (l: Lane) => {
      patchData((prev) => {
        const existing = prev.lanes.find((x) => x.id === l.id)
        if (!existing) return prev
        if (isGateManagerLane(existing)) return prev
        if (isGateManagerLane(l)) return prev
        return {
          ...prev,
          lanes: prev.lanes.map((x) =>
            x.id === l.id
              ? { ...l, staffingStandard: clampStaffingStandard(l.staffingStandard) }
              : x,
          ),
        }
      })
    },
    [patchData],
  )

  const deleteLane = useCallback(
    (id: string) => {
      patchData((prev) => {
        const target = prev.lanes.find((l) => l.id === id)
        if (target && isGateManagerLane(target)) return prev
        return {
          ...prev,
          lanes: prev.lanes.filter((l) => l.id !== id),
        }
      })
    },
    [patchData],
  )

  const addCertification = useCallback(
    (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      patchData((prev) => {
        if (prev.certificationsCatalog.includes(trimmed)) return prev
        return {
          ...prev,
          certificationsCatalog: [...prev.certificationsCatalog, trimmed],
        }
      })
    },
    [patchData],
  )

  const removeCertification = useCallback(
    (name: string) => {
      patchData((prev) => ({
        ...prev,
        certificationsCatalog: prev.certificationsCatalog.filter((c) => c !== name),
      }))
    },
    [patchData],
  )

  const upsertBriefingSection = useCallback(
    (
      section: Omit<BriefingSection, 'id' | 'updatedAt' | 'order'> & {
        id?: string
        order?: number
      },
    ) => {
      const title = section.title.trim()
      const body = section.body.trim()
      if (!title) return
      const now = new Date().toISOString()
      const by = userRef.current?.fullName
      patchData((prev) => {
        const list = normalizeBriefingSections(prev.briefingSections)
        if (section.id) {
          return {
            ...prev,
            briefingSections: list.map((s) =>
              s.id === section.id
                ? {
                    ...s,
                    title,
                    body,
                    updatedAt: now,
                    ...(by ? { updatedBy: by } : {}),
                  }
                : s,
            ),
          }
        }
        const next: BriefingSection = {
          id: uuid(),
          title,
          body,
          order:
            section.order ??
            (list.length === 0
              ? 0
              : Math.max(...list.map((s) => s.order)) + 1),
          updatedAt: now,
          ...(by ? { updatedBy: by } : {}),
        }
        return {
          ...prev,
          briefingSections: normalizeBriefingSections([...list, next]),
        }
      })
    },
    [patchData],
  )

  const deleteBriefingSection = useCallback(
    (id: string) => {
      patchData((prev) => ({
        ...prev,
        briefingSections: reindexOrders(
          normalizeBriefingSections(prev.briefingSections).filter(
            (s) => s.id !== id,
          ),
        ),
      }))
    },
    [patchData],
  )

  const reorderBriefingSections = useCallback(
    (orderedIds: string[]) => {
      patchData((prev) => {
        const map = new Map(
          normalizeBriefingSections(prev.briefingSections).map((s) => [
            s.id,
            s,
          ]),
        )
        const next = orderedIds
          .map((id) => map.get(id))
          .filter((s): s is BriefingSection => s != null)
        for (const s of map.values()) {
          if (!orderedIds.includes(s.id)) next.push(s)
        }
        return { ...prev, briefingSections: reindexOrders(next) }
      })
    },
    [patchData],
  )

  const upsertInspectorQuestion = useCallback(
    (
      question: Omit<InspectorQuestion, 'id' | 'updatedAt' | 'order'> & {
        id?: string
        order?: number
      },
    ) => {
      const prompt = question.prompt.trim()
      const answer = question.answer.trim()
      if (!prompt || !answer) return
      const now = new Date().toISOString()
      const by = userRef.current?.fullName
      patchData((prev) => {
        const list = normalizeQuestionBank(prev.questionBank)
        if (question.id) {
          return {
            ...prev,
            questionBank: list.map((q) =>
              q.id === question.id
                ? {
                    ...q,
                    prompt,
                    answer,
                    updatedAt: now,
                    ...(by ? { updatedBy: by } : {}),
                  }
                : q,
            ),
          }
        }
        const next: InspectorQuestion = {
          id: uuid(),
          prompt,
          answer,
          order:
            question.order ??
            (list.length === 0
              ? 0
              : Math.max(...list.map((q) => q.order)) + 1),
          updatedAt: now,
          ...(by ? { updatedBy: by } : {}),
        }
        return {
          ...prev,
          questionBank: normalizeQuestionBank([...list, next]),
        }
      })
    },
    [patchData],
  )

  const deleteInspectorQuestion = useCallback(
    (id: string) => {
      patchData((prev) => ({
        ...prev,
        questionBank: reindexOrders(
          normalizeQuestionBank(prev.questionBank).filter((q) => q.id !== id),
        ),
      }))
    },
    [patchData],
  )

  const reorderInspectorQuestions = useCallback(
    (orderedIds: string[]) => {
      patchData((prev) => {
        const map = new Map(
          normalizeQuestionBank(prev.questionBank).map((q) => [q.id, q]),
        )
        const next = orderedIds
          .map((id) => map.get(id))
          .filter((q): q is InspectorQuestion => q != null)
        for (const q of map.values()) {
          if (!orderedIds.includes(q.id)) next.push(q)
        }
        return { ...prev, questionBank: reindexOrders(next) }
      })
    },
    [patchData],
  )

  const saveShiftModels = useCallback(
    (models: ShiftModel[]) => {
      patchData((prev) => ({
        ...prev,
        shiftModels: models.map((model, order) => ({ ...model, order })),
      }))
    },
    [patchData],
  )

  const upsertCustomsBroker = useCallback(
    (broker: { id?: string; name: string }) => {
      const name = broker.name.trim()
      if (!name) return
      patchData((prev) => {
        const list = normalizeCustomsBrokers(prev.customsBrokers)
        if (broker.id) {
          return {
            ...prev,
            customsBrokers: normalizeCustomsBrokers(
              list.map((b) => (b.id === broker.id ? { ...b, name } : b)),
              { seedIfEmpty: false },
            ),
          }
        }
        const next: CustomsBroker = { id: uuid(), name, contacts: [] }
        return {
          ...prev,
          customsBrokers: normalizeCustomsBrokers([...list, next], {
            seedIfEmpty: false,
          }),
        }
      })
    },
    [patchData],
  )

  const deleteCustomsBroker = useCallback(
    (id: string) => {
      patchData((prev) => ({
        ...prev,
        customsBrokers: normalizeCustomsBrokers(
          (prev.customsBrokers ?? []).filter((b) => b.id !== id),
          { seedIfEmpty: false },
        ),
      }))
    },
    [patchData],
  )

  const upsertCustomsBrokerContact = useCallback(
    (brokerId: string, contact: { id?: string; name: string; phone: string }) => {
      const digits = normalizeBrokerPhoneDigits(contact.phone)
      if (!digits) return
      const name = contact.name.trim()
      const phone = formatBrokerPhone(digits)
      patchData((prev) => {
        const list = normalizeCustomsBrokers(prev.customsBrokers)
        return {
          ...prev,
          customsBrokers: normalizeCustomsBrokers(
            list.map((b) => {
              if (b.id !== brokerId) return b
              if (contact.id) {
                return {
                  ...b,
                  contacts: b.contacts.map((c) =>
                    c.id === contact.id
                      ? { ...c, name, phone, phoneDigits: digits }
                      : c,
                  ),
                }
              }
              if (b.contacts.some((c) => c.phoneDigits === digits)) {
                return {
                  ...b,
                  contacts: b.contacts.map((c) =>
                    c.phoneDigits === digits
                      ? { ...c, name: name || c.name, phone, phoneDigits: digits }
                      : c,
                  ),
                }
              }
              const next: CustomsBrokerContact = {
                id: uuid(),
                name,
                phone,
                phoneDigits: digits,
              }
              return { ...b, contacts: [...b.contacts, next] }
            }),
            { seedIfEmpty: false },
          ),
        }
      })
    },
    [patchData],
  )

  const deleteCustomsBrokerContact = useCallback(
    (brokerId: string, contactId: string) => {
      patchData((prev) => ({
        ...prev,
        customsBrokers: normalizeCustomsBrokers(
          (prev.customsBrokers ?? []).map((b) =>
            b.id === brokerId
              ? { ...b, contacts: b.contacts.filter((c) => c.id !== contactId) }
              : b,
          ),
          { seedIfEmpty: false },
        ),
      }))
    },
    [patchData],
  )

  const resetToSeed = useCallback(async () => {
    setSyncing(true)
    try {
      const seeded = await runWithFreshRevision((revision) =>
        seedAppDataRemote(revision),
      )
      skipNextSync.current = true
      dataRef.current = seeded
      setData(seeded)
      saveAppDataCache(seeded)
      draftBaselineRef.current = null
      setDraftDirty(false)
      setDraft(null)
      clearDraftStorage()
      setShiftStepState('lanes')
      setView('home')
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) handleAuthFailure()
      if (e instanceof ApiError && e.status === 409 && e.current) {
        applyRemoteData(e.current)
      }
      setError(e instanceof Error ? e.message : 'איפוס נכשל')
      throw e
    } finally {
      setSyncing(false)
    }
  }, [runWithFreshRevision, handleAuthFailure, applyRemoteData, setView])

  const value = useMemo<AppContextValue>(
    () => ({
      data,
      loading,
      refreshing,
      syncing,
      error,
      user,
      module: user?.module === 'inspectors' ? 'inspectors' : 'selectors',
      setModule,
      assignmentModes,
      saveAssignmentModes,
      roundMinutes,
      saveRoundMinutes,
      staggerRounds: staggerRoundsSetting,
      saveStaggerRounds,
      orgProfile,
      saveOrgProfile,
      login,
      checkLogin,
      requestPasswordReset,
      resendManagerTempPassword,
      logout,
      view,
      setView,
      shiftStep,
      setShiftStep,
      draft,
      draftDirty,
      restoreDraftSnapshot,
      startShift,
      discardDraft,
      updateDraftMeta,
      toggleLane,
      applyLaneSelection,
      applyPresentSelection,
      setLaneStaffingStandard,
      toggleWorker,
      setWorkerWindow,
      setWindowAdjustment,
      setEarlyLeave,
      recordShiftDrop,
      undoShiftDrop,
      addBoardLane,
      setGateManager,
      setAllActiveLanes,
      setAllActiveWorkers,
      runAutoAssign,
      previewBoardOptions,
      applyBoardOption,
      commitSelectorBoard,
      startManualAssign,
      updateAssignment,
      updateSelectorCell,
      swapAssignments,
      removeWorkerFromShift,
      beginRemoval,
      confirmSelfHeal,
      editRemovalManually,
      dismissSelfHeal,
      healing,
      healPlan,
      replaceLeavingWorker,
      removeLaneFromShift,
      updateLaneNotes,
      addExtraWorkerToLane,
      addSlotToLane,
      saveCurrentShift,
      signCurrentShift,
      loadShiftFromHistory,
      deleteHistoryItem,
      addWorker,
      updateWorker,
      deleteWorker,
      addLane,
      updateLane,
      deleteLane,
      addCertification,
      removeCertification,
      upsertBriefingSection,
      deleteBriefingSection,
      reorderBriefingSections,
      upsertInspectorQuestion,
      deleteInspectorQuestion,
      reorderInspectorQuestions,
      saveShiftModels,
      upsertCustomsBroker,
      deleteCustomsBroker,
      upsertCustomsBrokerContact,
      deleteCustomsBrokerContact,
      resetToSeed,
      refreshFromServer,
    }),
    [
      data,
      loading,
      refreshing,
      syncing,
      error,
      user,
      assignmentModes,
      saveAssignmentModes,
      roundMinutes,
      saveRoundMinutes,
      staggerRoundsSetting,
      saveStaggerRounds,
      orgProfile,
      saveOrgProfile,
      setModule,
      login,
      checkLogin,
      requestPasswordReset,
      resendManagerTempPassword,
      logout,
      view,
      setView,
      shiftStep,
      setShiftStep,
      draft,
      draftDirty,
      restoreDraftSnapshot,
      startShift,
      discardDraft,
      updateDraftMeta,
      toggleLane,
      applyLaneSelection,
      applyPresentSelection,
      setLaneStaffingStandard,
      toggleWorker,
      setWorkerWindow,
      setWindowAdjustment,
      setEarlyLeave,
      recordShiftDrop,
      undoShiftDrop,
      addBoardLane,
      setGateManager,
      setAllActiveLanes,
      setAllActiveWorkers,
      runAutoAssign,
      previewBoardOptions,
      applyBoardOption,
      commitSelectorBoard,
      startManualAssign,
      updateAssignment,
      updateSelectorCell,
      swapAssignments,
      removeWorkerFromShift,
      beginRemoval,
      confirmSelfHeal,
      editRemovalManually,
      dismissSelfHeal,
      healing,
      healPlan,
      replaceLeavingWorker,
      removeLaneFromShift,
      updateLaneNotes,
      addExtraWorkerToLane,
      addSlotToLane,
      saveCurrentShift,
      signCurrentShift,
      loadShiftFromHistory,
      deleteHistoryItem,
      addWorker,
      updateWorker,
      deleteWorker,
      addLane,
      updateLane,
      deleteLane,
      addCertification,
      removeCertification,
      upsertBriefingSection,
      deleteBriefingSection,
      reorderBriefingSections,
      upsertInspectorQuestion,
      deleteInspectorQuestion,
      reorderInspectorQuestions,
      saveShiftModels,
      upsertCustomsBroker,
      deleteCustomsBroker,
      upsertCustomsBrokerContact,
      deleteCustomsBrokerContact,
      resetToSeed,
      refreshFromServer,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
