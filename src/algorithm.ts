import {
  countsAsDayEasy,
  effectiveIntensityScore,
  INTENSITY_LABELS,
  SHIFT_TYPE_LABELS,
} from './constants'
import type {
  Intensity,
  Lane,
  LaneAssignment,
  ShiftSchedule,
  ShiftType,
  Worker,
} from './types'

/** Why a specific worker was placed on a specific lane */
export interface PlacementExplanation {
  laneId: string
  workerId: string
  /** Hebrew bullet reasons grounded in the ranking math */
  reasons: string[]
}

export interface AssignmentResult {
  assignments: LaneAssignment[]
  unassignedWorkerIds: string[]
  understaffedLaneIds: string[]
  warnings: string[]
  /** Per placement rationale (lane fill order + worker ranking) */
  explanations: PlacementExplanation[]
}

export interface AssignmentContext {
  date: string
  shiftType: ShiftType
  /** Calendar days of history to consider (default 14) */
  lookbackDays?: number
  /** Cap for multi-pass swap optimization (default 50) */
  maxOptimizationPasses?: number
  /**
   * Seed for tie-break shuffle only (does not change ranking rules).
   * Default: `${date}|${shiftType}` — same inputs → same assignment.
   */
  rngSeed?: string | number
}

export interface WorkerLaneStats {
  workerId: string
  /** laneId → times assigned */
  byLane: Record<string, number>
  hardCount: number
  mediumCount: number
  /** Raw easy lane placements (includes night easy) */
  easyCount: number
  /** Easy only on morning/afternoon — real "rest" credit */
  dayEasyCount: number
  /** Easy placements on night (not treated as rest) */
  nightEasyCount: number
  /** Weighted load (night × multiplier; night-easy ≈ medium) */
  effectiveLoad: number
  hardByShift: Record<ShiftType, number>
  totalAssignments: number
}

/** Result of the Maximum Distance exponential rotation score. */
export interface RotationScoreResult {
  /**
   * Display / soft-floor score: max(0, rawScore).
   * Prefer `rawScore` for ranking so D≤1 cases still differentiate.
   */
  score: number
  /** Unclamped 100 - timePenalty - volumePenalty (may be negative). */
  rawScore: number
  timePenalty: number
  volumePenalty: number
  daysSince: number | null
  totalWeightedVisits: number
  shiftWeight: number
}

/** Options for building / sorting candidates on a single lane. */
export interface SortCandidatesOptions {
  lane: Lane
  profiles: Map<string, WorkerHistoryProfile>
  otherOpen: Lane[]
  currentShiftType: ShiftType
  morning: SameDayMorningContext | null
  recoveringIds: Set<string>
  /** When true, rotation score is ignored in ranking (relaxation pass). */
  relaxRotation?: boolean
  /** When true, night-recovery preference is ignored for medium/easy. */
  relaxNightRecovery?: boolean
  /**
   * RNG for Fisher–Yates tie-break shuffle only.
   * Ranking comparator is unchanged; RNG only orders equal candidates before sort.
   */
  rng?: () => number
}

/** Inputs for the multi-pass global swap optimizer. */
export interface MultiPassOptimizationInput {
  assignments: LaneAssignment[]
  unassignedWorkerIds: string[]
  lanes: Lane[]
  workersById: Map<string, Worker>
  profiles: Map<string, WorkerHistoryProfile>
  maxPasses?: number
  /** Soft recovery set (afternoon after night) */
  recoveringIds?: Set<string>
  morning?: SameDayMorningContext | null
  currentShiftType?: ShiftType
  /** Greedy board — used for stability component */
  baselineAssignments?: LaneAssignment[]
}

export interface MultiPassOptimizationResult {
  assignments: LaneAssignment[]
  unassignedWorkerIds: string[]
  passesRun: number
  swapsPerformed: number
  /** Passes (after the first) that still found an improving move. */
  improvingPassesAfterFirst: number
  /** Kept for compatibility — sum of per-placement rotation scores */
  totalRotationScore: number
  /** Global weighted board objective (0–100 when legal) */
  totalGlobalScore: number
}

/** Soft objective weights for evaluateBoard (sum ≈ 1). */
export const DEFAULT_BOARD_WEIGHTS = {
  /** Dominant when staffing is equal — prefer who was on the lane longest ago. */
  rotation: 0.42,
  workload: 0.11,
  recovery: 0.09,
  hardBalance: 0.07,
  handoff: 0.08,
  versatility: 0.03,
  intensityDist: 0.03,
  /** Still secondary to lexicographic staffing-first. */
  staffing: 0.14,
  stability: 0.03,
} as const

export type BoardWeightKey = keyof typeof DEFAULT_BOARD_WEIGHTS

export interface BoardEvaluation {
  /** False if any HARD CONSTRAINT is violated */
  legal: boolean
  /** Weighted 0–100 (or -Infinity if illegal) */
  score: number
  components: Record<BoardWeightKey, number>
  understaffedSlots: number
  /** Placements that return to the same lane within SHORT_RETURN_DAYS. */
  shortReturnCount: number
  recoveryOnHard: number
  minDaysSince: number
  totalRotation: number
}

const DEFAULT_LOOKBACK_DAYS = 14
/** Rotation scoring window in calendar days (Maximum Distance Strategy). */
export const ROTATION_LOOKBACK_DAYS = 14
/**
 * Multiplier applied to cumulative effective load after each calendar rest day
 * (no presence / assignment). ~0.75 ≈ one hard day fades after ~4 rest days.
 */
export const REST_DAY_LOAD_DECAY = 0.75
/**
 * Subtracted from each day-easy placement score so easy morning/afternoon
 * adds less than a full point (net ≈ +0.5 instead of +1).
 */
export const DAY_EASY_LOAD_CREDIT = 0.5
/**
 * Extra mild decay when every counted placement that calendar day is day-easy
 * (light work day still recovers a bit from prior load).
 */
export const EASY_ONLY_DAY_LOAD_DECAY = 0.9
/** Soft floor: candidates below this score are filtered when alternatives exist. */
const ROTATION_SOFT_THRESHOLD = 40
/** Bucket width for rotation ranking — lets load/hard compete inside a band. */
const ROTATION_SCORE_BUCKET = 5
/**
 * Short return to the same lane (day shifts): avoid when a better-spaced
 * qualified alternative exists. Also used for board warnings.
 */
export const SHORT_RETURN_DAYS = 2
/** Multi-pass local-search iteration cap. */
const DEFAULT_MAX_OPTIMIZATION_PASSES = 200
/** Only treat versatility as decisive when the gap is at least this many open lanes. */
const VERSATILITY_MIN_GAP = 2
/** Per weighted day-visit in the rotation window (grows with repeat volume). */
const ROTATION_VOLUME_PENALTY_PER_VISIT = 7

/**
 * Shift-weighted rotation impact (Morning > Noon > a night visit still counts).
 * All shift types contribute to who was last on a lane.
 */
export const ROTATION_SHIFT_WEIGHT: Record<ShiftType, number> = {
  night: 1.5,
  morning: 1.2,
  afternoon: 1.0,
}

/** Chronological order within a calendar day (for same-day D = 0.5). */
const SHIFT_SEQUENCE: Record<ShiftType, number> = {
  morning: 0,
  afternoon: 1,
  night: 2,
}

const EMPTY_HARD_BY_SHIFT: Record<ShiftType, number> = {
  morning: 0,
  afternoon: 0,
  night: 0,
}

/** FNV-1a style hash → uint32 seed (stable across runs / platforms). */
export function hashStringToSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Mulberry32 — deterministic PRNG in [0, 1). Tie-breaks only. */
export function createSeededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fisher–Yates shuffle. Pass a seeded rng for reproducible tie-breaks.
 * Does not alter compareForLane / staffing / cert rules.
 */
function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Local calendar date distance (avoids UTC off-by-one) */
export function daysBetweenLocal(earlier: string, later: string): number {
  const [ey, em, ed] = earlier.split('-').map(Number)
  const [ly, lm, ld] = later.split('-').map(Number)
  if (!ey || !em || !ed || !ly || !lm || !ld) return Number.POSITIVE_INFINITY
  const a = Date.UTC(ey, em - 1, ed)
  const b = Date.UTC(ly, lm - 1, ld)
  return Math.floor((b - a) / (24 * 60 * 60 * 1000))
}

/** History strictly before current date, within lookback window, newest first */
export function filterRelevantHistory(
  history: ShiftSchedule[],
  currentDate: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): ShiftSchedule[] {
  const filtered = history.filter((h) => {
      if (h.date >= currentDate) return false
      return daysBetweenLocal(h.date, currentDate) <= lookbackDays
    })
  return dedupeShiftsByDateAndType(filtered).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
    const seq = SHIFT_SEQUENCE[b.shiftType] - SHIFT_SEQUENCE[a.shiftType]
    if (seq !== 0) return seq
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}

/**
 * Keep one shift per (date, shiftType) — latest updatedAt wins.
 * Prevents double-counting when the same shift was saved multiple times.
 */
export function dedupeShiftsByDateAndType(
  shifts: ShiftSchedule[],
): ShiftSchedule[] {
  const best = new Map<string, ShiftSchedule>()
  for (const h of shifts) {
    const key = `${h.date}|${h.shiftType}`
    const prev = best.get(key)
    if (!prev || h.updatedAt.localeCompare(prev.updatedAt) > 0) {
      best.set(key, h)
    }
  }
  return [...best.values()]
}

/** Worker must hold every required certification for the lane */
export function isQualified(worker: Worker, lane: Lane): boolean {
  if (lane.requiredCertifications.length === 0) return true
  return lane.requiredCertifications.every((c) => worker.certifications.includes(c))
}

/**
 * Per-worker history used by Maximum Distance rotation + load balancing.
 * Morning, afternoon, and night placements all count toward lane rotation
 * (who was on the lane most recently).
 * Afternoon-only “night recovery” uses needsAfternoonNightRecovery separately
 * (previous calendar night only).
 */
export interface WorkerHistoryProfile {
  /**
   * Effective load across prior days in the lookback window, with:
   * rest-day decay, day-easy credit, easy-only day decay, plus same-day
   * earlier placements.
   */
  load: number
  /** Same as load, only placements matching the current shift type (prior days). */
  loadInSameShiftType: number
  hardCount: number
  hardInSameShiftType: number
  /** Easy credit only morning/afternoon */
  dayEasyCount: number
  dayEasyInSameShiftType: number
  laneCounts: Map<string, number>
  lastLaneIds: Set<string>
  /**
   * Weighted visit volume per lane in the rotation window
   * (each visit adds ROTATION_SHIFT_WEIGHT[shiftType], nights included).
   */
  rotationWeightedVisits: Map<string, number>
  /** Raw visit counts per lane in the rotation window (all shift types). */
  rotationLaneCounts: Map<string, number>
  /** Calendar days since last visit to lane (0.5 = earlier today). */
  daysSinceLastVisit: Map<string, number>
  /** Shift weight of the most recent visit to that lane. */
  lastVisitShiftWeight: Map<string, number>
  /** Lanes from most recent placement (any shift). */
  lastDayLaneIds: Set<string>
  /**
   * Lanes held on the previous calendar day (any shift type).
   * Kept for warnings / explanations of day-after-day returns.
   */
  prevCalendarDayLaneIds: Set<string>
  laneRecency: Map<string, number>
  lastWasHard: boolean
  lastShiftType: ShiftType | null
  shiftsSeen: number
}

