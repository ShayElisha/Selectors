import {
  countsAsDayEasy,
  effectiveIntensityScore,
  INTENSITY_LABELS,
  SHIFT_TYPE_LABELS,
} from './constants'
import { formatShiftDate } from './lib/hebrew'
import { shiftPlacements } from './lib/shiftPlacements'
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
  /** Max load minus min load among people placed on this board. */
  loadSpread?: number
  /** Filled seats on hard lanes. */
  hardSeats?: number
  /** Hard seats filled by someone at or above the group's median hard-lane count. */
  experiencedHardSeats?: number
  /** Search telemetry: starts run and board evaluations performed. */
  searchStats?: { starts: number; evaluations: number; passes: number }
}

/** Soft goal for a generated board. Hard rules stay the same. */
export type AssignmentObjective = 'standard' | 'loadFair' | 'hardExperience'

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
  /**
   * Which soft goal the board should chase, after the hard safety rules.
   * Missing means the usual mix of rotation, load, and hard-lane balance.
   */
  objective?: AssignmentObjective
  /**
   * Full roster, including people who are absent today.
   * Used to name whoever sat a lane last, even if they are not present now.
   */
  roster?: Worker[]
}

export interface WorkerLaneStats {
  workerId: string
  /** laneId → shift-equivalents (a selector round counts as its share of the shift) */
  byLane: Record<string, number>
  hardCount: number
  mediumCount: number
  /** Raw easy lane placements (includes night easy) */
  easyCount: number
  /** Easy only on morning/afternoon — real "rest" credit */
  dayEasyCount: number
  /** Easy placements on night (not treated as rest) */
  nightEasyCount: number
  /**
   * Balance over the last 14 days in the range.
   * Medium day = 0, hard day = +2, day off = −2, hard night = +4. Floor −2.
   */
  effectiveLoad: number
  /** Points the balance actually rose in that window */
  loadRose: number
  /** Points the balance actually fell in that window */
  loadFell: number
  /** Morning balance over the last 14 days. Not mixed with afternoon. */
  morningLoad: number
  /** Afternoon balance, including צהריים א and צהריים ב. */
  afternoonLoad: number
  /** Night balance, kept apart from the day shifts. */
  nightLoad: number
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
   * Most recent seating of each lane inside the rotation window.
   * Ranking treats a match with that person as a real rotation check.
   */
  lastSeatings?: Map<string, LaneLastSeating>
  /**
   * RNG for Fisher–Yates tie-break shuffle only.
   * Ranking comparator is unchanged; RNG only orders equal candidates before sort.
   */
  rng?: () => number
  objective?: AssignmentObjective
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
  objective?: AssignmentObjective
  weights?: Partial<Record<keyof typeof DEFAULT_BOARD_WEIGHTS, number>>
  /** Most recent seating per lane. Repeating that person is counted on the board. */
  lastSeatings?: Map<string, LaneLastSeating>
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
  /** Board evaluations performed inside this optimization run. */
  evaluations: number
}

/** Soft objective weights for evaluateBoard (sum ≈ 1). */
export const DEFAULT_BOARD_WEIGHTS = {
  /** Dominant when staffing is equal — prefer who was on the lane longest ago. */
  rotation: 0.36,
  workload: 0.11,
  recovery: 0.15,
  hardBalance: 0.07,
  handoff: 0.08,
  versatility: 0.03,
  intensityDist: 0.03,
  /** Idle (rested) people on hard lanes — kept inside the ≈1 budget. */
  idleOnHard: 0.03,
  /** Still secondary to lexicographic staffing-first. */
  staffing: 0.11,
  stability: 0.03,
} as const

/** Same keys, with load balance outweighing rotation. */
export const LOAD_FAIR_BOARD_WEIGHTS = {
  rotation: 0.14,
  workload: 0.4,
  recovery: 0.12,
  hardBalance: 0.08,
  handoff: 0.08,
  versatility: 0.02,
  intensityDist: 0.02,
  idleOnHard: 0.02,
  staffing: 0.1,
  stability: 0.02,
} as const

/**
 * Same keys. `hardBalance` is rewritten to "experienced people on hard lanes"
 * when the objective is hardExperience.
 */
export const HARD_EXPERIENCE_BOARD_WEIGHTS = {
  rotation: 0.12,
  workload: 0.06,
  recovery: 0.12,
  hardBalance: 0.36,
  handoff: 0.08,
  versatility: 0.02,
  intensityDist: 0.02,
  idleOnHard: 0.02,
  staffing: 0.18,
  stability: 0.02,
} as const

export function weightsForObjective(objective: AssignmentObjective = 'standard') {
  if (objective === 'loadFair') return LOAD_FAIR_BOARD_WEIGHTS
  if (objective === 'hardExperience') return HARD_EXPERIENCE_BOARD_WEIGHTS
  return DEFAULT_BOARD_WEIGHTS
}

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
  /** Short returns specifically onto hard lanes (stronger than idle-on-hard). */
  shortReturnOnHard: number
  /**
   * Hard-lane seats given again to whoever sat that lane most recently.
   * Lower is better, and this beats the idle-on-hard preference.
   */
  lastOccupantOnHard: number
  /**
   * Seats on any lane given again to whoever sat there most recently.
   * Lower is better. Checked after idle-on-hard so a light lane does not
   * pull a rested person off a hard seat.
   */
  lastOccupantRepeats: number
  recoveryOnHard: number
  /**
   * Idle workers (≥ IDLE_HARD_REST_DAYS off) seated on hard lanes.
   * Higher is better — keeps rested people on hard through optimization.
   */
  idleOnHard: number
  minDaysSince: number
  totalRotation: number
}

const DEFAULT_LOOKBACK_DAYS = 14
/** Rotation scoring window in calendar days (Maximum Distance Strategy). */
export const ROTATION_LOOKBACK_DAYS = 14
/**
 * How many calendar days the workload balance looks back.
 * Older days leave the window, so the number cannot grow forever.
 */
export const LOAD_BALANCE_DAYS = 14
/** A fully rested person sits here; extra days off do not add more credit. */
export const LOAD_BALANCE_FLOOR = -2
/** Change on a calendar day with no real work (no placement / not gate manager). */
const LOAD_OFF_DAY = -2
/**
 * Subtracted from each day-easy placement score so easy morning/afternoon
 * adds less than a full point (net ≈ +0.5 instead of +1).
 */
export const DAY_EASY_LOAD_CREDIT = 0.5
/** Soft floor: candidates below this score are filtered when alternatives exist. */
const ROTATION_SOFT_THRESHOLD = 40
/** Bucket width for rotation ranking — lets load/hard compete inside a band. */
const ROTATION_SCORE_BUCKET = 5
/**
 * Short return to the same lane (day shifts): avoid when a better-spaced
 * qualified alternative exists. Also used for board warnings.
 */
export const SHORT_RETURN_DAYS = 2
/**
 * On a hard lane, prefer someone whose recent load is lower by at least this
 * many points (about two weeks). Smaller gaps stay with rotation and hard-count balance.
 */
export const IDLE_HARD_LOAD_GAP = 1.5
/**
 * On a hard lane, prefer someone who has not worked for this many calendar days
 * (or longer). ~4–5 days of rest is enough to pull them toward a hard seat when
 * they are qualified; shorter gaps stay with load / rotation.
 */
export const IDLE_HARD_REST_DAYS = 4
/** Multi-pass local-search iteration cap. */
const DEFAULT_MAX_OPTIMIZATION_PASSES = 320
/**
 * Starts used by the async progress runner when the caller does not pass
 * `searchStarts` — several tie-break seeds, each fully optimized, so the UI
 * can honestly show thousands of board checks with progress.
 */
