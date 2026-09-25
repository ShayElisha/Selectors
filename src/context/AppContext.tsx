import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { type PlacementExplanation } from '../algorithm'
import {
  ApiError,
  checkLoginRemote,
  deleteShiftRemote,
  fetchAppData,
  loginRemote,
  postAuditEvent,
  requestPasswordResetRemote,
  resendManagerTempPasswordRemote,
  saveAppDataRemote,
  saveShiftRemote,
  seedAppDataRemote,
} from '../api'
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
  type SessionUser,
} from '../auth'
import {
  findShiftForSlot,
  getCurrentShiftContext,
  SHIFT_TYPE_LABELS,
  shiftSlotConflictMessage,
} from '../constants'
import { pathForView, viewFromPath } from '../routes'
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
  syncGateManagerPlacement,
} from '../lib/gateManager'
import {
  normalizeBriefingSections,
  normalizeQuestionBank,
  reindexOrders,
} from '../lib/briefings'
import {
  normalizeCustomsBrokers,
  normalizeBrokerPhoneDigits,
  formatBrokerPhone,
} from '../lib/customsBrokers'
import {
  assignSelectorRounds,
  clearWorkerFromRounds,
  emptySelectorRounds,
  setSelectorCell,
  unassignedSelectorIds,
} from '../lib/selectorRounds'
import type {
  AppData,
  BriefingSection,
  CustomsBroker,
  CustomsBrokerContact,
  InspectorQuestion,
  Lane,
  LaneAssignment,
  SelectorRound,
  ShiftAudience,
  ShiftSchedule,
  ShiftType,
  StaffingStandard,
  View,
  Worker,
} from '../types'

function normalizeWorkerRoles(w: Worker): Worker {
  const isManager = Boolean(w.isManager) || isDefaultManager(w)
  const hasInspector = Object.prototype.hasOwnProperty.call(w, 'isInspector')
  let isInspector = hasInspector ? Boolean(w.isInspector) : !isManager
  if (!isInspector && !isManager) isInspector = true
  return { ...w, isManager, isInspector }
}

function normalizeAppData(data: AppData): AppData {
  return {
    ...data,
    workers: data.workers.map(normalizeWorkerRoles),
    lanes: ensureGateManagerLane(data.lanes ?? [], () => uuid()),
    briefingSections: normalizeBriefingSections(data.briefingSections),
    questionBank: normalizeQuestionBank(data.questionBank),
    customsBrokers: normalizeCustomsBrokers(data.customsBrokers, {
      seedIfEmpty: true,
    }),
  }
}

export type ShiftStep = 'lanes' | 'attendance' | 'board'

export interface ShiftDraft {
  id: string
  date: string
  shiftType: ShiftType
  audience: ShiftAudience
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
  /** Per-shift תקן (1…5); falls back to lane catalog when absent */
  staffingOverrides: StaffingOverrides
}

interface AppContextValue {
  data: AppData
  loading: boolean
  /** Background refresh while showing cached data */
  refreshing: boolean
  syncing: boolean
  error: string | null
  user: SessionUser | null
  login: (
    phone: string,
    password: string,
    opts?: { newPassword?: string; newPasswordConfirm?: string },
  ) => Promise<'change_password' | void>
  /** Phone-only probe: which login UI to show next. */
  checkLogin: (
    phone: string,
  ) => Promise<'login' | 'change_password' | 'await_email'>
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
    opts?: { gateManagerWorkerId?: string | null },
  ) => void
  /** Set תקן for a lane in the current shift only (does not change the lane catalog). */
  setLaneStaffingStandard: (laneId: string, standard: StaffingStandard) => void
  toggleWorker: (workerId: string) => void
  /** Activate/deactivate מנהל שער for a manager (at most one per shift). */
  setGateManager: (workerId: string | null) => void
  setAllActiveLanes: (on: boolean) => void
  setAllActiveWorkers: (on: boolean) => void
  runAutoAssign: () => void
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
  updateLaneNotes: (laneId: string, notes: string) => void
  addExtraWorkerToLane: (laneId: string, workerId: string) => void
  addSlotToLane: (laneId: string) => void
  saveCurrentShift: () => Promise<void>
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
  revision: 0,
}