/**
 * Maximum Distance rotation score with exponential time decay + shift weighting.
 *
 * timePenalty = (100 / D^1.5) * shiftWeight   when 0 < D ≤ 14
 * volumePenalty = totalWeightedVisits * ROTATION_VOLUME_PENALTY_PER_VISIT
 * rawScore = 100 - timePenalty - volumePenalty  (may be negative)
 * score = max(0, rawScore) for display / soft-floor filters
 *
 * @param daysSince — D; use 0.5 for same-day earlier shift, undefined/null if never
 * @param totalWeightedVisits — sum of shift weights for visits in the window
 * @param shiftWeight — weight of the most recent visit (default noon = 1)
 */
export function calculateShiftWeightedRotationScore(
  daysSince?: number | null,
  totalWeightedVisits = 0,
  shiftWeight: number = ROTATION_SHIFT_WEIGHT.afternoon,
): RotationScoreResult {
  const visits = Math.max(0, totalWeightedVisits)
  const weight = Math.max(0, shiftWeight)
  const volumePenalty = visits * ROTATION_VOLUME_PENALTY_PER_VISIT

  let timePenalty = 0
  let D: number | null =
    daysSince == null || !Number.isFinite(daysSince) ? null : daysSince

  if (D != null && D > 0 && D <= ROTATION_LOOKBACK_DAYS) {
    // D=0.5 (same day) and D=1 (yesterday) both hit the heavy end of the curve.
    timePenalty = (100 / Math.pow(D, 1.5)) * weight
  }

  const rawScore = 100 - timePenalty - volumePenalty
  const score = Math.max(0, rawScore)
  return {
    score,
    rawScore,
    timePenalty,
    volumePenalty,
    daysSince: D,
    totalWeightedVisits: visits,
    shiftWeight: weight,
  }
}

/**
 * Backward-compatible alias: unweighted call sites can omit shift weight (defaults to noon).
 */
export function calculateRotationScore(
  daysSince?: number | null,
  totalVisits = 0,
): RotationScoreResult {
  return calculateShiftWeightedRotationScore(daysSince, totalVisits, 1)
}

function rotationScoreFor(
  profile: WorkerHistoryProfile,
  laneId: string,
): RotationScoreResult {
  const D = profile.daysSinceLastVisit.get(laneId)
  const weighted = profile.rotationWeightedVisits.get(laneId) ?? 0
  const weight =
    profile.lastVisitShiftWeight.get(laneId) ?? ROTATION_SHIFT_WEIGHT.afternoon
  return calculateShiftWeightedRotationScore(D, weighted, weight)
}

/** True when last day-shift visit to this lane was within SHORT_RETURN_DAYS. */
export function isShortReturnToLane(
  profile: WorkerHistoryProfile,
  laneId: string,
  maxDays: number = SHORT_RETURN_DAYS,
): boolean {
  const D = profile.daysSinceLastVisit.get(laneId)
  return D != null && D <= maxDays
}

/** Compare spacing on a lane: higher = better (never visited / longer ago / fewer visits). */
export function rotationSpacingBetter(
  a: WorkerHistoryProfile,
  b: WorkerHistoryProfile,
  laneId: string,
): boolean {
  return rotationScoreFor(a, laneId).rawScore > rotationScoreFor(b, laneId).rawScore
}

/** Calendar date minus one local day (YYYY-MM-DD). */
export function previousLocalDate(isoDate: string): string | null {
  return addLocalDaysISO(isoDate, -1)
}