export const DEFAULT_PROGRESS_SEARCH_STARTS = 12
/**
 * A person who sat a lane most recently stays "the last one" for this many
 * calendar days. Inside the window, another qualified person is preferred.
 */
export const LAST_OCCUPANT_WINDOW_DAYS = ROTATION_LOOKBACK_DAYS
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
  afternoonA: 1.0,
  afternoonB: 1.0,
}

/** Chronological order within a calendar day (for same-day D = 0.5). */
const SHIFT_SEQUENCE: Record<ShiftType, number> = {
  morning: 0,
  afternoon: 1,
  afternoonA: 1,
  afternoonB: 2,
  night: 3,
}

const EMPTY_HARD_BY_SHIFT: Record<ShiftType, number> = {
  morning: 0,
  afternoon: 0,
  afternoonA: 0,
  afternoonB: 0,
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
  const required = lane.requiredCertifications ?? []
  if (required.length === 0) return true
  const held = worker.certifications ?? []
  return required.every((c) => held.includes(c))
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
  /**
   * Calendar days since the worker last actually worked any shift
   * (placement or gate manager). null = no duty in the lookback window.
   * 0.5 = earlier today.
   */
  daysSinceLastDuty: number | null
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

/**
 * The latest people who actually sat a lane, inside the rotation window.
 * Selector rounds count: the latest round on that shift wins, not the first.
 */
export interface LaneLastSeating {
  laneId: string
  workerIds: string[]
  date: string
  shiftType: ShiftType
  /** Calendar days before the board. 0.5 means an earlier shift today. */
  daysSince: number
  roundLabel: string | null
}

interface SeatingRecency {
  date: string
  seq: number
  roundIndex: number
}

function seatingIsLater(next: SeatingRecency, prev: SeatingRecency): boolean {
  if (next.date !== prev.date) return next.date > prev.date
  if (next.seq !== prev.seq) return next.seq > prev.seq
  return next.roundIndex > prev.roundIndex
}

function sameSeatingMoment(a: SeatingRecency, b: SeatingRecency): boolean {
  return a.date === b.date && a.seq === b.seq && a.roundIndex === b.roundIndex
}

/**
 * Who sat each lane last, from saved boards and from selector rounds.
 * Same-day shifts that already happened are included as daysSince = 0.5.
 */
export function buildLaneLastSeatings(
  history: ShiftSchedule[],
  currentDate: string,
  currentShiftType: ShiftType,
  lookbackDays: number = LAST_OCCUPANT_WINDOW_DAYS,
): Map<string, LaneLastSeating> {
  const windowDays = Math.max(lookbackDays, LAST_OCCUPANT_WINDOW_DAYS)
  type Acc = {
    key: SeatingRecency
    workers: Set<string>
    shiftType: ShiftType
    daysSince: number
    roundLabel: string | null
  }
  const best = new Map<string, Acc>()

  const consider = (shift: ShiftSchedule, daysSince: number) => {
    if (!Number.isFinite(daysSince) || daysSince > windowDays) return
    for (const placement of shiftPlacements(shift)) {
      if (!placement.workerId || !placement.laneId) continue
      const key: SeatingRecency = {
        date: shift.date,
        seq: SHIFT_SEQUENCE[shift.shiftType],
        roundIndex: placement.roundIndex ?? 0,
      }
      const prev = best.get(placement.laneId)
      if (!prev || seatingIsLater(key, prev.key)) {
        best.set(placement.laneId, {
          key,
          workers: new Set([placement.workerId]),
          shiftType: shift.shiftType,
          daysSince,
          roundLabel: placement.roundLabel ?? null,
        })
      } else if (sameSeatingMoment(key, prev.key)) {
        prev.workers.add(placement.workerId)
      }
    }
  }

  for (const shift of filterRelevantHistory(history, currentDate, windowDays)) {
    consider(shift, daysBetweenLocal(shift.date, currentDate))
  }
  for (const shift of dedupeShiftsByDateAndType(
    history.filter(
      (item) =>
        item.date === currentDate &&
        SHIFT_SEQUENCE[item.shiftType] < SHIFT_SEQUENCE[currentShiftType],
    ),
  )) {
    consider(shift, 0.5)
  }

  const out = new Map<string, LaneLastSeating>()
  for (const [laneId, row] of best) {
    out.set(laneId, {
      laneId,
      workerIds: [...row.workers],
      date: row.key.date,
      shiftType: row.shiftType,
      daysSince: row.daysSince,
      roundLabel: row.roundLabel,
    })
  }
  return out
}

/** True when this worker is among the people who sat the lane most recently. */
export function isLastLaneOccupant(
  workerId: string,
  laneId: string,
  lastSeatings: Map<string, LaneLastSeating> | undefined,
): boolean {
  if (!lastSeatings) return false
  const seating = lastSeatings.get(laneId)
  if (!seating) return false
  if (seating.daysSince > LAST_OCCUPANT_WINDOW_DAYS) return false
  return seating.workerIds.includes(workerId)
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

/**
 * True when the worker actually worked the shift for load / recovery.
 * Presence alone does not count — continuers marked נוכח without a seat
 * were blocking the −2 rest day and making load only rise.
 */
function workerAssignedOnShift(
  workerId: string,
  shift: ShiftSchedule,
): boolean {
  if (shift.gateManagerWorkerId?.trim() === workerId) return true
  return shiftPlacements(shift).some((p) => p.workerId === workerId)
}

/** True when the worker worked (placement or gate manager) on any shift that day. */
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
  /**
   * Morning, afternoon (including א/ב), and night each keep their own balance.
   * A day without that shift is a rest day for that balance only.
   */
  family?: LoadShiftFamily
}

export type LoadShiftFamily = 'morning' | 'afternoon' | 'night'

export function shiftLoadFamily(shiftType: ShiftType): LoadShiftFamily {
  if (shiftType === 'night') return 'night'
  if (shiftType === 'morning') return 'morning'
  return 'afternoon'
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
    for (const placement of shiftPlacements(shift)) {
      if (placement.workerId !== workerId) continue
      const lane = laneMap.get(placement.laneId)
      if (!lane) continue
      points +=
        placementScoreForLoad(lane.intensity, shift.shiftType) *
        placement.weight
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
 * Load points for one placement.
 * Morning is heavier than the same lane in the afternoon.
 * Night stays on its own scale. Selector rounds of one shift share one shift:
 * weight is the round's fraction of that shift.
 */
export function shiftBalanceDelta(
  intensity: Lane['intensity'],
  shiftType: ShiftType,
): number {
  if (shiftType === 'night') {
    if (intensity === 'hard') return 4
    if (intensity === 'medium') return 2
    return 1
  }
  const afternoon =
    shiftType === 'afternoon' ||
    shiftType === 'afternoonA' ||
    shiftType === 'afternoonB'
  if (afternoon) {
    if (intensity === 'hard') return 2
    if (intensity === 'medium') return 1
    return 0.5
  }
  if (intensity === 'hard') return 3.5
  if (intensity === 'medium') return 2
  return 1
}

export type LoadBalance = {
  net: number
  rose: number
  fell: number
}

function applyBalanceStep(state: LoadBalance, delta: number) {
  const next = state.net + delta
  const clamped = next < LOAD_BALANCE_FLOOR ? LOAD_BALANCE_FLOOR : next
  const applied = clamped - state.net
  if (applied > 0) state.rose += applied
  else if (applied < 0) state.fell += -applied
  state.net = clamped
}

function roundLoad(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Balance over calendar days in the range, capped at the last LOAD_BALANCE_DAYS.
 * A day off is −2. A placed shift adds its delta (rounds add their share).
 * The number never goes below LOAD_BALANCE_FLOOR, and days that cannot move
 * it are not counted as extra rise or fall.
 */
export function accumulateLoadBalance(
  workerId: string,
  shiftsByDate: Map<string, ShiftSchedule[]>,
  laneMap: Map<string, Lane>,
  fromDate: string,
  toDate: string,
  filter?: DayLoadFilter,
): LoadBalance {
  const state: LoadBalance = { net: 0, rose: 0, fell: 0 }
  if (!fromDate || !toDate || fromDate > toDate) return state
  const capStart = addLocalDaysISO(toDate, -(LOAD_BALANCE_DAYS - 1))
  const start = fromDate > capStart ? fromDate : capStart
  for (const date of eachLocalDateInclusive(start, toDate)) {
    const dayShifts = shiftsByDate.get(date) ?? []
    const counted = filter?.family
      ? dayShifts.filter((shift) => shiftLoadFamily(shift.shiftType) === filter.family)
      : dayShifts
    if (!workerOnDutyThatDay(workerId, counted)) {
      applyBalanceStep(state, LOAD_OFF_DAY)
      continue
    }
    let dayDelta = 0
    for (const shift of counted) {
      if (filter?.includeNight === false && shift.shiftType === 'night') {
        continue
      }
      if (filter?.onlyShiftType && shift.shiftType !== filter.onlyShiftType) {
        continue
      }
      for (const placement of shiftPlacements(shift)) {
        if (placement.workerId !== workerId) continue
        const lane = laneMap.get(placement.laneId)
        if (!lane) continue
        dayDelta +=
          shiftBalanceDelta(lane.intensity, shift.shiftType) * placement.weight
      }
    }
    applyBalanceStep(state, dayDelta)
  }
  return {
    net: roundLoad(state.net),
    rose: roundLoad(state.rose),
    fell: roundLoad(state.fell),
  }
}

/** Net workload balance. Same rules as {@link accumulateLoadBalance}. */
export function accumulateLoadWithRestDecay(
  workerId: string,
  shiftsByDate: Map<string, ShiftSchedule[]>,
  laneMap: Map<string, Lane>,
  fromDate: string,
  toDate: string,
  filter?: DayLoadFilter,
): number {
  return accumulateLoadBalance(
    workerId,
    shiftsByDate,
    laneMap,
    fromDate,
    toDate,
    filter,
  ).net
}

/**
 * Night dated D (starts evening D) → recovery on every afternoon shift of D+1.
 */
export function isAfternoonShift(shiftType: ShiftType): boolean {
  return (
    shiftType === 'afternoon' ||
    shiftType === 'afternoonA' ||
    shiftType === 'afternoonB'
  )
}

/**
 * Night recovery applies on the afternoon shifts of the calendar day after a night shift.
 */
export function needsAfternoonNightRecovery(
  workerId: string,
  history: ShiftSchedule[],
  currentDate: string,
  currentShiftType: ShiftType,
): boolean {
  if (!isAfternoonShift(currentShiftType)) {
    return false
  }
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

/** True when the worker has been off duty long enough to prefer a hard seat. */
export function isIdleForHardLane(profile: WorkerHistoryProfile): boolean {
  if (profile.daysSinceLastDuty == null) return true
  return profile.daysSinceLastDuty >= IDLE_HARD_REST_DAYS
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
    daysSinceLastDuty: null,
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

    const workedDuty =
      shift.gateManagerWorkerId?.trim() === workerId ||
      shiftPlacements(shift).some((p) => p.workerId === workerId)
    if (workedDuty) {
      if (
        profile.daysSinceLastDuty == null ||
        daysSince < profile.daysSinceLastDuty
      ) {
        profile.daysSinceLastDuty = daysSince
      }
    }

    const seenLanes = new Set<string>()
    for (const placement of shiftPlacements(shift)) {
      if (placement.workerId !== workerId) continue
      const lane = laneMap.get(placement.laneId)
      if (!lane || seenLanes.has(lane.id)) continue
      seenLanes.add(lane.id)
      placements.push(lane)

      if (prevDate && shift.date === prevDate) {
        profile.prevCalendarDayLaneIds.add(lane.id)
      }

      // Lane rotation: every shift type and the latest selector round.
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

  // Each shift family keeps its own 14-day balance.
  const windowStart = addLocalDaysISO(currentDate, -windowDays)
  const family = shiftLoadFamily(currentShiftType)
  if (prevDate && windowStart <= prevDate) {
    const byDate = groupShiftsByDate(lookback)
    const familyLoad = accumulateLoadBalance(
      workerId,
      byDate,
      laneMap,
      windowStart,
      prevDate,
      { family },
    ).net
    profile.load = familyLoad
    profile.loadInSameShiftType = familyLoad
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
  let sameDayDelta = 0
  for (const shift of sameDayEarlier) {
    const placements: Lane[] = []
    const seenLanes = new Set<string>()
    for (const placement of shiftPlacements(shift)) {
      if (placement.workerId !== workerId) continue
      const lane = laneMap.get(placement.laneId)
      if (!lane) continue
      if (shiftLoadFamily(shift.shiftType) === family) {
        sameDayDelta +=
          shiftBalanceDelta(lane.intensity, shift.shiftType) * placement.weight
      }
      if (seenLanes.has(lane.id)) continue
      seenLanes.add(lane.id)
      placements.push(lane)
      recordLaneVisit(lane, shift.shiftType, 0.5, -1)
      if (lane.intensity === 'hard') {
        profile.hardCount += 1
      }
      if (countsAsDayEasy(lane.intensity, shift.shiftType)) {
        profile.dayEasyCount += 1
      }
    }

    if (
      shift.gateManagerWorkerId?.trim() === workerId ||
      placements.length > 0
    ) {
      profile.daysSinceLastDuty = 0.5
    }

    if (placements.length === 0) continue

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

  profile.load = Math.max(LOAD_BALANCE_FLOOR, profile.load + sameDayDelta)
  profile.load = Math.round(profile.load * 10) / 10
  profile.loadInSameShiftType =
    Math.round(profile.loadInSameShiftType * 10) / 10

  return profile
}

/**
 * Ranking for a lane (lower compare result = better). Order:
 * 1) afternoon handoff
 * 2) night→afternoon recovery (ahead of rotation, so last night's worker gets the lighter lane)
 * 3) short-return avoidance (almost-hard when alternatives exist in sort set)
 * 4) standard objective: do not repeat whoever sat this lane last
 * 5) hard lanes: idle ≥ IDLE_HARD_REST_DAYS, then clearly lower recent load
 * 6) Maximum Distance rotation — raw score (not continuous)
 * 7) load / hard balance by intensity (relative hard rate)
 * 8) versatility buckets (transitive)
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
    lastSeatings,
  } = opts
  const pa = profiles.get(a.id)!
  const pb = profiles.get(b.id)!

  if (lane.afternoonHandoff && currentShiftType === 'afternoon') {
    const ta = afternoonHandoffTier(a.id, lane.id, morning)
    const tb = afternoonHandoffTier(b.id, lane.id, morning)
    if (ta !== tb) return ta - tb
    // Strong rotation inside the same tier: whoever was LAST at this exact
    // seat wins, decided before any convenience preference (recovery,
    // short-return heuristic, load) — so the algorithm does not just place
    // whoever is comfortable.
    const handoffRa = rotationScoreFor(pa, lane.id).rawScore
    const handoffRb = rotationScoreFor(pb, lane.id).rawScore
    if (Math.abs(handoffRa - handoffRb) > 1) return handoffRb - handoffRa
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

  if (!relaxRotation) {
    const aShort = isShortReturnToLane(pa, lane.id) ? 1 : 0
    const bShort = isShortReturnToLane(pb, lane.id) ? 1 : 0
    if (aShort !== bShort) return aShort - bShort
  }

  const objective = opts.objective ?? 'standard'

  // Explicit match against the last person on THIS lane. Runs before comfort
  // preferences (idle, load) so a rested person is not sent back to the seat
  // they just left when someone else is qualified.
  if (!relaxRotation && objective === 'standard') {
    const aLast = isLastLaneOccupant(a.id, lane.id, lastSeatings) ? 1 : 0
    const bLast = isLastLaneOccupant(b.id, lane.id, lastSeatings) ? 1 : 0
    if (aLast !== bLast) return aLast - bLast
  }

  if (objective === 'loadFair' && pa.load !== pb.load) {
    return pa.load - pb.load
  }

  if (objective === 'hardExperience' && lane.intensity === 'hard') {
    if (pa.hardCount !== pb.hardCount) return pb.hardCount - pa.hardCount
    const aRate = pa.hardCount / Math.max(1, pa.shiftsSeen)
    const bRate = pb.hardCount / Math.max(1, pb.shiftsSeen)
    if (Math.abs(aRate - bRate) > 1e-9) return bRate - aRate
  } else if (lane.intensity === 'hard') {
    const idleA = isIdleForHardLane(pa)
    const idleB = isIdleForHardLane(pb)
    if (idleA !== idleB) return idleA ? -1 : 1
    const loadGap = pa.load - pb.load
    if (Math.abs(loadGap) >= IDLE_HARD_LOAD_GAP) return loadGap
  }

  if (!relaxRotation) {
    // Longer gap (or never on this lane) beats load balance when the gap is real.
    const ra = rotationScoreFor(pa, lane.id).rawScore
    const rb = rotationScoreFor(pb, lane.id).rawScore
    if (Math.abs(ra - rb) > 1) return rb - ra
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
  weights?: Partial<Record<keyof typeof DEFAULT_BOARD_WEIGHTS, number>>
  objective?: AssignmentObjective
  /** Most recent seating per lane, used to count repeat-the-last-person seats. */
  lastSeatings?: Map<string, LaneLastSeating>
}

/**
 * 0–100. Higher when the people sitting on hard lanes already have more hard-lane history.
 */
function hardLaneExperienceScore(
  placements: { lane: Lane; profile: WorkerHistoryProfile }[],
  profiles: Map<string, WorkerHistoryProfile>,
): number {
  const hardOnes = placements.filter((item) => item.lane.intensity === 'hard')
  if (hardOnes.length === 0) return 100
  const maxHard = Math.max(1, ...[...profiles.values()].map((profile) => profile.hardCount))
  const average =
    hardOnes.reduce((sum, item) => sum + item.profile.hardCount, 0) / hardOnes.length
  return clamp01to100((average / maxHard) * 100)
}

/**
 * Global board objective. HARD CONSTRAINT violations → legal=false, score=-Infinity.
 * Soft components are 0–100 (higher better), then weighted.
 */
export function evaluateBoard(
  assignments: LaneAssignment[],
  ctx: EvaluateBoardContext,
): BoardEvaluation {
  const weights = { ...weightsForObjective(ctx.objective), ...ctx.weights }
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
  let shortReturnOnHard = 0
  let lastOccupantOnHard = 0
  let lastOccupantRepeats = 0
  const countLastOccupant =
    (ctx.objective ?? 'standard') === 'standard' && ctx.lastSeatings != null
  let rotSum = 0
  let recoveryOnHard = 0
  let idleOnHard = 0
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
    if (isShortReturnToLane(profile, lane.id)) {
      shortReturnCount += 1
      if (lane.intensity === 'hard') shortReturnOnHard += 1
    }
    if (
      countLastOccupant &&
      isLastLaneOccupant(workerId, lane.id, ctx.lastSeatings)
    ) {
      lastOccupantRepeats += 1
      if (lane.intensity === 'hard') lastOccupantOnHard += 1
    }

    const projectedLoad = Math.max(
      LOAD_BALANCE_FLOOR,
      profile.load +
        shiftBalanceDelta(lane.intensity, ctx.currentShiftType),
    )
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
    if (
      lane.intensity === 'hard' &&
      !ctx.recoveringIds.has(workerId) &&
      isIdleForHardLane(profile)
    ) {
      idleOnHard += 1
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
    hardBalance:
      ctx.objective === 'hardExperience'
        ? hardLaneExperienceScore(placements, ctx.profiles)
        : hardBalance,
    handoff,
    versatility: versatilityScore,
    intensityDist,
    idleOnHard,
    staffing,
    stability,
  }

  let score = 0
  for (const key of Object.keys(weights) as BoardWeightKey[]) {
    score += components[key] * weights[key]
  }
  // Extra hard pull for missing required slots (beyond staffing component)
  score -= understaffedSlots * 4
  if (ctx.objective !== 'hardExperience') {
    score += idleHardPlacementAdjust(placements, ctx)
  }
  score = clamp01to100(score)

  return {
    legal: true,
    score,
    components,
    understaffedSlots,
    shortReturnCount,
    shortReturnOnHard,
    lastOccupantOnHard,
    lastOccupantRepeats,
    recoveryOnHard,
    idleOnHard,
    minDaysSince: boardMinDaysSince(assignments, ctx.profiles),
    totalRotation: rotSum,
  }
}

/**
 * Keep the optimizer from pulling a low-load worker off a hard lane
 * just to chase a small rotation gain. Recovery and short-return still win
 * earlier in ranking and in isBoardBetter.
 */
function idleHardPlacementAdjust(
  placements: { lane: Lane; workerId: string; profile: WorkerHistoryProfile }[],
  ctx: EvaluateBoardContext,
): number {
  let delta = 0
  for (const { lane, workerId, profile } of placements) {
    if (lane.intensity !== 'hard') continue
    if (ctx.recoveringIds.has(workerId)) continue
    if (isIdleForHardLane(profile)) delta += 8
    const loads: number[] = []
    for (const [id] of ctx.profiles) {
      const worker = ctx.workersById.get(id)
      if (!worker || !isQualified(worker, lane)) continue
      loads.push(ctx.profiles.get(id)!.load)
    }
    if (loads.length < 2) continue
    const minLoad = Math.min(...loads)
    const maxLoad = Math.max(...loads)
    if (maxLoad - minLoad < IDLE_HARD_LOAD_GAP) continue
    if (profile.load - minLoad < IDLE_HARD_LOAD_GAP) delta += 4
    else if (maxLoad - profile.load < IDLE_HARD_LOAD_GAP) delta -= 4
  }
  return delta
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
    idleOnHard: 0,
    staffing: 0,
    stability: 0,
  }
  return {
    legal: false,
    score: Number.NEGATIVE_INFINITY,
    components: zero,
    understaffedSlots: Number.POSITIVE_INFINITY,
    shortReturnCount: Number.POSITIVE_INFINITY,
    shortReturnOnHard: Number.POSITIVE_INFINITY,
    lastOccupantOnHard: Number.POSITIVE_INFINITY,
    lastOccupantRepeats: Number.POSITIVE_INFINITY,
    recoveryOnHard: Number.POSITIVE_INFINITY,
    idleOnHard: Number.NEGATIVE_INFINITY,
    minDaysSince: 0,
    totalRotation: 0,
  }
}

/**
 * Compare two legal boards.
 * Lexicographic order (does not drop soft rules — only prioritizes):
 * 1) fewer understaffed slots (maximize fill)
 * 2) fewer short returns onto hard lanes
 * 3) fewer night workers placed on a hard afternoon lane
 * 4) fewer hard seats that repeat whoever sat that hard lane last
 * 5) more idle (≥4 days off) workers on hard lanes
 * 6) fewer seats that repeat whoever sat that lane last
 * 7) fewer short returns on other lanes
 * 8) higher weighted soft score, then spacing / rotation / stability
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

  // Hard short-return beats idle preference; easy short-return does not.
  if (next.shortReturnOnHard !== current.shortReturnOnHard) {
    return next.shortReturnOnHard < current.shortReturnOnHard
  }

  // Near-equal fill — a night worker on a hard afternoon lane loses to a lighter placement.
  if (next.recoveryOnHard !== current.recoveryOnHard) {
    return next.recoveryOnHard < current.recoveryOnHard
  }

  // Do not send the last person on a hard lane back there to chase rest.
  if (next.lastOccupantOnHard !== current.lastOccupantOnHard) {
    return next.lastOccupantOnHard < current.lastOccupantOnHard
  }

  // Keep rested people on hard seats through multi-pass swaps.
  if (next.idleOnHard !== current.idleOnHard) {
    return next.idleOnHard > current.idleOnHard
  }

  // Then avoid repeating the last person on the remaining lanes.
  if (next.lastOccupantRepeats !== current.lastOccupantRepeats) {
    return next.lastOccupantRepeats < current.lastOccupantRepeats
  }

  if (next.shortReturnCount !== current.shortReturnCount) {
    return next.shortReturnCount < current.shortReturnCount
  }

  if (next.score > current.score + 1e-6) return true
  if (next.score < current.score - 1e-6) return false

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
 * Count handoff-tier violations on afternoon handoff lanes (only when a
 * same-day morning board exists): a seated worker whose tier is worse than
 * some other qualified present worker that is NOT on this lane.
 * Example: no certified afternoon arrival came, yet the optimizer wants to
 * pull a different morning worker onto the swap seat while the morning
 * occupant sits elsewhere — that move must not be accepted.
 */
export function handoffTierViolationCount(
  assignments: LaneAssignment[],
  lanes: Lane[],
  workersById: Map<string, Worker>,
  morning: SameDayMorningContext | null,
  currentShiftType: ShiftType,
): number {
  if (currentShiftType !== 'afternoon' || !morning?.found) return 0
  const laneById = new Map(lanes.map((l) => [l.id, l]))
  const seatedByLane = new Map<string, Set<string>>()
  for (const a of assignments) {
    const set = seatedByLane.get(a.laneId) ?? new Set<string>()
    for (const wid of a.workerIds) if (wid) set.add(wid)
    seatedByLane.set(a.laneId, set)
  }

  let violations = 0
  for (const [laneId, seated] of seatedByLane) {
    const lane = laneById.get(laneId)
    if (!lane?.afternoonHandoff || seated.size === 0) continue
    for (const seatedId of seated) {
      const seatedTier = afternoonHandoffTier(seatedId, laneId, morning)
      for (const [wid, w] of workersById) {
        if (seated.has(wid)) continue
        if (!isQualified(w, lane)) continue
        if (afternoonHandoffTier(wid, laneId, morning) < seatedTier) {
          violations += 1
          break
        }
      }
    }
  }
  return violations
}

/**
 * Multi-pass local search guided by evaluateBoard (global soft objective).
 * Never accepts illegal boards; keeps bestBoard so quality never regresses.
 * Each pass picks the **best** improving move (fill preferred via staffing-first
 * in isBoardBetter), then continues — stronger than first-improving.
 * Qualification remains a HARD gate before any swap is scored.
 * Moves that add a handoff-tier violation (afternoon swap seat stolen from
 * the morning occupant / a certified arrival) are gated the same way.
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

  const objective = input.objective ?? 'standard'
  const evalCtx: EvaluateBoardContext = {
    lanes: input.lanes,
    workersById: input.workersById,
    profiles: input.profiles,
    recoveringIds,
    morning,
    currentShiftType,
    baselineAssignments: baseline,
    objective,
    weights: input.weights ?? weightsForObjective(objective),
    lastSeatings: input.lastSeatings,
  }

  let assignments = cloneAssignments(input.assignments)
  let unassigned = [...input.unassignedWorkerIds]
  let swapsPerformed = 0
  let passesRun = 0
  let improvingPassesAfterFirst = 0
  let evaluations = 0
  const evalBoard = (asg: LaneAssignment[]): BoardEvaluation => {
    evaluations += 1
    return evaluateBoard(asg, evalCtx)
  }

  // The handoff-tier gate only matters on afternoon boards with handoff lanes.
  const hasHandoffGate =
    currentShiftType === 'afternoon' &&
    morning?.found === true &&
    input.lanes.some((l) => l.afternoonHandoff)
  const countViolations = (asg: LaneAssignment[]): number =>
    hasHandoffGate
      ? handoffTierViolationCount(
          asg,
          input.lanes,
          input.workersById,
          morning,
          currentShiftType,
        )
      : 0

  let bestAssignments = cloneAssignments(assignments)
  let bestUnassigned = [...unassigned]
  let bestEval = evalBoard(bestAssignments)

  const rememberBest = (evalResult: BoardEvaluation) => {
    if (isBoardBetter(evalResult, bestEval)) {
      bestAssignments = cloneAssignments(assignments)
      bestUnassigned = [...unassigned]
      bestEval = evalResult
    }
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    passesRun = pass + 1
    const curEval = evalBoard(assignments)
    const curViolations = countViolations(assignments)

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
      // Handoff-tier gate: never accept a move that puts a worse-tier worker
      // on an afternoon swap seat while a better-tier qualified worker is out.
      if (countViolations(nextAssignments) > curViolations) return
      const nextEval = evalBoard(nextAssignments)
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

  if (isBoardBetter(bestEval, evalBoard(assignments))) {
    assignments = bestAssignments
    unassigned = bestUnassigned
  }

  const finalEval = evalBoard(assignments)
  return {
    assignments,
    unassignedWorkerIds: unassigned,
    passesRun,
    swapsPerformed,
    improvingPassesAfterFirst,
    totalRotationScore: finalEval.totalRotation,
    totalGlobalScore: finalEval.legal ? finalEval.score : 0,
    evaluations,
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

function daysAgoPhrase(days: number): string {
  if (days === 0.5) return 'מוקדם יותר היום'
  if (days <= 1) return 'לפני יום'
  if (days === 2) return 'לפני יומיים'
  return `לפני ${days} ימים`
}

function personName(workerId: string, roster: Map<string, Worker> | undefined): string {
  return roster?.get(workerId)?.fullName || 'מי ששובץ אז'
}

/** Human-readable “how long since last visit to this lane”. */
function rotationPlainReason(
  rot: RotationScoreResult,
  visitCount: number,
): string {
  const visitsNote =
    visitCount <= 0
      ? `אין ביקורים ב־${ROTATION_LOOKBACK_DAYS} הימים האחרונים`
      : `${visitCount} ביקורים בנתיב ב־${ROTATION_LOOKBACK_DAYS} הימים האחרונים`
  const counted = 'בוקר, צהריים ולילה נספרים, וגם הסבב האחרון במשמרת עם סבבים'
  const scoreNote = `ציון רוטציה ${Math.round(rot.rawScore)} (קנס זמן ${Math.round(rot.timePenalty)}, קנס כמות ביקורים ${Math.round(rot.volumePenalty)})`

  if (rot.daysSince == null) {
    return `${visitsNote} — לא ישב/ה בעמדה הזו בחלון. ${counted}. ${scoreNote}`
  }
  if (rot.daysSince === 0.5) {
    return `${visitsNote}. ${counted}. ביקור אחרון מוקדם יותר היום — חזרה קצרה, ורק אם אין חלופה שממלאת את התקן. ${scoreNote}`
  }
  if (rot.daysSince <= SHORT_RETURN_DAYS) {
    return `${visitsNote}. ${counted}. ביקור אחרון ${daysAgoPhrase(rot.daysSince)} — חזרה קצרה (עד ${SHORT_RETURN_DAYS} ימים), אחרי שניסו מועמדים עם מרווח גדול יותר. ${scoreNote}`
  }
  if (rot.daysSince <= 3) {
    return `${visitsNote}. ${counted}. ביקור אחרון ${daysAgoPhrase(rot.daysSince)} — חזרה יחסית קרובה. ${scoreNote}`
  }
  return `${visitsNote}. ${counted}. ביקור אחרון ${daysAgoPhrase(rot.daysSince)} — מרווח סביר. ${scoreNote}`
}

function lastOccupantReasons(
  worker: Worker,
  lane: Lane,
  seating: LaneLastSeating | undefined,
  roster: Map<string, Worker> | undefined,
): string[] {
  if (!seating) {
    return [
      `נבדק מי ישב אחרון ב«${lane.name}»: אין שיבוץ קודם ב־${LAST_OCCUPANT_WINDOW_DAYS} הימים האחרונים, כולל בוקר, צהריים, לילה וסבבים.`,
    ]
  }
  const names = seating.workerIds.map((id) => personName(id, roster))
  const who =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(', ')} ו${names[names.length - 1]}`
  const round = seating.roundLabel ? `, בסבב ${seating.roundLabel}` : ''
  const fact = `נבדק מי ישב אחרון ב«${lane.name}»: ${who}, במשמרת ${SHIFT_TYPE_LABELS[seating.shiftType]} בתאריך ${formatShiftDate(seating.date)}${round} (${daysAgoPhrase(seating.daysSince)}).`
  if (seating.workerIds.includes(worker.id)) {
    return [
      fact,
      `${worker.fullName} הוא האדם האחרון בנתיב הזה. ההתאמה נכשלה, והוא שובץ רק כי לא נשאר מועמד מוסמך אחר שממלא את התקן בלי לשבור כלל קשיח.`,
    ]
  }
  return [
    fact,
    `ההתאמה עברה: ${worker.fullName} אינו האדם האחרון בנתיב, ולכן הועדף על פני מי שחזר לאותו מקום.`,
  ]
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
  lastSeatings?: Map<string, LaneLastSeating>,
  roster?: Map<string, Worker>,
): string[] {
  const reasons: string[] = []
  const p = profiles.get(worker.id)!
  const intensityHe = INTENSITY_LABELS[lane.intensity]
  const recovering = recoveringIds.has(worker.id)
  const rot = rotationScoreFor(p, lane.id)

  reasons.push(lanePriorityNote)
  reasons.push(
    ...lastOccupantReasons(worker, lane, lastSeatings?.get(lane.id), roster),
  )

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
    if (isIdleForHardLane(p)) {
      const days =
        p.daysSinceLastDuty == null
          ? `מעל ${ROTATION_LOOKBACK_DAYS}`
          : String(Math.floor(p.daysSinceLastDuty))
      reasons.push(
        `לא עבד ${days} ימים — עדיפות לעמדה קשה אחרי מנוחה של לפחות ${IDLE_HARD_REST_DAYS} ימים`,
      )
    }
    const highestLoad = ranked.reduce((max, w) => {
      return Math.max(max, profiles.get(w.id)?.load ?? 0)
    }, 0)
    if (highestLoad - p.load >= IDLE_HARD_LOAD_GAP) {
      reasons.push(
        `עומס ${fmtLoad(p.load)} ב־${ROTATION_LOOKBACK_DAYS} הימים האחרונים, נמוך משאר הנוכחים — עדיפות לעמדה קשה`,
      )
    }
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
    if (
      lane.intensity === 'hard' &&
      isIdleForHardLane(p) &&
      !isIdleForHardLane(rp)
    ) {
      diffs.push(
        `נח יותר זמן מ${rival.fullName} (לפחות ${IDLE_HARD_REST_DAYS} ימים בלי שיבוץ)`,
      )
    }
    if (
      lane.intensity === 'hard' &&
      rp.load - p.load >= IDLE_HARD_LOAD_GAP
    ) {
      diffs.push(
        `עומס נמוך יותר (${fmtLoad(p.load)} מול ${fmtLoad(rp.load)} של ${rival.fullName})`,
      )
    }
    const rivalVisits = rp.rotationLaneCounts.get(lane.id) ?? 0
    const chosenVisits = p.rotationLaneCounts.get(lane.id) ?? 0
    const rivalDays = rp.daysSinceLastVisit.get(lane.id)
    const chosenDays = p.daysSinceLastVisit.get(lane.id)
    const dayText = (days: number | undefined) =>
      days == null ? 'לא ישב/ה בנתיב בחלון' : daysAgoPhrase(days)
    diffs.push(
      `מספרים מול ${rival.fullName}: מרווח ${dayText(chosenDays)} מול ${dayText(rivalDays)}, ביקורים ${chosenVisits} מול ${rivalVisits}, עומס ${fmtLoad(p.load)} מול ${fmtLoad(rp.load)}, עמדות קשות ${p.hardCount} מול ${rp.hardCount}`,
    )
    if (
      isLastLaneOccupant(rival.id, lane.id, lastSeatings) &&
      !isLastLaneOccupant(worker.id, lane.id, lastSeatings)
    ) {
      diffs.push(
        `${rival.fullName} ישב/ה אחרון בנתיב הזה, ולכן לא חזר/ה כל עוד יש מועמד אחר`,
      )
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
  objective: AssignmentObjective = 'standard',
  lastSeatings?: Map<string, LaneLastSeating>,
  roster?: Map<string, Worker>,
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
      objective,
      lastSeatings,
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
        lastSeatings,
        roster,
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
  objective: AssignmentObjective = 'standard',
  lastSeatings?: Map<string, LaneLastSeating>,
  roster?: Map<string, Worker>,
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

    /**
     * Afternoon handoff lane with a saved morning board: split the pool by
     * handoff tier BEFORE any soft filter. If no certified afternoon arrival
     * (tier 0) covers the תקן, the morning occupant of THIS seat (tier 1)
     * stays in place — never pushed out by soft filters — and another morning
     * worker (tier 2) is considered only as last resort.
     */
    let handoffFallback = false
    const morning = morningCtx && morningCtx.found ? morningCtx : null
    if (lane.afternoonHandoff && currentShiftType === 'afternoon' && morning) {
      const byTier = [0, 1, 2].map((tier) =>
        pool.filter(
          (w) => afternoonHandoffTier(w.id, lane.id, morning) === tier,
        ),
      )
      const chosen: Worker[] = []
      let tierIndex = 0
      while (
        tierIndex < byTier.length &&
        chosen.length < lane.staffingStandard
      ) {
        chosen.push(...byTier[tierIndex])
        tierIndex += 1
      }
      if (tierIndex > 1) {
        // Fallback below tier 0 — keep whoever sat here this morning in place
        // rather than pulling someone from a different morning seat.
        pool = chosen
        handoffFallback = true
      } else {
        pool = byTier[0]
      }
    }

    // Prefer rested workers off hard lanes when possible.
    if (
      !handoffFallback &&
      lane.intensity === 'hard' &&
      recoveringIds.size > 0
    ) {
      const rested = qualified.filter((w) => !recoveringIds.has(w.id))
      if (rested.length >= lane.staffingStandard) {
        pool = rested
      }
    }

    // The rotation soft-floor must not drop the morning occupant
    // (D = 0.5 is a "short return" by design) while the handoff fallback is
    // active — the occupant has to stay available for ranking.
    const rotationPool = handoffFallback
      ? null
      : applyRotationScorePool(pool, lane, profiles, lane.staffingStandard)
    if (rotationPool) pool = rotationPool.pool
    // Never fully disable rotation ranking — partial soft-floor keeps rawScore order.
    if (rotationPool?.avoidedShortReturn) {
      warnings.push(
        `נתיב "${lane.name}" — הועדפו מועמדים עם מרווח מעל ${SHORT_RETURN_DAYS} ימים מהעמדה (נמנעה חזרה קצרה)`,
      )
    }
    if (rotationPool?.relaxedShortReturn) {
      warnings.push(
        `נתיב "${lane.name}" — מילוי תקן גובר על רוטציה: לא היו מספיק מוסמכים עם מרווח טוב; הורחב גם למי שחזרו לאחרונה`,
      )
    }
    if (rotationPool?.partialFill) {
      warnings.push(
        `נתיב "${lane.name}" — הורחב מאגר המועמדים כי לא היו מספיק עם מרווח טוב מהעמדה`,
      )
    } else if (rotationPool) {
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

    if (
      !handoffFallback &&
      lane.intensity === 'easy' &&
      isAfternoonShift(currentShiftType)
    ) {
      const nightFirst = qualified.filter((w) => recoveringIds.has(w.id))
      if (nightFirst.length >= lane.staffingStandard) {
        pool = nightFirst
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
      objective,
      lastSeatings,
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
          lastSeatings,
          roster,
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

/**
 * Explain a board that was already saved, without assigning anyone again.
 * History of the same date is ignored, so the shift does not explain itself.
 */
export function explainSavedBoard(input: {
  assignments: LaneAssignment[]
  activeLanes: Lane[]
  presentWorkers: Worker[]
  history: ShiftSchedule[]
  allLanes: Lane[]
  date: string
  shiftType: ShiftType
}): PlacementExplanation[] {
  const {
    assignments,
    activeLanes,
    presentWorkers,
    history,
    allLanes,
    date,
    shiftType,
  } = input
  if (activeLanes.length === 0 || presentWorkers.length === 0) return []

  const lookbackDays = Math.max(DEFAULT_LOOKBACK_DAYS, ROTATION_LOOKBACK_DAYS)
  const morning =
    shiftType === 'afternoon' ? buildSameDayMorningContext(history, date) : null
  const profiles = new Map<string, WorkerHistoryProfile>()
  for (const worker of presentWorkers) {
    profiles.set(
      worker.id,
      buildWorkerProfile(
        worker.id,
        history,
        allLanes,
        shiftType,
        date,
        lookbackDays,
      ),
    )
  }

  const recoveringIds = new Set<string>()
  if (shiftType === 'afternoon') {
    for (const worker of presentWorkers) {
      if (needsAfternoonNightRecovery(worker.id, history, date, shiftType)) {
        recoveringIds.add(worker.id)
        continue
      }
      if (
        worker.isManager &&
        morning?.found &&
        morning.morningWorkerIds.has(worker.id)
      ) {
        recoveringIds.add(worker.id)
      }
    }
  }

  const intensityOrder: Record<Intensity, number> = { hard: 0, medium: 1, easy: 2 }
  const orderedLanes = [...activeLanes].sort((a, b) => {
    if (shiftType === 'afternoon') {
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

  const roster = new Map(presentWorkers.map((worker) => [worker.id, worker]))
  const lastSeatings = buildLaneLastSeatings(
    history,
    date,
    shiftType,
    lookbackDays,
  )

  return buildFinalBoardExplanations(
    orderedLanes,
    assignments,
    presentWorkers,
    profiles,
    recoveringIds,
    morning,
    shiftType,
    assignments,
    'standard',
    lastSeatings,
    roster,
  )
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

  const objective = ctx?.objective ?? 'standard'
  const tieBreakSeedBase = String(
    ctx?.rngSeed ??
      (objective === 'standard'
        ? `${currentDate}|${currentShiftType}`
        : `${currentDate}|${currentShiftType}|${objective}`),
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

  const roster = new Map(
    (ctx?.roster ?? presentWorkers).map((worker) => [worker.id, worker]),
  )
  const lastSeatings = buildLaneLastSeatings(
    history,
    currentDate,
    currentShiftType,
    lookbackDays,
  )

  const recoveringIds = new Set<string>()
  const morningCtxForRecovery =
    currentShiftType === 'afternoon'
      ? buildSameDayMorningContext(history, currentDate)
      : null
  if (isAfternoonShift(currentShiftType)) {
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
    objective,
    lastSeatings,
    roster,
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
    objective,
    weights: weightsForObjective(objective),
    lastSeatings,
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
    objective,
    lastSeatings,
    roster,
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

  const boardStats = summarizePlacedBoard(
    finalAssignments,
    activeLanes,
    profiles,
    currentShiftType,
  )

  return {
    assignments: finalAssignments,
    unassignedWorkerIds: unassigned,
    understaffedLaneIds,
    warnings: [...new Set(warnings)],
    explanations,
    ...boardStats,
    searchStats: {
      starts: 1,
      evaluations: optimized.evaluations,
      passes: optimized.passesRun,
    },
  }
}

/** Progress tick reported while the multi-start search runs. */
export interface AssignmentProgress {
  /** 0–100 */
  percent: number
  startsDone: number
  startsTotal: number
  /** Cumulative board evaluations performed so far (thousands in real runs). */
  evaluations: number
}

export interface AssignmentProgressOptions {
  /**
   * Starts to run — each fully greedy + optimized with its own tie-break
   * seed; the strictly best board wins.
   * Default: DEFAULT_PROGRESS_SEARCH_STARTS.
   */
  searchStarts?: number
  onProgress?: (progress: AssignmentProgress) => void
  /** Override the default browser-paint yield (tests pass a no-op). */
  yieldToUi?: () => Promise<void>
}

/** Two animation frames: paint the loader first, then let it animate. */
function yieldForProgressUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * Scoring context for choosing between multi-start boards. Mirrors the setup
 * inside `runAssignmentAlgorithm` (same defaults) so every candidate is
 * compared with the identical objective, profiles, and recovery set.
 */
function comparisonEvalContext(
  activeLanes: Lane[],
  presentWorkers: Worker[],
  history: ShiftSchedule[],
  allLanes: Lane[],
  ctx?: AssignmentContext,
): Omit<EvaluateBoardContext, 'baselineAssignments'> {
  const date = ctx?.date ?? '9999-12-31'
  const shiftType = ctx?.shiftType ?? 'morning'
  const lookbackDays = Math.max(
    ctx?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    ROTATION_LOOKBACK_DAYS,
  )
  const objective = ctx?.objective ?? 'standard'

  const workersById = new Map(presentWorkers.map((w) => [w.id, w]))
  const profiles = new Map<string, WorkerHistoryProfile>()
  for (const w of presentWorkers) {
    profiles.set(
      w.id,
      buildWorkerProfile(w.id, history, allLanes, shiftType, date, lookbackDays),
    )
  }

  const recoveringIds = new Set<string>()
  const morning =
    shiftType === 'afternoon' ? buildSameDayMorningContext(history, date) : null
  if (isAfternoonShift(shiftType)) {
    for (const w of presentWorkers) {
      if (needsAfternoonNightRecovery(w.id, history, date, shiftType)) {
        recoveringIds.add(w.id)
        continue
      }
      if (w.isManager && morning?.found && morning.morningWorkerIds.has(w.id)) {
        recoveringIds.add(w.id)
      }
    }
  }

  return {
    lanes: activeLanes,
    workersById,
    profiles,
    recoveringIds,
    morning,
    currentShiftType: shiftType,
    objective,
    weights: weightsForObjective(objective),
    lastSeatings: buildLaneLastSeatings(history, date, shiftType, lookbackDays),
  }
}

/**
 * Async multi-start runner with progress: same contract as
 * `runAssignmentAlgorithm`, but runs several fully-optimized starts (default
 * DEFAULT_PROGRESS_SEARCH_STARTS), yields to the browser between them so a
 * loader can paint and animate, reports how many board checks ran so far, and
 * returns the strictly best board. Deterministic: seeds derive from the same
 * base the sync runner uses.
 */
export async function runAssignmentAlgorithmWithProgress(
  activeLanes: Lane[],
  presentWorkers: Worker[],
  history: ShiftSchedule[],
  allLanes: Lane[],
  ctx?: AssignmentContext,
  options?: AssignmentProgressOptions,
): Promise<AssignmentResult> {
  const starts = Math.max(
    1,
    options?.searchStarts ?? DEFAULT_PROGRESS_SEARCH_STARTS,
  )
  const yieldToUi = options?.yieldToUi ?? yieldForProgressUi
  const report = (percent: number, done: number, evaluations: number) => {
    options?.onProgress?.({ percent, startsDone: done, startsTotal: starts, evaluations })
  }

  // Degenerate inputs are answered immediately by the classic runner.
  if (activeLanes.length === 0 || presentWorkers.length === 0 || starts === 1) {
    const single = runAssignmentAlgorithm(
      activeLanes,
      presentWorkers,
      history,
      allLanes,
      ctx,
    )
    report(100, 1, single.searchStats?.evaluations ?? 0)
    return single
  }

  const evalBase = comparisonEvalContext(
    activeLanes,
    presentWorkers,
    history,
    allLanes,
    ctx,
  )

  const date = ctx?.date ?? '9999-12-31'
  const shiftType = ctx?.shiftType ?? 'morning'
  const objective = ctx?.objective ?? 'standard'
  const baseSeed = String(
    ctx?.rngSeed ??
      (objective === 'standard'
        ? `${date}|${shiftType}`
        : `${date}|${shiftType}|${objective}`),
  )

  let best: AssignmentResult | null = null
  let bestEval: BoardEvaluation | null = null
  let compareBaseline: LaneAssignment[] | null = null
  let totalEvaluations = 0

  for (let i = 0; i < starts; i++) {
    const seed = i === 0 ? baseSeed : `${baseSeed}|start${i}`
    const candidate = runAssignmentAlgorithm(
      activeLanes,
      presentWorkers,
      history,
      allLanes,
      { ...ctx, date, shiftType, rngSeed: seed },
    )
    totalEvaluations += candidate.searchStats?.evaluations ?? 0
    if (!compareBaseline) compareBaseline = candidate.assignments
    // Score every candidate against the SAME reference board so starts are
    // directly comparable (stability uses a fixed baseline).
    const candidateEval = evaluateBoard(candidate.assignments, {
      ...evalBase,
      baselineAssignments: compareBaseline,
    })
    totalEvaluations += 1
    if (!best || !bestEval || isBoardBetter(candidateEval, bestEval)) {
      best = candidate
      bestEval = candidateEval
    }
    report(Math.round(((i + 1) / starts) * 100), i + 1, totalEvaluations)
    await yieldToUi()
  }

  if (!best) {
    return runAssignmentAlgorithm(activeLanes, presentWorkers, history, allLanes, ctx)
  }
  const passes = best.searchStats?.passes ?? 0
  const checkNote = `נבדקו ${totalEvaluations} לוחות ב־${starts} התחלות ועד ${passes} סבבי שיפור לפני שהשיבוץ הוצג`
  return {
    ...best,
    warnings: best.warnings.includes(checkNote)
      ? best.warnings
      : [...best.warnings, checkNote],
    searchStats: {
      starts,
      evaluations: totalEvaluations,
      passes,
    },
  }
}

function medianNumber(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

function summarizePlacedBoard(
  assignments: LaneAssignment[],
  lanes: Lane[],
  profiles: Map<string, WorkerHistoryProfile>,
  shiftType: ShiftType,
): { loadSpread: number; hardSeats: number; experiencedHardSeats: number } {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]))
  const loads: number[] = []
  let hardSeats = 0
  let experiencedHardSeats = 0
  const medianHard = medianNumber(
    [...profiles.values()].map((profile) => profile.hardCount),
  )
  for (const row of assignments) {
    const lane = laneById.get(row.laneId)
    if (!lane) continue
    for (const workerId of row.workerIds) {
      if (!workerId) continue
      const profile = profiles.get(workerId)
      if (!profile) continue
      loads.push(profile.load + shiftBalanceDelta(lane.intensity, shiftType))
      if (lane.intensity !== 'hard') continue
      hardSeats += 1
      if (profile.hardCount > 0 && profile.hardCount >= medianHard) {
        experiencedHardSeats += 1
      }
    }
  }
  const loadSpread =
    loads.length < 2
      ? 0
      : Math.round((Math.max(...loads) - Math.min(...loads)) * 10) / 10
  return { loadSpread, hardSeats, experiencedHardSeats }
}

function addShare(current: number, share: number): number {
  return Math.round((current + share) * 1e6) / 1e6
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
      for (const placement of shiftPlacements(shift)) {
        if (placement.workerId !== w.id) continue
        const share = placement.weight
        byLane[placement.laneId] = addShare(
          byLane[placement.laneId] ?? 0,
          share,
        )
        totalAssignments = addShare(totalAssignments, share)
        const lane = laneMap.get(placement.laneId)
        if (!lane) continue

        if (lane.intensity === 'hard') {
          hardCount = addShare(hardCount, share)
          hardByShift[shift.shiftType] = addShare(
            hardByShift[shift.shiftType],
            share,
          )
        } else if (lane.intensity === 'medium') {
          mediumCount = addShare(mediumCount, share)
        } else if (shift.shiftType === 'night') {
          easyCount = addShare(easyCount, share)
          nightEasyCount = addShare(nightEasyCount, share)
        } else {
          easyCount = addShare(easyCount, share)
          dayEasyCount = addShare(dayEasyCount, share)
        }
      }
    }

    const dates = filtered.map((h) => h.date).sort()
    const from = options?.fromDate ?? dates[0]
    const to = options?.toDate ?? dates[dates.length - 1]
    const shiftsByDate = groupShiftsByDate(dedupeShiftsByDateAndType(filtered))
    const balanceOf = (family: LoadShiftFamily) =>
      from && to
        ? accumulateLoadBalance(w.id, shiftsByDate, laneMap, from, to, { family })
        : { net: 0, rose: 0, fell: 0 }
    const morning = balanceOf('morning')
    const afternoon = balanceOf('afternoon')
    const night = balanceOf('night')

    return {
      workerId: w.id,
      byLane,
      hardCount,
      mediumCount,
      easyCount,
      dayEasyCount,
      nightEasyCount,
      effectiveLoad: roundLoad(morning.net + afternoon.net + night.net),
      loadRose: roundLoad(morning.rose + afternoon.rose + night.rose),
      loadFell: roundLoad(morning.fell + afternoon.fell + night.fell),
      morningLoad: morning.net,
      afternoonLoad: afternoon.net,
      nightLoad: night.net,
      hardByShift,
      totalAssignments,
    }
  })
}
