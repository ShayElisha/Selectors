import type { Lane, StaffingStandard } from '../types'

/** Maximum participants allowed per lane in catalog / shift תקן. */
export const MAX_LANE_STAFFING = 5 as const

/** Default per-shift תקן when no override is set. */
export const DEFAULT_SHIFT_STAFFING = 1 as const

export type { StaffingStandard }
export type StaffingOverrides = Record<string, StaffingStandard>

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