/** Add delta calendar days to a YYYY-MM-DD local date. */
export function addLocalDaysISO(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** Inclusive local date walk from `from` to `to` (YYYY-MM-DD). */
export function eachLocalDateInclusive(from: string, to: string): string[] {
  if (!from || !to || from > to) return []
  const out: string[] = []
  let cur = from
  while (cur <= to) {
    out.push(cur)
    cur = addLocalDaysISO(cur, 1)
  }
  return out
}

function workerAssignedOnShift(
  workerId: string,
  shift: ShiftSchedule,
): boolean {
  if (shift.presentWorkerIds?.includes(workerId)) return true
  if (shift.gateManagerWorkerId?.trim() === workerId) return true
  return (shift.assignments ?? []).some((a) => a.workerIds.includes(workerId))
}

/** True when the worker was present or assigned on any shift that calendar day. */
export function workerOnDutyThatDay(
  workerId: string,
  shiftsThatDay: ShiftSchedule[],
): boolean {
  return shiftsThatDay.some((s) => workerAssignedOnShift(workerId, s))
}

export type DayLoadFilter = {
  /** When false, night placements do not add load points (heatmap stats). Default true. */
  includeNight?: boolean
  /** Only count placements of this shift type. */
  onlyShiftType?: ShiftType
}

export function groupShiftsByDate(
  shifts: ShiftSchedule[],
): Map<string, ShiftSchedule[]> {
  const map = new Map<string, ShiftSchedule[]>()
  for (const s of shifts) {
    const list = map.get(s.date) ?? []
    list.push(s)
    map.set(s.date, list)
  }
  return map
}

/** Effective load points for one placement, with day-easy credit applied. */
export function placementScoreForLoad(
  intensity: Lane['intensity'],
  shiftType: ShiftType,
): number {
  const raw = effectiveIntensityScore(intensity, shiftType)
  if (countsAsDayEasy(intensity, shiftType)) {
    return Math.max(0, raw - DAY_EASY_LOAD_CREDIT)
  }
  return raw
}

export type DayPlacementLoadSummary = {
  /** Net points after day-easy credit. */
  points: number
  /** Number of placements that counted toward load. */
  placementCount: number
  /** True when every counted placement was day-easy. */
  easyOnly: boolean
}

/** Sum effective load points for a worker on one calendar day (+ easy-only flag). */
export function dayPlacementLoadSummary(
  workerId: string,
  shiftsThatDay: ShiftSchedule[],
  laneMap: Map<string, Lane>,
  filter?: DayLoadFilter,
): DayPlacementLoadSummary {
  const includeNight = filter?.includeNight !== false
  let points = 0
  let placementCount = 0
  let allEasy = true
  for (const shift of shiftsThatDay) {
    if (!includeNight && shift.shiftType === 'night') continue
    if (filter?.onlyShiftType && shift.shiftType !== filter.onlyShiftType) {
      continue
    }
    for (const assignment of shift.assignments ?? []) {
      if (!assignment.workerIds.includes(workerId)) continue
      const lane = laneMap.get(assignment.laneId)
      if (!lane) continue
      points += placementScoreForLoad(lane.intensity, shift.shiftType)
      placementCount += 1
      if (!countsAsDayEasy(lane.intensity, shift.shiftType)) allEasy = false
    }
  }
  return {
    points,
    placementCount,
    easyOnly: placementCount > 0 && allEasy,
  }
}

/** Sum effective intensity points for a worker on one calendar day. */
export function placementLoadOnDay(
  workerId: string,
  shiftsThatDay: ShiftSchedule[],
  laneMap: Map<string, Lane>,
  filter?: DayLoadFilter,
): number {
  return dayPlacementLoadSummary(workerId, shiftsThatDay, laneMap, filter)
    .points
}

/**
 * Chronological effective load with recovery toward lower load:
 * - Rest day (not on duty) → × REST_DAY_LOAD_DECAY
 * - Work day → add placement points (day-easy gets DAY_EASY_LOAD_CREDIT)
 * - Easy-only work day → also × EASY_ONLY_DAY_LOAD_DECAY
 */
export function accumulateLoadWithRestDecay(
  workerId: string,
  shiftsByDate: Map<string, ShiftSchedule[]>,
  laneMap: Map<string, Lane>,
  fromDate: string,
  toDate: string,
  filter?: DayLoadFilter,
  decay: number = REST_DAY_LOAD_DECAY,
): number {
  let load = 0
  for (const date of eachLocalDateInclusive(fromDate, toDate)) {
    const dayShifts = shiftsByDate.get(date) ?? []
    if (!workerOnDutyThatDay(workerId, dayShifts)) {
      load *= decay
      if (load < 0.05) load = 0
      continue
    }
    const summary = dayPlacementLoadSummary(
      workerId,
      dayShifts,
      laneMap,
      filter,
    )
    load += summary.points
    if (summary.easyOnly) {
      load *= EASY_ONLY_DAY_LOAD_DECAY
      if (load < 0.05) load = 0
    }
  }
  return Math.round(load * 10) / 10
}

/**
 * Night recovery applies only on the afternoon of the calendar day after a night shift.
 * Night dated D (starts evening D) → recovery window = afternoon of D+1.
 */
export function needsAfternoonNightRecovery(
  workerId: string,
  history: ShiftSchedule[],
  currentDate: string,
  currentShiftType: ShiftType,
): boolean {
  if (currentShiftType !== 'afternoon') return false
  const nightDate = previousLocalDate(currentDate)
  if (!nightDate) return false
  return history.some(
    (h) =>
      h.date === nightDate &&
      h.shiftType === 'night' &&
      workerAssignedOnShift(workerId, h),
  )
}

export function computeWorkerLoad(
  workerId: string,
  history: ShiftSchedule[],
  lanes: Lane[],
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  asOfDate?: string,
): number {
  const laneMap = new Map(lanes.map((l) => [l.id, l]))
  const end =
    asOfDate ??
    [...history].sort((a, b) => b.date.localeCompare(a.date))[0]?.date
  if (!end) return 0
  const start = addLocalDaysISO(end, -lookbackDays)
  const windowShifts = dedupeShiftsByDateAndType(
    history.filter((h) => h.date >= start && h.date <= end),
  )
  return accumulateLoadWithRestDecay(
    workerId,
    groupShiftsByDate(windowShifts),
    laneMap,
    start,
    end,
  )
}

/** Same-day morning shift context for afternoon handoff lanes */
export interface SameDayMorningContext {
  found: boolean
  morningWorkerIds: Set<string>
  workersByLane: Map<string, Set<string>>
  lanesByWorker: Map<string, Set<string>>
  /** Gate manager designated on the same-day morning shift, if any */
  gateManagerWorkerId?: string
}

export function buildSameDayMorningContext(
  history: ShiftSchedule[],
  date: string,
): SameDayMorningContext {
  const mornings = dedupeShiftsByDateAndType(
    history.filter((h) => h.date === date && h.shiftType === 'morning'),
  ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const morning = mornings[0]
  const morningWorkerIds = new Set<string>()
  const workersByLane = new Map<string, Set<string>>()
  const lanesByWorker = new Map<string, Set<string>>()

  if (!morning) {
    return { found: false, morningWorkerIds, workersByLane, lanesByWorker }
  }

  for (const id of morning.presentWorkerIds ?? []) morningWorkerIds.add(id)

  for (const assignment of morning.assignments ?? []) {
    const set = workersByLane.get(assignment.laneId) ?? new Set()
    for (const wid of assignment.workerIds) {
      if (!wid) continue
      morningWorkerIds.add(wid)
      set.add(wid)
      const lanes = lanesByWorker.get(wid) ?? new Set()
      lanes.add(assignment.laneId)
      lanesByWorker.set(wid, lanes)
    }
    workersByLane.set(assignment.laneId, set)
  }

  const gate = morning.gateManagerWorkerId?.trim()
  if (gate) morningWorkerIds.add(gate)

  return {
    found: true,
    morningWorkerIds,
    workersByLane,
    lanesByWorker,
    ...(gate ? { gateManagerWorkerId: gate } : {}),
  }
}

/**
 * Afternoon handoff priority (lower = better):
 * 0 — arrives only for afternoon
 * 1 — long shift, was on THIS handoff lane in the morning
 * 2 — long shift, other morning continuer
 */
export function afternoonHandoffTier(
  workerId: string,
  laneId: string,
  morning: SameDayMorningContext | null,
): number {
  if (!morning?.found) return 0
  if (!morning.morningWorkerIds.has(workerId)) return 0
  if (morning.workersByLane.get(laneId)?.has(workerId)) return 1
  return 2
}

function versatility(worker: Worker, otherOpenLanes: Lane[]): number {
  return otherOpenLanes.filter((l) => isQualified(worker, l)).length
}

function easyStaffingRemaining(otherOpen: Lane[]): number {
  return otherOpen
    .filter((l) => l.intensity === 'easy')
    .reduce((n, l) => n + l.staffingStandard, 0)
}

/**
 * Build rotation + load profile. Includes:
 * - prior calendar days within lookback (all shift types for rotation)
 * - same-day earlier shifts → D = 0.5 for those lanes
 */
export function buildWorkerProfile(
  workerId: string,
  history: ShiftSchedule[],
  lanes: Lane[],
  currentShiftType: ShiftType,
  currentDate: string,
  lookbackDays: number = ROTATION_LOOKBACK_DAYS,
): WorkerHistoryProfile {
  const laneMap = new Map(lanes.map((l) => [l.id, l]))
  const prevDate = previousLocalDate(currentDate)
  const windowDays = Math.max(lookbackDays, ROTATION_LOOKBACK_DAYS)
  const lookback = filterRelevantHistory(history, currentDate, windowDays)

  const profile: WorkerHistoryProfile = {
    load: 0,
    loadInSameShiftType: 0,
    hardCount: 0,
    hardInSameShiftType: 0,
    dayEasyCount: 0,
    dayEasyInSameShiftType: 0,
    laneCounts: new Map(),
    lastLaneIds: new Set(),
    rotationWeightedVisits: new Map(),
    rotationLaneCounts: new Map(),
    daysSinceLastVisit: new Map(),
    lastVisitShiftWeight: new Map(),
    lastDayLaneIds: new Set(),
    prevCalendarDayLaneIds: new Set(),
    laneRecency: new Map(),
    lastWasHard: false,
    lastShiftType: null,
    shiftsSeen: 0,
  }

  let capturedLastShift = false

  const recordLaneVisit = (
    lane: Lane,
    shiftType: ShiftType,
    daysSince: number,
    shiftIndex: number,
  ) => {
    const w = ROTATION_SHIFT_WEIGHT[shiftType]
    profile.laneCounts.set(lane.id, (profile.laneCounts.get(lane.id) ?? 0) + 1)
    profile.rotationLaneCounts.set(
      lane.id,
      (profile.rotationLaneCounts.get(lane.id) ?? 0) + 1,
    )
    profile.rotationWeightedVisits.set(
      lane.id,
      (profile.rotationWeightedVisits.get(lane.id) ?? 0) + w,
    )
    // Keep the smallest D (most recent visit) and its shift weight.
    const prevD = profile.daysSinceLastVisit.get(lane.id)
    if (prevD == null || daysSince < prevD) {
      profile.daysSinceLastVisit.set(lane.id, daysSince)
      profile.lastVisitShiftWeight.set(lane.id, w)
    }
    if (!profile.laneRecency.has(lane.id)) {
      profile.laneRecency.set(lane.id, shiftIndex)
    }
  }

  lookback.forEach((shift, shiftIndex) => {
    const placements: Lane[] = []
    const daysSince = daysBetweenLocal(shift.date, currentDate)

    for (const assignment of shift.assignments) {
      if (!assignment.workerIds.includes(workerId)) continue
      const lane = laneMap.get(assignment.laneId)
      if (!lane) continue
      placements.push(lane)

      if (prevDate && shift.date === prevDate) {
        profile.prevCalendarDayLaneIds.add(lane.id)
      }

      // Lane rotation: every shift type, so “was here yesterday” includes nights.
      recordLaneVisit(lane, shift.shiftType, daysSince, shiftIndex)

      if (lane.intensity === 'hard') {
        profile.hardCount += 1
        if (shift.shiftType === currentShiftType) {
          profile.hardInSameShiftType += 1
        }
      }

      if (countsAsDayEasy(lane.intensity, shift.shiftType)) {
        profile.dayEasyCount += 1
        if (shift.shiftType === currentShiftType) {
          profile.dayEasyInSameShiftType += 1
        }
      }
    }

    if (placements.length === 0) return

    profile.shiftsSeen += 1
    if (!capturedLastShift) {
      profile.lastShiftType = shift.shiftType
      for (const lane of placements) {
        profile.lastLaneIds.add(lane.id)
        profile.lastDayLaneIds.add(lane.id)
        if (lane.intensity === 'hard') profile.lastWasHard = true
      }
      capturedLastShift = true
    }
  })

  // Effective load with rest-day decay over the lookback calendar window.
  const windowStart = addLocalDaysISO(currentDate, -windowDays)
  if (prevDate && windowStart <= prevDate) {
    const byDate = groupShiftsByDate(lookback)
    profile.load = accumulateLoadWithRestDecay(
      workerId,
      byDate,
      laneMap,
      windowStart,
      prevDate,
    )
    profile.loadInSameShiftType = accumulateLoadWithRestDecay(
      workerId,
      byDate,
      laneMap,
      windowStart,
      prevDate,
      { onlyShiftType: currentShiftType },
    )
  }

  // Same-day earlier shifts → D = 0.5 + load / hard / lastWasHard (not rotation-only).
  const sameDayEarlier = dedupeShiftsByDateAndType(
    history.filter(
      (h) =>
        h.date === currentDate &&
        SHIFT_SEQUENCE[h.shiftType] < SHIFT_SEQUENCE[currentShiftType],
    ),
  ).sort(
    (a, b) => SHIFT_SEQUENCE[b.shiftType] - SHIFT_SEQUENCE[a.shiftType],
  )

  let sameDayLastCaptured = false
  for (const shift of sameDayEarlier) {
    const placements: Lane[] = []
    for (const assignment of shift.assignments ?? []) {
      if (!assignment.workerIds.includes(workerId)) continue
      const lane = laneMap.get(assignment.laneId)
      if (!lane) continue
      placements.push(lane)
      recordLaneVisit(lane, shift.shiftType, 0.5, -1)

      const points = placementScoreForLoad(lane.intensity, shift.shiftType)
      profile.load += points
      // Same-day earlier is a different shift type than current — still counts as load
      if (lane.intensity === 'hard') {
        profile.hardCount += 1
      }
      if (countsAsDayEasy(lane.intensity, shift.shiftType)) {
        profile.dayEasyCount += 1
      }
    }

    if (placements.length === 0) continue

    // Same-day morning that was entirely day-easy also gets mild recovery.
    if (
      placements.length > 0 &&
      placements.every((l) =>
        countsAsDayEasy(l.intensity, shift.shiftType),
      )
    ) {
      profile.load *= EASY_ONLY_DAY_LOAD_DECAY
    }

    profile.shiftsSeen += 1
    // Same-day earlier is more recent than prior-day history — override "last"
    if (!sameDayLastCaptured) {
      profile.lastShiftType = shift.shiftType
      profile.lastLaneIds = new Set(placements.map((l) => l.id))
      profile.lastDayLaneIds = new Set(placements.map((l) => l.id))
      profile.lastWasHard = placements.some((l) => l.intensity === 'hard')
      sameDayLastCaptured = true
      capturedLastShift = true
    }
  }

  profile.load = Math.round(profile.load * 10) / 10
  profile.loadInSameShiftType =
    Math.round(profile.loadInSameShiftType * 10) / 10

  return profile
}

/**
 * Ranking for a lane (lower compare result = better). Order:
 * 1) afternoon handoff
 * 2) short-return avoidance (almost-hard when alternatives exist in sort set)
 * 3) Maximum Distance rotation — bucketed raw score (not continuous)
 * 4) night→afternoon recovery
 * 5) load / hard balance by intensity (relative hard rate)
 * 6) versatility buckets (transitive)
 */
function compareForLane(
  a: Worker,
  b: Worker,
  opts: SortCandidatesOptions,
): number {
  const {
    lane,
    profiles,
    otherOpen,
    currentShiftType,
    morning,
    recoveringIds,
    relaxRotation = false,
    relaxNightRecovery = false,
  } = opts
  const pa = profiles.get(a.id)!
  const pb = profiles.get(b.id)!

  if (lane.afternoonHandoff && currentShiftType === 'afternoon') {
    const ta = afternoonHandoffTier(a.id, lane.id, morning)
    const tb = afternoonHandoffTier(b.id, lane.id, morning)
    if (ta !== tb) return ta - tb
  }

  if (!relaxRotation) {
    // Almost-hard: prefer anyone who is NOT a short return when the other is.
    const aShort = isShortReturnToLane(pa, lane.id) ? 1 : 0
    const bShort = isShortReturnToLane(pb, lane.id) ? 1 : 0
    if (aShort !== bShort) return aShort - bShort

    // Longer gap (or never on this lane) beats load balance when the gap is real.
    const ra = rotationScoreFor(pa, lane.id).rawScore
    const rb = rotationScoreFor(pb, lane.id).rawScore
    if (Math.abs(ra - rb) > 1) return rb - ra
  }

  const applyRecovery =
    !relaxNightRecovery || lane.intensity === 'hard'
  if (applyRecovery) {
  const aRec = recoveringIds.has(a.id) ? 1 : 0
  const bRec = recoveringIds.has(b.id) ? 1 : 0
  if (aRec !== bRec) {
    if (lane.intensity === 'hard') return aRec - bRec
    if (lane.intensity === 'easy') return bRec - aRec
    const easyLeft = easyStaffingRemaining(otherOpen)
    if (easyLeft > 0) return aRec - bRec
    return bRec - aRec
    }
  }

  const hardRate = (p: WorkerHistoryProfile) =>
    p.hardCount / Math.max(1, p.shiftsSeen)

  if (lane.intensity === 'hard') {
    if (pa.lastWasHard !== pb.lastWasHard) {
      return (pa.lastWasHard ? 1 : 0) - (pb.lastWasHard ? 1 : 0)
    }
    if (pa.hardInSameShiftType !== pb.hardInSameShiftType) {
      return pa.hardInSameShiftType - pb.hardInSameShiftType
    }
    const ra = hardRate(pa)
    const rb = hardRate(pb)
    if (Math.abs(ra - rb) > 1e-9) return ra - rb
    if (pa.hardCount !== pb.hardCount) return pa.hardCount - pb.hardCount
    if (pa.loadInSameShiftType !== pb.loadInSameShiftType) {
      return pa.loadInSameShiftType - pb.loadInSameShiftType
    }
    if (pa.load !== pb.load) return pa.load - pb.load
  } else if (lane.intensity === 'easy') {
    if (pa.lastWasHard !== pb.lastWasHard) {
      return (pb.lastWasHard ? 1 : 0) - (pa.lastWasHard ? 1 : 0)
    }
    if (pa.dayEasyInSameShiftType !== pb.dayEasyInSameShiftType) {
      return pa.dayEasyInSameShiftType - pb.dayEasyInSameShiftType
    }
    if (pa.dayEasyCount !== pb.dayEasyCount) {
      return pa.dayEasyCount - pb.dayEasyCount
    }
    const ra = hardRate(pa)
    const rb = hardRate(pb)
    if (Math.abs(ra - rb) > 1e-9) return rb - ra
    if (pa.hardCount !== pb.hardCount) return pb.hardCount - pa.hardCount
    if (pa.loadInSameShiftType !== pb.loadInSameShiftType) {
      return pb.loadInSameShiftType - pa.loadInSameShiftType
    }
    if (pa.load !== pb.load) return pb.load - pa.load
  } else {
    if (pa.hardInSameShiftType !== pb.hardInSameShiftType) {
      return pa.hardInSameShiftType - pb.hardInSameShiftType
    }
    const ra = hardRate(pa)
    const rb = hardRate(pb)
    if (Math.abs(ra - rb) > 1e-9) return ra - rb
    if (pa.hardCount !== pb.hardCount) return pa.hardCount - pb.hardCount
    if (pa.loadInSameShiftType !== pb.loadInSameShiftType) {
      return pa.loadInSameShiftType - pb.loadInSameShiftType
    }
    if (pa.load !== pb.load) return pa.load - pb.load
  }

  // Transitive versatility buckets (avoid non-transitive abs-gap compare)
  const va = Math.floor(versatility(a, otherOpen) / VERSATILITY_MIN_GAP)
  const vb = Math.floor(versatility(b, otherOpen) / VERSATILITY_MIN_GAP)
  if (va !== vb) return va - vb

  return 0
}

function rotationBucket(rawScore: number): number {
  return Math.floor(rawScore / ROTATION_SCORE_BUCKET)
}

/**
 * Sort candidates for a lane using Maximum Distance + existing soft rules.
 * Pure / unit-testable.
 * Shuffle is tie-break only; comparator rules are unchanged.
 */
export function sortCandidatesForLane(
  candidates: Worker[],
  opts: SortCandidatesOptions,
): Worker[] {
  const rng = opts.rng ?? Math.random
  return shuffle([...candidates], rng).sort((a, b) => compareForLane(a, b, opts))
}

/**
 * Soft pool filter: prefer workers above ROTATION_SOFT_THRESHOLD when enough exist.
 * Also prefer avoiding SHORT_RETURN_DAYS revisits when enough alternatives exist.
 * When short: keep everyone above the threshold, then fill from the rest by rawScore
 * (does NOT disable rotation ranking — partial soft-floor only).
 */
function applyRotationScorePool(
  pool: Worker[],
  lane: Lane,
  profiles: Map<string, WorkerHistoryProfile>,
  staffingStandard: number,
): {
  pool: Worker[]
  usedSoftFloor: boolean
  partialFill: boolean
  avoidedShortReturn: boolean
  relaxedShortReturn: boolean
} {
  if (pool.length === 0) {
    return {
      pool,
      usedSoftFloor: false,
      partialFill: false,
      avoidedShortReturn: false,
      relaxedShortReturn: false,
    }
  }

  const notShort = pool.filter(
    (w) => !isShortReturnToLane(profiles.get(w.id)!, lane.id),
  )
  let working = pool
  let avoidedShortReturn = false
  let relaxedShortReturn = false
  if (notShort.length >= staffingStandard) {
    working = notShort
    avoidedShortReturn = notShort.length < pool.length
  } else if (notShort.length > 0 && notShort.length < staffingStandard) {
    // Keep non-short first, then fill from short-return by raw rotation score.
    const shortIds = new Set(
      pool.filter((w) => !notShort.some((n) => n.id === w.id)).map((w) => w.id),
    )
    const shortSorted = pool
      .filter((w) => shortIds.has(w.id))
      .sort(
        (a, b) =>
          rotationScoreFor(profiles.get(b.id)!, lane.id).rawScore -
          rotationScoreFor(profiles.get(a.id)!, lane.id).rawScore,
      )
    working = [...notShort, ...shortSorted]
    relaxedShortReturn = true
  }

  const scored = working.map((w) => ({
    w,
    score: rotationScoreFor(profiles.get(w.id)!, lane.id).score,
    raw: rotationScoreFor(profiles.get(w.id)!, lane.id).rawScore,
  }))

  const above = scored.filter((x) => x.score >= ROTATION_SOFT_THRESHOLD)
  if (above.length >= staffingStandard) {
    return {
      pool: above.map((x) => x.w),
      usedSoftFloor: true,
      partialFill: false,
      avoidedShortReturn,
      relaxedShortReturn,
    }
  }

  if (above.length > 0) {
    const aboveIds = new Set(above.map((x) => x.w.id))
    const below = scored
      .filter((x) => !aboveIds.has(x.w.id))
      .sort((a, b) => b.raw - a.raw)
    return {
      pool: [...above.map((x) => x.w), ...below.map((x) => x.w)],
      usedSoftFloor: true,
      partialFill: true,
      avoidedShortReturn,
      relaxedShortReturn,
    }
  }

  // Prefer anyone who was not on this lane yesterday / earlier today (D > 1).
  const notRecent = working.filter((w) => {
    const D = profiles.get(w.id)!.daysSinceLastVisit.get(lane.id)
    return D == null || D > 1
  })
  if (notRecent.length >= staffingStandard) {
    return {
      pool: notRecent,
      usedSoftFloor: false,
      partialFill: false,
      avoidedShortReturn,
      relaxedShortReturn,
    }
  }

  return {
    pool: working,
    usedSoftFloor: false,
    partialFill: false,
    avoidedShortReturn,
    relaxedShortReturn,
  }
}

/**
 * Sum of shift-weighted rotation scores for a complete assignment board.
 * Unfilled slots contribute 0.
 */
export function totalBoardRotationScore(
  assignments: LaneAssignment[],
  profiles: Map<string, WorkerHistoryProfile>,
): number {
  let total = 0
  for (const a of assignments) {
    for (const wid of a.workerIds) {
      if (!wid) continue
      const p = profiles.get(wid)
      if (!p) continue
      total += rotationScoreFor(p, a.laneId).score
    }
  }
  return total
}

/**
 * Minimum days-since across filled slots (null visits treated as lookback+1).
 */
export function boardMinDaysSince(
  assignments: LaneAssignment[],
  profiles: Map<string, WorkerHistoryProfile>,
): number {
  let min = Number.POSITIVE_INFINITY
  for (const a of assignments) {
    for (const wid of a.workerIds) {
      if (!wid) continue
      const p = profiles.get(wid)
      if (!p) continue
      const D = p.daysSinceLastVisit.get(a.laneId)
      const v = D == null ? ROTATION_LOOKBACK_DAYS + 1 : D
      if (v < min) min = v
    }
  }
  return Number.isFinite(min) ? min : ROTATION_LOOKBACK_DAYS + 1
}

function cloneAssignments(assignments: LaneAssignment[]): LaneAssignment[] {
  return assignments.map((a) => ({
    laneId: a.laneId,
    workerIds: [...a.workerIds],
    ...(a.notes != null ? { notes: a.notes } : {}),
  }))
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  let sum = 0
  for (const v of values) {
    const d = v - mean
    sum += d * d
  }
  return sum / values.length
}

function clamp01to100(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function countFilled(assignments: LaneAssignment[]): number {
  let n = 0
  for (const a of assignments) {
    for (const id of a.workerIds) if (id) n += 1
  }
  return n
}

function requiredSlots(lanes: Lane[]): number {
  return lanes.reduce((n, l) => n + l.staffingStandard, 0)
}

function understaffedSlotCount(
  assignments: LaneAssignment[],
  lanes: Lane[],
): number {
  const byLane = new Map(assignments.map((a) => [a.laneId, a]))
  let missing = 0
  for (const lane of lanes) {
    const filled = (byLane.get(lane.id)?.workerIds ?? []).filter(Boolean).length
    missing += Math.max(0, lane.staffingStandard - filled)
  }
  return missing
}

/** Placement pairs for stability Jaccard. */
function placementKeySet(assignments: LaneAssignment[]): Set<string> {
  const s = new Set<string>()
  for (const a of assignments) {
    for (const wid of a.workerIds) {
      if (wid) s.add(`${a.laneId}:${wid}`)
    }
  }
  return s
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  const union = a.size + b.size - inter
  return union === 0 ? 1 : inter / union
}

export interface EvaluateBoardContext {
  lanes: Lane[]
  workersById: Map<string, Worker>
  profiles: Map<string, WorkerHistoryProfile>
  recoveringIds: Set<string>
  morning: SameDayMorningContext | null
  currentShiftType: ShiftType
  /** Optional greedy snapshot for stability */
  baselineAssignments?: LaneAssignment[]
  weights?: Partial<typeof DEFAULT_BOARD_WEIGHTS>
}

/**
 * Global board objective. HARD CONSTRAINT violations → legal=false, score=-Infinity.
 * Soft components are 0–100 (higher better), then weighted.
 */
export function evaluateBoard(
  assignments: LaneAssignment[],
  ctx: EvaluateBoardContext,
): BoardEvaluation {
  const weights = { ...DEFAULT_BOARD_WEIGHTS, ...ctx.weights }
  const laneById = new Map(ctx.lanes.map((l) => [l.id, l]))
  const seenWorkers = new Set<string>()

  // --- HARD CONSTRAINTS ---
  for (const a of assignments) {
    const lane = laneById.get(a.laneId)
    if (!lane) {
      return illegalBoardEval()
    }
    for (const wid of a.workerIds) {
      if (!wid) continue
      if (seenWorkers.has(wid)) return illegalBoardEval()
      seenWorkers.add(wid)
      const w = ctx.workersById.get(wid)
      if (!w || !isQualified(w, lane)) return illegalBoardEval()
    }
  }

  const placements: { lane: Lane; workerId: string; profile: WorkerHistoryProfile }[] =
    []
  for (const a of assignments) {
    const lane = laneById.get(a.laneId)!
    for (const wid of a.workerIds) {
      if (!wid) continue
      const profile = ctx.profiles.get(wid)
      if (!profile) continue
      placements.push({ lane, workerId: wid, profile })
    }
  }

  const understaffedSlots = understaffedSlotCount(assignments, ctx.lanes)
  const required = Math.max(1, requiredSlots(ctx.lanes))
  const filled = countFilled(assignments)
  const staffing = clamp01to100((filled / required) * 100)

  let shortReturnCount = 0
  let rotSum = 0
  let recoveryOnHard = 0
  let handoffScoreSum = 0
  let handoffN = 0
  let versatilityPenalties = 0
  const loads: number[] = []
  const hardCounts: number[] = []
  const intensityLoads: number[] = []

  const assignmentByLane = new Map(assignments.map((a) => [a.laneId, a]))
  const openLanes = ctx.lanes.filter((l) => {
    const filledHere = (assignmentByLane.get(l.id)?.workerIds ?? []).filter(
      Boolean,
    ).length
    return filledHere < l.staffingStandard
  })

  for (const { lane, workerId, profile } of placements) {
    const rot = rotationScoreFor(profile, lane.id)
    rotSum += rot.rawScore
    if (isShortReturnToLane(profile, lane.id)) shortReturnCount += 1

    const projectedLoad =
      profile.load +
      placementScoreForLoad(lane.intensity, ctx.currentShiftType)
    loads.push(projectedLoad)
    hardCounts.push(
      profile.hardCount + (lane.intensity === 'hard' ? 1 : 0),
    )
    intensityLoads.push(
      profile.hardCount * 3 +
        (lane.intensity === 'hard' ? 3 : lane.intensity === 'medium' ? 2 : 1),
    )

    if (ctx.recoveringIds.has(workerId) && lane.intensity === 'hard') {
      recoveryOnHard += 1
    }

    if (lane.afternoonHandoff && ctx.currentShiftType === 'afternoon') {
      const tier = afternoonHandoffTier(workerId, lane.id, ctx.morning ?? null)
      // tier 0 best → 100, tier 1 → 70, tier 2 → 35
      handoffScoreSum += tier === 0 ? 100 : tier === 1 ? 70 : 35
      handoffN += 1
    }

    const flex = versatility(
      ctx.workersById.get(workerId)!,
      openLanes.length > 0 ? openLanes : ctx.lanes,
    )
    if (
      lane.requiredCertifications.length === 0 &&
      flex >= VERSATILITY_MIN_GAP
    ) {
      versatilityPenalties += 1 // mild: burning a generalist on open lane
    }
  }

  const n = Math.max(1, placements.length)
  // Soft map raw rotation (may be negative) into 0–100 so D≤1 cases still differ
  const rotation = clamp01to100(
    placements.length === 0
      ? 0
      : (rotSum / n) * 0.5 + 50,
  )

  const loadVar = variance(loads)
  // Typical load values ~ few points; map variance to 0–100 (lower variance better)
  const workload = clamp01to100(100 - Math.min(100, loadVar * 8))

  const recovery =
    ctx.recoveringIds.size === 0
      ? 100
      : clamp01to100(100 - recoveryOnHard * (100 / Math.max(1, ctx.recoveringIds.size)))

  const hardVar = variance(hardCounts)
  const hardBalance = clamp01to100(100 - Math.min(100, hardVar * 12))

  const handoff = handoffN === 0 ? 100 : clamp01to100(handoffScoreSum / handoffN)

  const versatilityScore = clamp01to100(
    100 - (versatilityPenalties / n) * 40,
  )

  const intensityVar = variance(intensityLoads)
  const intensityDist = clamp01to100(100 - Math.min(100, intensityVar * 6))

  let stability = 100
  if (ctx.baselineAssignments) {
    stability = clamp01to100(
      jaccard(
        placementKeySet(assignments),
        placementKeySet(ctx.baselineAssignments),
      ) * 100,
    )
  }

  const components: Record<BoardWeightKey, number> = {
    rotation,
    workload,
    recovery,
    hardBalance,
    handoff,
    versatility: versatilityScore,
    intensityDist,
    staffing,
    stability,
  }

  let score = 0
  for (const key of Object.keys(weights) as BoardWeightKey[]) {
    score += components[key] * weights[key]
  }
  // Extra hard pull for missing required slots (beyond staffing component)
  score -= understaffedSlots * 4
  score = clamp01to100(score)

  return {
    legal: true,
    score,
    components,
    understaffedSlots,
    shortReturnCount,
    recoveryOnHard,
    minDaysSince: boardMinDaysSince(assignments, ctx.profiles),
    totalRotation: rotSum,
  }
}

function illegalBoardEval(): BoardEvaluation {
  const zero = {
    rotation: 0,
    workload: 0,
    recovery: 0,
    hardBalance: 0,
    handoff: 0,
    versatility: 0,
    intensityDist: 0,
    staffing: 0,
    stability: 0,
  }
  return {
    legal: false,
    score: Number.NEGATIVE_INFINITY,
    components: zero,
    understaffedSlots: Number.POSITIVE_INFINITY,
    shortReturnCount: Number.POSITIVE_INFINITY,
    recoveryOnHard: Number.POSITIVE_INFINITY,
    minDaysSince: 0,
    totalRotation: 0,
  }
}

/**
 * Compare two legal boards.
 * Lexicographic order (does not drop soft rules — only prioritizes):
 * 1) fewer understaffed slots (maximize fill)
 * 2) fewer short returns to the same lane (when fill is equal)
 * 3) higher weighted soft score (rotation weighted highest)
 * 4) fewer recovering-on-hard, then spacing / rotation / stability
 */
export function isBoardBetter(
  next: BoardEvaluation,
  current: BoardEvaluation,
): boolean {
  if (!next.legal) return false
  if (!current.legal) return next.legal

  // Primary: maximize legal staffing (הוגנות רק בין לוחות עם אותו מילוי)
  if (next.understaffedSlots !== current.understaffedSlots) {
    return next.understaffedSlots < current.understaffedSlots
  }

  // When enough people exist, do not put yesterday's occupant back
  // just to improve load balance.
  if (next.shortReturnCount !== current.shortReturnCount) {
    return next.shortReturnCount < current.shortReturnCount
  }

  if (next.score > current.score + 1e-6) return true
  if (next.score < current.score - 1e-6) return false

  // Near-equal global score — ordered soft tie-breaks
  if (next.recoveryOnHard !== current.recoveryOnHard) {
    return next.recoveryOnHard < current.recoveryOnHard
  }
  if (Math.abs(next.minDaysSince - current.minDaysSince) > 1e-9) {
    return next.minDaysSince > current.minDaysSince
  }
  if (Math.abs(next.totalRotation - current.totalRotation) > 1e-6) {
    return next.totalRotation > current.totalRotation
  }
  if (
    Math.abs(next.components.stability - current.components.stability) > 1e-6
  ) {
    return next.components.stability > current.components.stability
  }
  return false
}

/**
 * Multi-pass local search guided by evaluateBoard (global soft objective).
 * Never accepts illegal boards; keeps bestBoard so quality never regresses.
 * Each pass picks the **best** improving move (fill preferred via staffing-first
 * in isBoardBetter), then continues — stronger than first-improving.
 * Qualification remains a HARD gate before any swap is scored.
 */
export function runMultiPassOptimization(
  input: MultiPassOptimizationInput,
): MultiPassOptimizationResult {
  const maxPasses = input.maxPasses ?? DEFAULT_MAX_OPTIMIZATION_PASSES
  const laneById = new Map(input.lanes.map((l) => [l.id, l]))
  const recoveringIds = input.recoveringIds ?? new Set<string>()
  const morning = input.morning ?? null
  const currentShiftType = input.currentShiftType ?? 'morning'
  const baseline = input.baselineAssignments ?? input.assignments

  const evalCtx: EvaluateBoardContext = {
    lanes: input.lanes,
    workersById: input.workersById,
    profiles: input.profiles,
    recoveringIds,
    morning,
    currentShiftType,
    baselineAssignments: baseline,
  }

  let assignments = cloneAssignments(input.assignments)
  let unassigned = [...input.unassignedWorkerIds]
  let swapsPerformed = 0
  let passesRun = 0
  let improvingPassesAfterFirst = 0

  let bestAssignments = cloneAssignments(assignments)
  let bestUnassigned = [...unassigned]
  let bestEval = evaluateBoard(bestAssignments, evalCtx)

  const rememberBest = (evalResult: BoardEvaluation) => {
    if (isBoardBetter(evalResult, bestEval)) {
      bestAssignments = cloneAssignments(assignments)
      bestUnassigned = [...unassigned]
      bestEval = evalResult
    }
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    passesRun = pass + 1
    const curEval = evaluateBoard(assignments, evalCtx)

    type CandidateMove = {
      assignments: LaneAssignment[]
      unassigned: string[]
      evaluation: BoardEvaluation
    }
    const bestHolder: { move: CandidateMove | null } = { move: null }

    const consider = (
      nextAssignments: LaneAssignment[],
      nextUnassigned: string[],
    ) => {
      const nextEval = evaluateBoard(nextAssignments, evalCtx)
      if (!isBoardBetter(nextEval, curEval)) return
      const current = bestHolder.move
      if (!current || isBoardBetter(nextEval, current.evaluation)) {
        bestHolder.move = {
          assignments: nextAssignments,
          unassigned: nextUnassigned,
          evaluation: nextEval,
        }
      }
    }

    // --- Fill empty / understaffed slots from unassigned (priority via staffing-first) ---
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i]!
      const laneA = laneById.get(a.laneId)
      if (!laneA) continue
      const filled = a.workerIds.filter(Boolean).length
      if (filled >= laneA.staffingStandard) continue

      for (let u = 0; u < unassigned.length; u++) {
        const ubId = unassigned[u]!
        const ub = input.workersById.get(ubId)
        if (!ub || !isQualified(ub, laneA)) continue

        const next = cloneAssignments(assignments)
        const ids = next[i]!.workerIds.filter(Boolean)
        ids.push(ubId)
        next[i]!.workerIds = ids
        consider(
          next,
          unassigned.filter((_, idx) => idx !== u),
        )
      }
    }

    // --- Swaps: worker ↔ worker, assigned ↔ unassigned ---
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i]!
      const laneA = laneById.get(a.laneId)
      if (!laneA) continue

      for (let ai = 0; ai < a.workerIds.length; ai++) {
        const waId = a.workerIds[ai]
        if (!waId) continue
        const wa = input.workersById.get(waId)
        if (!wa) continue

        for (let j = i + 1; j < assignments.length; j++) {
          const b = assignments[j]!
          const laneB = laneById.get(b.laneId)
          if (!laneB) continue

          for (let bi = 0; bi < b.workerIds.length; bi++) {
            const wbId = b.workerIds[bi]
            if (!wbId) continue
            const wb = input.workersById.get(wbId)
            if (!wb) continue
            if (!isQualified(wa, laneB) || !isQualified(wb, laneA)) continue

            const next = cloneAssignments(assignments)
            next[i]!.workerIds[ai] = wbId
            next[j]!.workerIds[bi] = waId
            consider(next, unassigned)
          }
        }

        for (let u = 0; u < unassigned.length; u++) {
          const ubId = unassigned[u]!
          const ub = input.workersById.get(ubId)
          if (!ub || !isQualified(ub, laneA)) continue

          const next = cloneAssignments(assignments)
          next[i]!.workerIds[ai] = ubId
          const nextUnassigned = [...unassigned]
          nextUnassigned[u] = waId
          consider(next, nextUnassigned)
        }
      }
    }

    const bestMove = bestHolder.move
    if (!bestMove) break

    assignments = bestMove.assignments
    unassigned = bestMove.unassigned
    swapsPerformed += 1
    if (pass > 0) improvingPassesAfterFirst += 1
    rememberBest(bestMove.evaluation)
  }

  if (isBoardBetter(bestEval, evaluateBoard(assignments, evalCtx))) {
    assignments = bestAssignments
    unassigned = bestUnassigned
  }

  const finalEval = evaluateBoard(assignments, evalCtx)
  return {
    assignments,
    unassignedWorkerIds: unassigned,
    passesRun,
    swapsPerformed,
    improvingPassesAfterFirst,
    totalRotationScore: finalEval.totalRotation,
    totalGlobalScore: finalEval.legal ? finalEval.score : 0,
  }
}