const AppContext = createContext<AppContextValue | null>(null)

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultShiftType(): ShiftType {
  return getCurrentShiftContext().shiftType
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
  if (d.audience === 'selector') {
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
      rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
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
    rounds: d.rounds ?? [],
    activeLaneIds: d.activeLaneIds,
    presentWorkerIds: d.presentWorkerIds,
    gateManagerWorkerId: d.gateManagerWorkerId ?? '',
    assignments: d.assignments.map((a) => ({
      laneId: a.laneId,
      workerIds: a.workerIds,
      notes: a.notes?.trim() ?? '',
    })),
    warnings: d.warnings,
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
    return cached ? normalizeAppData(cached) : null
  }, [])
  const [data, setData] = useState<AppData>(() => initialCache ?? emptyData)
  const [loading, setLoading] = useState(() => !initialCache)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(() => loadSession())
  const view = viewFromPath(location.pathname)
  const [shiftStep, setShiftStepState] = useState<ShiftStep>(() => restoreStep())
  const [draft, setDraft] = useState<ShiftDraft | null>(() => restoreDraft())
  /** Restored drafts were already persisted → treat as dirty until discarded/saved clean. */
  const [draftDirty, setDraftDirty] = useState(() => restoreDraft() != null)
  const draftBaselineRef = useRef<string | null>(null)

  const dataRef = useRef(data)
  dataRef.current = data
  const syncTimer = useRef<number | null>(null)
  const pendingSaveRef = useRef<AppData | null>(null)
  const persistInFlightRef = useRef(false)
  const skipNextSync = useRef(true)
  const userRef = useRef(user)
  userRef.current = user

  const adoptCleanDraft = useCallback((next: ShiftDraft) => {
    draftBaselineRef.current = snapshotDraft(next)
    setDraftDirty(false)
    setDraft(next)
  }, [])

  const applyRemoteData = useCallback((remote: AppData) => {
    const next = normalizeAppData(remote)
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
    if (persistInFlightRef.current) return
    persistInFlightRef.current = true
    setSyncing(true)
    let retries409 = 0
    const MAX_409_RETRIES = 3

    try {
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
            const server = normalizeAppData(e.current)
            // Keep local intent; adopt only the server's revision (own overlapping write).
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
            // Real conflict after retries — show server copy
            dataRef.current = server
            setData(server)
            saveAppDataCache(server)
            const msg = e.message
            setError(msg)
            throw e
          }
          const msg = e instanceof Error ? e.message : 'שגיאת שמירה לשרת'
          setError(msg)
          throw e
        }
      }
    } finally {
      persistInFlightRef.current = false
      setSyncing(false)
      // Something was queued while we were finishing
      if (pendingSaveRef.current) {
        void drainPersist().catch(() => undefined)
      }
    }
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

  /** Flush debounced saves before shift save / delete / reset. */
  const flushPersist = useCallback(async () => {
    if (syncTimer.current) {
      window.clearTimeout(syncTimer.current)
      syncTimer.current = null
    }
    await drainPersist()
  }, [drainPersist])

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
      const remote = await fetchAppData()
      applyRemoteData(remote)
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
    if (
      result.next !== 'login' &&
      result.next !== 'change_password' &&
      result.next !== 'await_email'
    ) {
      throw new Error('תגובת התחברות לא תקינה')
    }
    return result.next
  }, [])

  const login = useCallback(
    async (
      phone: string,
      password: string,
      opts?: { newPassword?: string; newPasswordConfirm?: string },
    ) => {
      const session = await loginRemote(phone, password, opts)
      if ('next' in session && session.next === 'change_password') {
        return 'change_password'
      }
      if (!('token' in session) || !session.token) {
        throw new Error('לא התקבל טוקן התחברות')
      }
      saveSession(session)
      setUser(session)
      navigate('/', { replace: true })
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
    clearSession()
    clearAppDataCache()
    clearDraftStorage()
    setUser(null)
    draftBaselineRef.current = null
    setDraftDirty(false)
    setDraft(null)
    setData(emptyData)
    navigate('/login', { replace: true })
  }, [navigate])

  useEffect(() => {
    if (!user?.token) {
      setLoading(false)
      setRefreshing(false)
      return
    }
    void refreshFromServer()
  }, [user?.token, refreshFromServer])

  // Redirect unauthenticated users away from app routes
  useEffect(() => {
    const path = location.pathname.replace(/\/+$/, '') || '/'
    const isPublic = path === '/login' || path === '/privacy'
    if (!user && !isPublic) {
      navigate('/login', { replace: true })
    }
    if (user && path === '/login') {
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
            item.audience === 'selector' && Array.isArray(item.rounds)
              ? item.rounds
              : [],
          warnings: [],
          unassignedWorkerIds: [],
          explanations: [],
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
      assignments:
        d.audience === 'selector' ? [] : stripEmpty(d.assignments),
      ...(d.audience === 'selector'
        ? { audience: 'selector' as const, rounds: d.rounds ?? [] }
        : {}),
      ...(Object.keys(overrides).length > 0
        ? { staffingOverrides: overrides }
        : {}),
      createdAt: now,
      updatedAt: now,
    }
  }, [])

  const startShift = useCallback((audience: ShiftAudience = 'inspector') => {
    const date = todayISO()
    let shiftType = defaultShiftType()
    // Prefer a free slot for today so work can start immediately, but never
    // refuse to open — user can always pick another date/type on the shift page.
    if (findShiftForSlot(data.history, date, shiftType, undefined, audience)) {
      const freeType = (
        ['morning', 'afternoon', 'night'] as const
      ).find((t) => !findShiftForSlot(data.history, date, t, undefined, audience))
      if (freeType) shiftType = freeType
    }

    adoptCleanDraft({
      id: uuid(),
      date,
      shiftType,
      audience,
      activeLaneIds: [],
      presentWorkerIds: [],
      assignments: [],
      rounds: [],
      warnings: [],
      unassignedWorkerIds: [],
      explanations: [],
      staffingOverrides: {},
    })
    setShiftStep('lanes')
    setView('shift')
  }, [adoptCleanDraft, data.history, setShiftStep, setView])

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
        // Allow selecting a conflicting slot so the UI can show an inline notice
        // with a link to the existing shift; save/create still block duplicates.
        return { ...d, ...patch }
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
    (workerIds: string[], opts?: { gateManagerWorkerId?: string | null }) => {
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
    setDraft((d) => {
      if (!d) return d
      const has = d.presentWorkerIds.includes(workerId)
      if (!has) {
        const next = {
          ...d,
          presentWorkerIds: [...d.presentWorkerIds, workerId],
        }
        if (d.audience === 'selector') {
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
          rounds:
            d.audience === 'selector'
              ? clearWorkerFromRounds(d.rounds ?? [], workerId)
              : d.rounds,
        },
        data.lanes,
      )
    })
  }, [data.lanes])

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
      if (!d || d.audience === 'selector') return d
      const present = data.workers.filter(
        (w) => d.presentWorkerIds.includes(w.id) && w.isInspector,
      )
      const result = assignSelectorRounds({
        shiftType: d.shiftType,
        lanes: data.lanes,
        activeLaneIds: d.activeLaneIds,
        workers: present,
        overrides: d.staffingOverrides,
      })
      return withGateManagerSync(
        {
          ...d,
          audience: 'selector',
          assignments: [],
          rounds: result.rounds,
          warnings: result.warnings,
          explanations: [],
        },
        data.lanes,
      )
    })
  }, [data.lanes, data.workers])

  const runAutoAssign = useCallback(() => {
    setDraft((d) => {
      if (!d) return d
      const present = data.workers.filter(
        (w) => d.presentWorkerIds.includes(w.id) && w.isInspector,
      )
      const result = assignSelectorRounds({
        shiftType: d.shiftType,
        lanes: data.lanes,
        activeLaneIds: d.activeLaneIds,
        workers: present,
        overrides: d.staffingOverrides,
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
        `${d.date} · ${SHIFT_TYPE_LABELS[d.shiftType]} · סלקטורים · ${result.rounds.length} סבבים · ${filled} שיבוצים${
          result.warnings[0] ? ` · ${result.warnings[0]}` : ''
        }`,
      )
      return withGateManagerSync(
        {
          ...d,
          audience: 'selector',
          assignments: [],
          rounds: result.rounds,
          warnings: result.warnings,
          explanations: [],
        },
        data.lanes,
      )
    })
    setShiftStep('board')
  }, [data.lanes, data.workers])

  const startManualAssign = useCallback(() => {
    setDraft((d) => {
      if (!d) return d
      if (d.audience === 'selector') {
        void postAuditEvent(
          'manual_assign',
          `${d.date} · ${SHIFT_TYPE_LABELS[d.shiftType]} · סלקטורים · טבלת סבבים ריקה · ${d.activeLaneIds.length} נתיבים · ${d.presentWorkerIds.length} נוכחים`,
        )
        return withGateManagerSync(
          {
            ...d,
            assignments: [],
            rounds: emptySelectorRounds(
              d.shiftType,
              data.lanes,
              d.activeLaneIds,
              d.staffingOverrides,
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
    [data.lanes],
  )

  const updateSelectorCell = useCallback(
    (
      roundIndex: number,
      laneId: string,
      slotIndex: number,
      workerId: string | null,
    ) => {
      setDraft((d) => {
        if (!d || d.audience !== 'selector') return d
        const rounds = setSelectorCell(
          d.rounds ?? [],
          roundIndex,
          laneId,
          slotIndex,
          workerId,
        )
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
    [data.lanes],
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
            rounds:
              d.audience === 'selector'
                ? clearWorkerFromRounds(d.rounds ?? [], workerId)
                : d.rounds,
          },
          data.lanes,
        )
      })
    },
    [data.lanes],
  )

  const saveCurrentShift = useCallback(async () => {
    if (!draft) return
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
    if (synced.audience !== 'selector' && unassigned.length > 0) {
      const message = `לא ניתן לשמור — נשארו ${unassigned.length} בודקים שלא שובצו לעמדה`
      setError(message)
      throw new Error(message)
    }
    const schedule = toSchedule(synced)
    setSyncing(true)
    setError(null)
    try {
      // Finish any pending worker/lane saves so revision is current
      await flushPersist()
      const saved = await saveShiftRemote(
        schedule,
        dataRef.current.revision ?? 0,
      )
      skipNextSync.current = true
      dataRef.current = saved
      setData(saved)
      saveAppDataCache(saved)
      draftBaselineRef.current = snapshotDraft(synced)
      setDraftDirty(false)
      clearDraftStorage()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) handleAuthFailure()
      if (e instanceof ApiError && e.status === 409 && e.current) {
        // One automatic retry with fresh revision (own race with background persist)
        try {
          const server = applyRemoteData(e.current)
          const saved = await saveShiftRemote(schedule, server.revision ?? 0)
          skipNextSync.current = true
          dataRef.current = saved
          setData(saved)
          saveAppDataCache(saved)
          draftBaselineRef.current = snapshotDraft(draft)
          setDraftDirty(false)
          clearDraftStorage()
          setError(null)
          return
        } catch (e2) {
          if (e2 instanceof ApiError && e2.status === 409 && e2.current) {
            applyRemoteData(e2.current)
          }
          setError(e2 instanceof Error ? e2.message : 'שמירת השיבוץ נכשלה')
          throw e2
        }
      }
      setError(e instanceof Error ? e.message : 'שמירת השיבוץ נכשלה')
      throw e
    } finally {
      setSyncing(false)
    }
  }, [draft, toSchedule, flushPersist, handleAuthFailure, applyRemoteData])

  const loadShiftFromHistory = useCallback(
    (id: string) => {
      navigate(`/history/${encodeURIComponent(id)}`)
    },
    [navigate],
  )

  const deleteHistoryItem = useCallback(async (id: string) => {
    setSyncing(true)
    try {
      await flushPersist()
      const saved = await deleteShiftRemote(id, dataRef.current.revision ?? 0)
      skipNextSync.current = true
      dataRef.current = saved
      setData(saved)
      saveAppDataCache(saved)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) handleAuthFailure()
      if (e instanceof ApiError && e.status === 409 && e.current) {
        try {
          const server = applyRemoteData(e.current)
          const saved = await deleteShiftRemote(id, server.revision ?? 0)
          skipNextSync.current = true
          dataRef.current = saved
          setData(saved)
          saveAppDataCache(saved)
          return
        } catch (e2) {
          if (e2 instanceof ApiError && e2.status === 409 && e2.current) {
            applyRemoteData(e2.current)
          }
          setError(e2 instanceof Error ? e2.message : 'מחיקה נכשלה')
          return
        }
      }
      setError(e instanceof Error ? e.message : 'מחיקה נכשלה')
    } finally {
      setSyncing(false)
    }
  }, [flushPersist, handleAuthFailure, applyRemoteData])

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

  const upsertCustomsBroker = useCallback(
    (broker: { id?: string; name: string }) => {
      const name = broker.name.trim()
      if (!name) return
      patchData((prev) => {
        const list = normalizeCustomsBrokers(prev.customsBrokers, {
          seedIfEmpty: false,
        })
        if (broker.id) {
          return {
            ...prev,
            customsBrokers: normalizeCustomsBrokers(
              list.map((b) => (b.id === broker.id ? { ...b, name } : b)),
              { seedIfEmpty: false },
            ),
          }
        }
        const next: CustomsBroker = {
          id: uuid(),
          name,
          contacts: [],
        }
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
    (
      brokerId: string,
      contact: { id?: string; name: string; phone: string },
    ) => {
      const digits = normalizeBrokerPhoneDigits(contact.phone)
      if (!digits) return
      const name = contact.name.trim()
      const phone = formatBrokerPhone(digits)
      patchData((prev) => {
        const list = normalizeCustomsBrokers(prev.customsBrokers, {
          seedIfEmpty: false,
        })
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
              // Prevent duplicate phone on same company
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
              ? {
                  ...b,
                  contacts: b.contacts.filter((c) => c.id !== contactId),
                }
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
      await flushPersist()
      const seeded = await seedAppDataRemote(dataRef.current.revision ?? 0)
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
  }, [flushPersist, handleAuthFailure, applyRemoteData, setView])

  const value = useMemo<AppContextValue>(
    () => ({
      data,
      loading,
      refreshing,
      syncing,
      error,
      user,
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
      startShift,
      discardDraft,
      updateDraftMeta,
      toggleLane,
      applyLaneSelection,
      applyPresentSelection,
      setLaneStaffingStandard,
      toggleWorker,
      setGateManager,
      setAllActiveLanes,
      setAllActiveWorkers,
      runAutoAssign,
      commitSelectorBoard,
      startManualAssign,
      updateAssignment,
      updateSelectorCell,
      swapAssignments,
      removeWorkerFromShift,
      updateLaneNotes,
      addExtraWorkerToLane,
      addSlotToLane,
      saveCurrentShift,
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
      startShift,
      discardDraft,
      updateDraftMeta,
      toggleLane,
      applyLaneSelection,
      applyPresentSelection,
      setLaneStaffingStandard,
      toggleWorker,
      setGateManager,
      setAllActiveLanes,
      setAllActiveWorkers,
      runAutoAssign,
      commitSelectorBoard,
      startManualAssign,
      updateAssignment,
      updateSelectorCell,
      swapAssignments,
      removeWorkerFromShift,
      updateLaneNotes,
      addExtraWorkerToLane,
      addSlotToLane,
      saveCurrentShift,
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
