import type { Lane, StaffingStandard } from '../types'

/** Maximum participants allowed per lane in catalog / shift תקן. */
export const MAX_LANE_STAFFING = 5 as const

/** Default per-shift תקן when no override is set. */
export const DEFAULT_SHIFT_STAFFING = 1 as const

export type { StaffingStandard }
export type StaffingOverrides = Record<string, StaffingStandard>

export type PeakHoursConfig = {
  hours: { start: number; end: number }[]
  peakStandard: StaffingStandard
}

export type PeakHoursOverrides = Record<string, PeakHoursConfig>

export function clampStaffingStandard(n: unknown): StaffingStandard {
  const v = Math.trunc(Number(n))
  if (!Number.isFinite(v) || v < 1) return 1
  if (v > MAX_LANE_STAFFING) return MAX_LANE_STAFFING
  return v as StaffingStandard
}

/** Catalog value is the per-lane maximum (1…5). */
export function laneMaxStaffing(
  lane: Pick<Lane, 'staffingStandard'> | undefined,
): StaffingStandard {
  return clampStaffingStandard(lane?.staffingStandard)
}

/** Choices allowed for a lane in the current shift: 1 .. max. */
export function staffingChoicesForLane(
  lane: Pick<Lane, 'staffingStandard'> | undefined,
): StaffingStandard[] {
  const max = laneMaxStaffing(lane)
  return Array.from({ length: max }, (_, i) => (i + 1) as StaffingStandard)
}

export function normalizeStaffingOverrides(
  raw: unknown,
): StaffingOverrides {
  if (!raw || typeof raw !== 'object') return {}
  const out: StaffingOverrides = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!id) continue
    const n = Number(v)
    if (Number.isInteger(n) && n >= 1 && n <= MAX_LANE_STAFFING) {
      out[id] = n as StaffingStandard
    }
  }
  return out
}

/**
 * Effective תקן for this shift: override if set, else default 1.
 * Never exceeds the lane's maximum staffingStandard.
 */
export function effectiveStaffingStandard(
  lane: Pick<Lane, 'id' | 'staffingStandard'> | undefined,
  overrides?: StaffingOverrides | null,
): StaffingStandard {
  if (!lane) return DEFAULT_SHIFT_STAFFING
  const max = laneMaxStaffing(lane)
  const o = overrides?.[lane.id]
  if (o != null) {
    const clamped = clampStaffingStandard(o)
    return clamped > max ? max : clamped
  }
  return DEFAULT_SHIFT_STAFFING > max ? max : DEFAULT_SHIFT_STAFFING
}

/** Shallow-cloned lanes with per-shift תקן applied (clamped to each lane max). */
export function lanesWithStaffingOverrides(
  lanes: Lane[],
  overrides?: StaffingOverrides | null,
): Lane[] {
  return lanes.map((l) => {
    const next = effectiveStaffingStandard(l, overrides)
    if (next === l.staffingStandard) return l
    return { ...l, staffingStandard: next }
  })
}

/** Max people that can be set as the whole-shift headcount target. */
export const MAX_SHIFT_HEADCOUNT = 99 as const

/**
 * Whole-shift תקן. `undefined` / empty means not set (no shortage tracking).
 * Values below 1 clear the target.
 */
export function normalizeHeadcountStandard(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = Math.trunc(Number(raw))
  if (!Number.isFinite(n) || n < 1) return undefined
  return Math.min(MAX_SHIFT_HEADCOUNT, n)
}

/** How many people are still missing vs the shift headcount target. */
export function headcountDeficit(
  presentCount: number,
  headcountStandard: number | undefined,
): number {
  if (headcountStandard == null || headcountStandard < 1) return 0
  return Math.max(0, headcountStandard - Math.max(0, presentCount))
}

/** Snapshot of whole-shift headcount vs present — reusable for home, cancellations, analytics. */
export type ShiftHeadcountSnapshot = {
  /** True when a תקן משמרת was set on the shift. */
  tracked: boolean
  standard: number | undefined
  present: number
  deficit: number
  surplus: number
}

export function shiftHeadcountSnapshot(shift: {
  presentWorkerIds?: string[] | null
  headcountStandard?: number | null
}): ShiftHeadcountSnapshot {
  const present = (shift.presentWorkerIds ?? []).filter(Boolean).length
  const standard = normalizeHeadcountStandard(shift.headcountStandard)
  if (standard == null) {
    return { tracked: false, standard: undefined, present, deficit: 0, surplus: 0 }
  }
  const deficit = headcountDeficit(present, standard)
  return {
    tracked: true,
    standard,
    present,
    deficit,
    surplus: Math.max(0, present - standard),
  }
}

/** Sum of headcount deficits across shifts that have תקן משמרת set. */
export function totalHeadcountDeficit(
  shifts: Array<{
    presentWorkerIds?: string[] | null
    headcountStandard?: number | null
  }>,
): number {
  return shifts.reduce(
    (sum, shift) => sum + shiftHeadcountSnapshot(shift).deficit,
    0,
  )
}

/**
 * Get the effective peak hours config for a lane, considering shift overrides.
 * Returns the shift override if present, otherwise the lane's catalog config.
 */
export function getEffectivePeakHours(
  lane: Lane,
  peakHoursOverrides?: PeakHoursOverrides,
): PeakHoursConfig | undefined {
  // Shift override takes precedence
  if (peakHoursOverrides?.[lane.id]) {
    return peakHoursOverrides[lane.id]
  }
  
  // Fall back to lane catalog
  return lane.peakHours
}

/**
 * Check if the given time is within peak hours.
 * Handles overnight peaks (e.g., 23:00-01:00).
 */
export function isInPeakHours(
  peakConfig: PeakHoursConfig | undefined,
  currentMinutes: number,
): boolean {
  if (!peakConfig) return false
  
  return peakConfig.hours.some((span) => {
    let start = span.start
    let end = span.end
    let current = currentMinutes
    
    // Handle overnight peaks
    if (end <= start) {
      end += 24 * 60
      // If current time is early morning (before noon), it might be part of overnight peak
      if (current < 12 * 60) {
        current += 24 * 60
      }
    }
    
    return current >= start && current < end
  })
}

/**
 * Get the effective staffing standard for a lane at a specific time.
 * Considers peak hours (with shift overrides) and per-shift תקן overrides.
 * 
 * Priority:
 * 1. Per-shift staffing override (staffingOverrides)
 * 2. Peak hours (if currentMinutes is in peak hours)
 * 3. Base staffing standard from lane catalog
 */
export function effectiveStaffingStandardAtTime(
  lane: Lane,
  currentMinutes: number,
  options?: {
    staffingOverrides?: StaffingOverrides
    peakHoursOverrides?: PeakHoursOverrides
  },
): StaffingStandard {
  // Priority 1: Per-shift staffing override
  if (options?.staffingOverrides?.[lane.id] != null) {
    return options.staffingOverrides[lane.id]
  }
  
  // Priority 2: Peak hours
  const peakConfig = getEffectivePeakHours(lane, options?.peakHoursOverrides)
  if (isInPeakHours(peakConfig, currentMinutes)) {
    return peakConfig!.peakStandard
  }
  
  // Priority 3: Base standard from lane catalog
  return lane.staffingStandard
}