function fmtLoad(n: number): string {
  return (Math.round(n * 10) / 10).toString()
}

/** Plain-language lane fill priority for managers (not algorithm internals). */
function explainLanePriority(
  lane: Lane,
  orderedLanes: Lane[],
  laneIndex: number,
  presentWorkers: Worker[],
  currentShiftType: ShiftType,
): string {
  const whyEarly: string[] = []
  if (currentShiftType === 'afternoon' && lane.afternoonHandoff) {
    whyEarly.push('מיועד להחלפת צהריים')
  }
  if (lane.requiredCertifications.length > 0) {
    whyEarly.push(
      `דורש הסמכה (${lane.requiredCertifications.join(', ')})`,
    )
  } else if (lane.intensity === 'hard') {
    whyEarly.push('עמדה קשה')
  }

  const qualified = presentWorkers.filter((w) => isQualified(w, lane)).length
  const orderHint =
    whyEarly.length > 0
      ? `מולא מוקדם (#${laneIndex + 1}/${orderedLanes.length}) כי ${whyEarly.join(' ו')}`
      : `סדר מילוי #${laneIndex + 1} מתוך ${orderedLanes.length}`

  return `${orderHint} · ${qualified} מוסמכים נוכחים · ${INTENSITY_LABELS[lane.intensity]} · תקן ${lane.staffingStandard}`
}

function handoffTierLabel(tier: number): string {
  if (tier === 0) return 'מגיע רק לצהריים — עדיפות כמחליף'
  if (tier === 1) return 'המשיך מבוקר באותה עמדה (אין מחליף צהריים)'
  return 'המשיך מבוקר מעמדה אחרת (אין מחליף צהריים)'
}

/** Human-readable “how long since last visit to this lane”. */
function rotationPlainReason(
  rot: RotationScoreResult,
  visitCount: number,
): string {
  const visitsNote =
    visitCount <= 0
      ? `אין ביקורים ב־${ROTATION_LOOKBACK_DAYS} הימים האחרונים (בוקר/צהריים)`
      : `${visitCount} ביקורים בנתיב ב־${ROTATION_LOOKBACK_DAYS} הימים האחרונים (ללא לילות)`

  if (rot.daysSince == null) {
    return `${visitsNote} — לא הייתה בעמדה זו בחלון · עדיפות גבוהה לרוטציה`
  }
  if (rot.daysSince === 0.5) {
    return `${visitsNote} · ביקור אחרון מוקדם יותר היום — חזרה קצרה; שובצה רק כי אין חלופה טובה יותר למילוי התקן`
  }
  if (rot.daysSince <= SHORT_RETURN_DAYS) {
    return `${visitsNote} · ביקור אחרון לפני ${rot.daysSince} ימים — חזרה קצרה (≤${SHORT_RETURN_DAYS} ימים); שובצה רק אחרי שניסו מועמדים עם מרווח טוב`
  }
  if (rot.daysSince <= 3) {
    return `${visitsNote} · ביקור אחרון לפני ${rot.daysSince} ימים — חזרה יחסית קרובה`
  }
  return `${visitsNote} · ביקור אחרון לפני ${rot.daysSince} ימים — מרווח סביר`
}

function buildPlacementReasons(
  worker: Worker,
  lane: Lane,
  ranked: Worker[],
  rank: number,
  profiles: Map<string, WorkerHistoryProfile>,
  otherOpen: Lane[],
  currentShiftType: ShiftType,
  morning: SameDayMorningContext | null,
  poolSize: number,
  lanePriorityNote: string,
  recoveringIds: Set<string>,
): string[] {
  const reasons: string[] = []
  const p = profiles.get(worker.id)!
  const intensityHe = INTENSITY_LABELS[lane.intensity]
  const recovering = recoveringIds.has(worker.id)
  const rot = rotationScoreFor(p, lane.id)

  reasons.push(lanePriorityNote)

  if (poolSize <= 1) {
    reasons.push('היה המועמד היחיד הפנוי והמוסמך לנתיב')
  } else if (lane.requiredCertifications.length > 0) {
    reasons.push(
      `נבחר מבין ${poolSize} מוסמכים להסמכה הנדרשת (${lane.requiredCertifications.join(', ')})`,
    )
  } else {
    reasons.push(`נבחר מבין ${poolSize} מועמדים פנויים לנתיב`)
  }

  if (lane.afternoonHandoff && currentShiftType === 'afternoon' && morning?.found) {
    const tier = afternoonHandoffTier(worker.id, lane.id, morning)
    reasons.push(`החלפת צהריים: ${handoffTierLabel(tier)}`)
  }

  if (recovering) {
    const managerContinuer =
      worker.isManager &&
      morning?.found &&
      morning.morningWorkerIds.has(worker.id)
    const restLabel = managerContinuer
      ? 'מנהל שממשיך מבוקר לצהריים'
      : 'הגיע אחרי לילה'
    if (lane.intensity === 'hard') {
      reasons.push(
        `${restLabel} (מנוחה בצהריים) — עדיף לא לשבץ לקשה, אבל לא נמצאו מספיק אחרים`,
      )
    } else if (lane.intensity === 'easy') {
      reasons.push(`${restLabel} — עדיפות לעמדה קלה למנוחה`)
    } else {
      const easyLeft = easyStaffingRemaining(otherOpen)
      reasons.push(
        easyLeft > 0
          ? `${restLabel} — נשמר לעמדה קלה אם אפשר; שובץ לבינוני כי לא הייתה חלופה טובה יותר`
          : `${restLabel} — אין עמדה קלה פנויה; בינוני עדיף על קשה`,
      )
    }
  } else if (p.lastShiftType) {
    reasons.push(
      `שיבוץ קודם: משמרת ${SHIFT_TYPE_LABELS[p.lastShiftType]}${
        p.lastWasHard ? ' בעמדה קשה' : ''
      }`,
    )
  }

  reasons.push(rotationPlainReason(rot, p.rotationLaneCounts.get(lane.id) ?? 0))

  // Transparency: better-spaced qualified rival still in the ranked pool below us?
  const betterSpacedLeft = ranked.find((other, i) => {
    if (i <= rank) return false
    const op = profiles.get(other.id)
    if (!op) return false
    return rotationSpacingBetter(op, p, lane.id)
  })
  if (betterSpacedLeft) {
      reasons.push(
      `הייתה חלופה עם מרווח טוב יותר (${betterSpacedLeft.fullName}) — לא נבחרה לנתיב זה בגלל שיקולים קודמים (החלפת צהריים / התאוששות / סדר מילוי / תקן)`,
      )
  } else if (isShortReturnToLane(p, lane.id)) {
      reasons.push(
      `לא נמצאה חלופה מוסמכת פנויה עם מרווח טוב יותר לנתיב זה — מילוי תקן גובר על רוטציה`,
    )
  }

  if (lane.intensity === 'hard') {
    reasons.push(
      p.hardCount === 0
        ? 'עדיין לא קיבל עמדות קשות לאחרונה — מתאים לעמדה קשה'
        : `קיבל ${p.hardCount} עמדות קשות ב־${p.shiftsSeen} משמרות אחרונות — נבחר כי עדיין מאוזן יחסית`,
    )
  } else if (lane.intensity === 'easy') {
    reasons.push(
      p.hardCount > 0
        ? `קיבל ${p.hardCount} עמדות קשות לאחרונה — עדיפות לעמדה קלה למנוחה`
        : 'עמדה קלה; העומס ההיסטורי מאפשר שיבוץ כאן',
    )
  } else {
    reasons.push(
      `עמדה ${intensityHe} — לפי איזון עומס מול שאר הנוכחים (עומס כולל ${fmtLoad(p.load)})`,
    )
  }

  const flex = versatility(worker, otherOpen)
  if (otherOpen.length > 0) {
    const rivalFlex = ranked[rank + 1]
      ? versatility(ranked[rank + 1]!, otherOpen)
      : flex
    const va = Math.floor(flex / VERSATILITY_MIN_GAP)
    const vb = Math.floor(rivalFlex / VERSATILITY_MIN_GAP)
    if (va !== vb && flex < rivalFlex) {
      reasons.push(
        `פחות גמיש לנתיבים שנותרו (מוסמך ל־${flex}) — שובץ קודם כדי לשמור מומחים לנתיבים אחרים`,
      )
    }
  }

  const rival = ranked[rank + 1]
  if (rival) {
    const rp = profiles.get(rival.id)!
    const diffs: string[] = []
    if (
      lane.afternoonHandoff &&
      currentShiftType === 'afternoon' &&
      morning?.found
    ) {
      const ta = afternoonHandoffTier(worker.id, lane.id, morning)
      const tb = afternoonHandoffTier(rival.id, lane.id, morning)
      if (ta !== tb) {
        diffs.push(`מתאים יותר להחלפת צהריים מ${rival.fullName}`)
      }
    }
    const aRec = recoveringIds.has(worker.id)
    const bRec = recoveringIds.has(rival.id)
    if (aRec !== bRec) {
      if (lane.intensity === 'easy' && aRec) {
        diffs.push(`זקוק יותר למנוחה אחרי לילה מ${rival.fullName}`)
      } else if (lane.intensity === 'hard' && !aRec) {
        diffs.push(`${rival.fullName} נשמר למנוחה אחרי לילה`)
      } else if (lane.intensity !== 'easy' && !aRec && bRec) {
        diffs.push(`${rival.fullName} נשמר למנוחה אחרי לילה`)
      }
    }
    const rs = rotationScoreFor(rp, lane.id)
    if (rotationBucket(rot.rawScore) !== rotationBucket(rs.rawScore)) {
      if (rot.rawScore > rs.rawScore) {
          diffs.push(
          rot.daysSince == null
            ? `רחוק יותר מהעמדה הזו מ${rival.fullName} (שלא היה בה / היה בה לאחרונה יותר)`
            : `רחוק יותר מהעמדה הזו מ${rival.fullName}`,
        )
      } else {
        diffs.push(`נבחר למרות ש${rival.fullName} רחוק יותר מהעמדה — בגלל שיקולים אחרים בלוח`)
      }
    }
    const va = Math.floor(versatility(worker, otherOpen) / VERSATILITY_MIN_GAP)
    const vb = Math.floor(versatility(rival, otherOpen) / VERSATILITY_MIN_GAP)
    if (va !== vb && flex < versatility(rival, otherOpen)) {
      diffs.push(
        `${rival.fullName} נשמר לנתיבים אחרים (גמיש יותר)`,
      )
    }
    if (diffs.length > 0) {
      reasons.push(`למה לא ${rival.fullName}: ${diffs.join('; ')}`)
    }
  }

  return reasons
}

/**
 * Rebuild placement explanations from the FINAL board (after optimization).
 * Ranks against all qualified present workers (preference order), not the tiny
 * free-at-end pool — avoids misleading "מועמד יחיד" when the board is full.
 */
function buildFinalBoardExplanations(
  orderedLanes: Lane[],
  finalAssignments: LaneAssignment[],
  presentWorkers: Worker[],
  profiles: Map<string, WorkerHistoryProfile>,
  recoveringIds: Set<string>,
  morning: SameDayMorningContext | null,
  currentShiftType: ShiftType,
  greedyAssignments: LaneAssignment[],
): PlacementExplanation[] {
  const explanations: PlacementExplanation[] = []
  const remainingAfter = new Set(orderedLanes.map((l) => l.id))
  const greedyByLane = new Map(
    greedyAssignments.map((a) => [a.laneId, new Set(a.workerIds.filter(Boolean))]),
  )

  for (let laneIndex = 0; laneIndex < orderedLanes.length; laneIndex++) {
    const lane = orderedLanes[laneIndex]!
    remainingAfter.delete(lane.id)
    const otherOpen = orderedLanes.filter((l) => remainingAfter.has(l.id))
    const assignment = finalAssignments.find((a) => a.laneId === lane.id)
    if (!assignment) continue

    const allQualified = presentWorkers.filter((w) => isQualified(w, lane))
    const ranked = sortCandidatesForLane(allQualified, {
      lane,
      profiles,
      otherOpen,
      currentShiftType,
      morning,
      recoveringIds,
    })

    const lanePriorityNote = explainLanePriority(
      lane,
      orderedLanes,
      laneIndex,
      presentWorkers,
      currentShiftType,
    )
    const greedySet = greedyByLane.get(lane.id) ?? new Set<string>()

    for (const workerId of assignment.workerIds) {
      if (!workerId) continue
      const worker = presentWorkers.find((w) => w.id === workerId)
      if (!worker) continue
      const rank = Math.max(0, ranked.findIndex((w) => w.id === workerId))
      const reasons = buildPlacementReasons(
        worker,
        lane,
        ranked,
        rank,
        profiles,
        otherOpen,
        currentShiftType,
        morning,
        allQualified.length,
        lanePriorityNote,
        recoveringIds,
      )
      if (!greedySet.has(workerId)) {
        reasons.push(
          'הועבר לכאן בסיבוב שיפור של הלוח (החלפה בין עמדות לאיזון טוב יותר)',
        )
      }
      explanations.push({ laneId: lane.id, workerId, reasons })
    }
  }

  return explanations
}

/**
 * Pass 1 — greedy fill by lane priority, with progressive constraint relaxation:
 * 1) soft 14-day rotation threshold
 * 2) night-recovery preference on medium/easy
 * 3) qualification hard-fail warning
 */
function greedyAssignPass(
  orderedLanes: Lane[],
  presentWorkers: Worker[],
  available: Set<string>,
  workerById: Map<string, Worker>,
  profiles: Map<string, WorkerHistoryProfile>,
  recoveringIds: Set<string>,
  morningCtx: SameDayMorningContext | null,
  currentShiftType: ShiftType,
  warnings: string[],
  /** Base seed string; each lane derives its own RNG (tie-break only). */
  tieBreakSeedBase: string,
): {
  assignments: LaneAssignment[]
  understaffedLaneIds: string[]
  explanations: PlacementExplanation[]
  poolSizes: Map<string, number>
  rankedByLane: Map<string, Worker[]>
} {
  const assignments: LaneAssignment[] = []
  const understaffedLaneIds: string[] = []
  const explanations: PlacementExplanation[] = []
  const poolSizes = new Map<string, number>()
  const rankedByLane = new Map<string, Worker[]>()
  const remainingLaneIds = new Set(orderedLanes.map((l) => l.id))

  for (let laneIndex = 0; laneIndex < orderedLanes.length; laneIndex++) {
    const lane = orderedLanes[laneIndex]!
    remainingLaneIds.delete(lane.id)
    const otherOpen = orderedLanes.filter((l) => remainingLaneIds.has(l.id))
    const lanePriorityNote = explainLanePriority(
      lane,
      orderedLanes,
      laneIndex,
      presentWorkers,
      currentShiftType,
    )

    const qualified = [...available]
      .map((id) => workerById.get(id)!)
      .filter((w) => isQualified(w, lane))

    if (qualified.length === 0) {
      assignments.push({ laneId: lane.id, workerIds: [] })
      understaffedLaneIds.push(lane.id)
      warnings.push(
        `אין עובדים מוסמכים לנתיב "${lane.name}" — מגבלת הסמכות מונעת מילוי נתיב חובה`,
      )
      poolSizes.set(lane.id, 0)
      rankedByLane.set(lane.id, [])
      continue
    }

    let relaxNightRecovery = false
    let pool = qualified

    // Prefer rested workers off hard lanes when possible.
    if (lane.intensity === 'hard' && recoveringIds.size > 0) {
      const rested = qualified.filter((w) => !recoveringIds.has(w.id))
      if (rested.length >= lane.staffingStandard) {
        pool = rested
      }
    }

    const rotationPool = applyRotationScorePool(
      pool,
      lane,
      profiles,
      lane.staffingStandard,
    )
    pool = rotationPool.pool
    // Never fully disable rotation ranking — partial soft-floor keeps rawScore order.
    if (rotationPool.avoidedShortReturn) {
      warnings.push(
        `נתיב "${lane.name}" — הועדפו מועמדים עם מרווח מעל ${SHORT_RETURN_DAYS} ימים מהעמדה (נמנעה חזרה קצרה)`,
      )
    }
    if (rotationPool.relaxedShortReturn) {
      warnings.push(
        `נתיב "${lane.name}" — מילוי תקן גובר על רוטציה: לא היו מספיק מוסמכים עם מרווח טוב; הורחב גם למי שחזרו לאחרונה`,
      )
    }
    if (rotationPool.partialFill) {
      warnings.push(
        `נתיב "${lane.name}" — הורחב מאגר המועמדים כי לא היו מספיק עם מרווח טוב מהעמדה`,
      )
    } else {
      const aboveCount = pool.filter(
        (w) =>
          rotationScoreFor(profiles.get(w.id)!, lane.id).score >=
          ROTATION_SOFT_THRESHOLD,
      ).length
      if (aboveCount < lane.staffingStandard && pool.length >= lane.staffingStandard) {
        warnings.push(
          `נתיב "${lane.name}" — הורחב מאגר הרוטציה (אין מספיק מועמדים מעל הסף); הדירוג עדיין לפי רוטציה`,
        )
      }
    }

    // Relax night-recovery preference for medium/easy when still short
    if (
      pool.length < lane.staffingStandard &&
      lane.intensity !== 'hard' &&
      recoveringIds.size > 0
    ) {
      relaxNightRecovery = true
      pool = qualified
      warnings.push(
        `נתיב "${lane.name}" — הורחבה העדפת התאוששות מלילה לנתיב ${INTENSITY_LABELS[lane.intensity]}`,
      )
    }

    // Per-lane derived seed — independent of Math.random; ranking rules unchanged
    const laneRng = createSeededRng(
      hashStringToSeed(`${tieBreakSeedBase}|${lane.id}`),
    )

    const sortOpts: SortCandidatesOptions = {
        lane,
        profiles,
        otherOpen,
        currentShiftType,
      morning: morningCtx,
        recoveringIds,
      relaxRotation: false,
      relaxNightRecovery,
      rng: laneRng,
    }

    const ranked = sortCandidatesForLane(pool, sortOpts)
    const needed = lane.staffingStandard
    const pickedWorkers = ranked.slice(0, needed)
    const picked = pickedWorkers.map((w) => w.id)

    for (const id of picked) available.delete(id)

    assignments.push({ laneId: lane.id, workerIds: picked })
    poolSizes.set(lane.id, qualified.length)
    rankedByLane.set(lane.id, ranked)

    pickedWorkers.forEach((worker, rank) => {
      explanations.push({
        laneId: lane.id,
        workerId: worker.id,
        reasons: buildPlacementReasons(
          worker,
          lane,
          ranked,
          rank,
          profiles,
          otherOpen,
          currentShiftType,
          morningCtx,
          qualified.length,
          lanePriorityNote,
          recoveringIds,
        ),
      })
    })

    if (lane.intensity === 'hard') {
      for (const id of picked) {
        const name = workerById.get(id)?.fullName ?? id
        if (recoveringIds.has(id)) {
          warnings.push(
            `אחרי לילה → קשה בצהריים: "${name}" שובץ בנתיב "${lane.name}" (אין מספיק מועמדים אחרים)`,
          )
        }
      }
    }

      for (const id of picked) {
        const prof = profiles.get(id)
      const D = prof?.daysSinceLastVisit.get(lane.id)
      if (D == null || D > 1) continue
        const name = workerById.get(id)?.fullName ?? id
      const when = D === 0.5 ? 'מוקדם יותר היום' : 'אתמול'
        warnings.push(
        `חזרה קצרה לעמדה: "${name}" שובץ שוב ב"${lane.name}" אחרי שהיה שם ${when} (אין מועמד אחר פנוי / אחרי הרפיה)`,
        )
    }

    if (
      lane.afternoonHandoff &&
      currentShiftType === 'afternoon' &&
      morningCtx?.found
    ) {
      for (const id of picked) {
        const tier = afternoonHandoffTier(id, lane.id, morningCtx)
        if (tier === 1) {
          warnings.push(
            `נתיב "${lane.name}" — ממשיך מבוקר (היה שם בבוקר); לא נמצא מחליף צהריים`,
          )
        } else if (tier === 2) {
          warnings.push(
            `נתיב "${lane.name}" — מולא ע״י ממשיך משמרת ארוכה אחר (אין מחליף צהריים / איש הבוקר לא ממשיך)`,
          )
        }
      }
    }

    if (picked.length < needed) {
      understaffedLaneIds.push(lane.id)
      warnings.push(
        `נתיב "${lane.name}" דורש ${needed} בודקים מוסמכים, שובצו ${picked.length}`,
      )
    }
  }

  return {
    assignments,
    understaffedLaneIds,
    explanations,
    poolSizes,
    rankedByLane,
  }
}

export function runAssignmentAlgorithm(
  activeLanes: Lane[],
  presentWorkers: Worker[],
  history: ShiftSchedule[],
  allLanes: Lane[],
  ctx?: AssignmentContext,
): AssignmentResult {
  const warnings: string[] = []

  // --- Edge cases ---
  if (activeLanes.length === 0) {
    return {
      assignments: [],
      unassignedWorkerIds: presentWorkers.map((w) => w.id),
      understaffedLaneIds: [],
      warnings: ['אין עמדות פעילות לשיבוץ'],
      explanations: [],
    }
  }
  if (presentWorkers.length === 0) {
    return {
      assignments: activeLanes.map((l) => ({ laneId: l.id, workerIds: [] })),
      unassignedWorkerIds: [],
      understaffedLaneIds: activeLanes.map((l) => l.id),
      warnings: ['אין עובדים נוכחים לשיבוץ'],
      explanations: [],
    }
  }

  const available = new Set(presentWorkers.map((w) => w.id))
  const workerById = new Map(presentWorkers.map((w) => [w.id, w]))

  const currentDate = ctx?.date ?? '9999-12-31'
  const currentShiftType = ctx?.shiftType ?? 'morning'
  const lookbackDays = Math.max(
    ctx?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    ROTATION_LOOKBACK_DAYS,
  )
  const maxPasses =
    ctx?.maxOptimizationPasses ?? DEFAULT_MAX_OPTIMIZATION_PASSES

  const tieBreakSeedBase = String(
    ctx?.rngSeed ?? `${currentDate}|${currentShiftType}`,
  )

  const morningCtx =
    currentShiftType === 'afternoon'
      ? buildSameDayMorningContext(history, currentDate)
      : null

  if (
    currentShiftType === 'afternoon' &&
    activeLanes.some((l) => l.afternoonHandoff) &&
    !morningCtx?.found
  ) {
    warnings.push(
      'אין שיבוץ בוקר שמור להיום — כללי החלפת צהריים (מכס) פועלים חלקית בלבד',
    )
  }

  const profiles = new Map<string, WorkerHistoryProfile>()
  for (const w of presentWorkers) {
    profiles.set(
      w.id,
      buildWorkerProfile(
        w.id,
        history,
        allLanes,
        currentShiftType,
        currentDate,
        lookbackDays,
      ),
    )
  }

  const recoveringIds = new Set<string>()
  const morningCtxForRecovery =
    currentShiftType === 'afternoon'
      ? buildSameDayMorningContext(history, currentDate)
      : null
  if (currentShiftType === 'afternoon') {
    for (const w of presentWorkers) {
      if (
        needsAfternoonNightRecovery(w.id, history, currentDate, currentShiftType)
      ) {
        recoveringIds.add(w.id)
        continue
      }
      // Managers continuing morning→afternoon get the same easy-lane preference
      // as night recovery (long day → prefer lighter afternoon placement).
      if (
        w.isManager &&
        morningCtxForRecovery?.found &&
        morningCtxForRecovery.morningWorkerIds.has(w.id)
      ) {
        recoveringIds.add(w.id)
      }
    }
  }

  const intensityOrder: Record<Intensity, number> = { hard: 0, medium: 1, easy: 2 }

  const orderedLanes = [...activeLanes].sort((a, b) => {
    if (currentShiftType === 'afternoon') {
      const aH = a.afternoonHandoff ? 0 : 1
      const bH = b.afternoonHandoff ? 0 : 1
      if (aH !== bH) return aH - bH
    }

    const aOpen = a.requiredCertifications.length === 0 ? 1 : 0
    const bOpen = b.requiredCertifications.length === 0 ? 1 : 0
    if (aOpen !== bOpen) return aOpen - bOpen

    const qa = presentWorkers.filter((w) => isQualified(w, a)).length
    const qb = presentWorkers.filter((w) => isQualified(w, b)).length
    if (qa !== qb) return qa - qb

    if (intensityOrder[a.intensity] !== intensityOrder[b.intensity]) {
      return intensityOrder[a.intensity] - intensityOrder[b.intensity]
    }
    return b.staffingStandard - a.staffingStandard
  })

  // Phase 1 — priority greedy with relaxation hierarchy
  const pass1 = greedyAssignPass(
    orderedLanes,
    presentWorkers,
    available,
    workerById,
    profiles,
    recoveringIds,
    morningCtx,
    currentShiftType,
    warnings,
    tieBreakSeedBase,
  )

  const greedyBaseline = cloneAssignments(pass1.assignments)

  // Phase 2+ — multi-pass local search on global board objective
  const optimized = runMultiPassOptimization({
    assignments: pass1.assignments,
    unassignedWorkerIds: [...available],
    lanes: activeLanes,
    workersById: workerById,
    profiles,
    maxPasses,
    recoveringIds,
    morning: morningCtx,
    currentShiftType,
    baselineAssignments: greedyBaseline,
  })

  if (optimized.swapsPerformed > 0) {
    warnings.push(
      `שיפור לוח: ${optimized.swapsPerformed} החלפות ב־${optimized.passesRun} סיבובים` +
        (optimized.improvingPassesAfterFirst > 0
          ? ` · ${optimized.improvingPassesAfterFirst} שיפורים אחרי הסיבוב הראשון`
          : ''),
    )
  }

  const finalAssignments = optimized.assignments
  const assignedIds = new Set(
    finalAssignments.flatMap((a) => a.workerIds.filter(Boolean)),
  )

  const explanations = buildFinalBoardExplanations(
    orderedLanes,
    finalAssignments,
    presentWorkers,
    profiles,
    recoveringIds,
    morningCtx,
    currentShiftType,
    greedyBaseline,
  )

  const unassigned = presentWorkers
    .map((w) => w.id)
    .filter((id) => !assignedIds.has(id))

  const understaffedLaneIds: string[] = []
  for (const lane of activeLanes) {
    const filled =
      finalAssignments
        .find((a) => a.laneId === lane.id)
        ?.workerIds.filter(Boolean).length ?? 0
    if (filled < lane.staffingStandard) understaffedLaneIds.push(lane.id)
  }

  const emptyLanes = finalAssignments.filter((a) => a.workerIds.length === 0)
  if (emptyLanes.length > 0 && unassigned.length > 0) {
    for (const a of emptyLanes) {
      const lane = activeLanes.find((l) => l.id === a.laneId)
      if (!lane) continue
      const anyMatch = unassigned.some((id) => {
        const w = workerById.get(id)
        return w ? isQualified(w, lane) : false
      })
      if (!anyMatch) {
        warnings.push(
          `נתיב "${lane.name}" נשאר ריק — לנוכחים הנותרים אין את ההסמכות הנדרשות`,
        )
      }
    }
  }

  return {
    assignments: finalAssignments,
    unassignedWorkerIds: unassigned,
    understaffedLaneIds,
    warnings: [...new Set(warnings)],
    explanations,
  }
}

export function computeWorkerLaneStats(
  workers: Worker[],
  lanes: Lane[],
  history: ShiftSchedule[],
  options?: { fromDate?: string; toDate?: string },
): WorkerLaneStats[] {
  const laneMap = new Map(lanes.map((l) => [l.id, l]))
  const filtered = history.filter((h) => {
    if (options?.fromDate && h.date < options.fromDate) return false
    if (options?.toDate && h.date > options.toDate) return false
    return true
  })

  return workers.map((w) => {
    const byLane: Record<string, number> = {}
    for (const lane of lanes) byLane[lane.id] = 0

    let hardCount = 0
    let mediumCount = 0
    let easyCount = 0
    let dayEasyCount = 0
    let nightEasyCount = 0
    let totalAssignments = 0
    const hardByShift: Record<ShiftType, number> = { ...EMPTY_HARD_BY_SHIFT }

    for (const shift of filtered) {
      // Position / lane summary: day shifts only (nights excluded).
      if (shift.shiftType === 'night') continue

      for (const assignment of shift.assignments) {
        if (!assignment.workerIds.includes(w.id)) continue
        byLane[assignment.laneId] = (byLane[assignment.laneId] ?? 0) + 1
        totalAssignments += 1
        const lane = laneMap.get(assignment.laneId)
        if (!lane) continue

        if (lane.intensity === 'hard') {
          hardCount += 1
          hardByShift[shift.shiftType] += 1
        } else if (lane.intensity === 'medium') {
          mediumCount += 1
        } else {
          easyCount += 1
          dayEasyCount += 1
        }
      }
    }

    const dates = filtered.map((h) => h.date).sort()
    const from = options?.fromDate ?? dates[0]
    const to = options?.toDate ?? dates[dates.length - 1]
    const effectiveLoad =
      from && to
        ? accumulateLoadWithRestDecay(
            w.id,
            groupShiftsByDate(dedupeShiftsByDateAndType(filtered)),
            laneMap,
            from,
            to,
            { includeNight: false },
          )
        : 0

    return {
      workerId: w.id,
      byLane,
      hardCount,
      mediumCount,
      easyCount,
      dayEasyCount,
      nightEasyCount,
      effectiveLoad,
      hardByShift,
      totalAssignments,
    }
  })
}
