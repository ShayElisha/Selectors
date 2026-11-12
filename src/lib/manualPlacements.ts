import type {
  Lane,
  LaneAssignment,
  ManualLanePlacement,
  SelectorRound,
  Worker,
} from '../types'
import { effectiveStaffingStandard } from './shiftStaffing'
import type { StaffingOverrides } from './shiftStaffing'

export function normalizeManualPlacements(raw: unknown): ManualLanePlacement[] {
  if (!Array.isArray(raw)) return []
  const out: ManualLanePlacement[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const workerId = String((item as ManualLanePlacement).workerId || '').trim()
    const laneId = String((item as ManualLanePlacement).laneId || '').trim()
    if (!workerId || !laneId) continue
    if (seen.has(workerId)) continue
    seen.add(workerId)
    out.push({ workerId, laneId })
  }
  return out
}

export function pruneManualPlacements(
  placements: ManualLanePlacement[] | undefined,
  presentIds: string[],
  activeLaneIds: string[],
): ManualLanePlacement[] {
  const present = new Set(presentIds)
  const lanes = new Set(activeLaneIds)
  return normalizeManualPlacements(placements).filter((placement) => {
    if (!present.has(placement.workerId)) return false
    if (!lanes.has(placement.laneId)) return false
    return true
  })
}

export function manualPlacementLockedIds(
  placements: ManualLanePlacement[] | undefined,
): Set<string> {
  const ids = new Set<string>()
  for (const placement of placements ?? []) {
    ids.add(placement.workerId)
  }
  return ids
}

function seatWorkerOnLane(
  assignments: LaneAssignment[],
  placement: ManualLanePlacement,
  lanes: Lane[],
  overrides?: StaffingOverrides | null,
): LaneAssignment[] {
  const lane = lanes.find((item) => item.id === placement.laneId)
  if (!lane) return assignments
  const std = effectiveStaffingStandard(lane, overrides)
  const byLane = new Map(assignments.map((row) => [row.laneId, { ...row }]))
  
  for (const row of byLane.values()) {
    row.workerIds = row.workerIds.map((id) =>
      id === placement.workerId ? '' : id,
    )
  }
  
  const existing = byLane.get(placement.laneId)
  const others = [...(existing?.workerIds ?? [])].filter(
    (id) => id && id !== placement.workerId,
  )
  
  const nextIds = [placement.workerId, ...others.slice(0, Math.max(0, std - 1))]
  while (nextIds.length < std) nextIds.push('')
  
  byLane.set(placement.laneId, {
    laneId: placement.laneId,
    workerIds: nextIds,
    notes: existing?.notes,
  })
  
  return [...byLane.values()]
}

export function applyManualPlacementsToAssignments(
  assignments: LaneAssignment[],
  placements: ManualLanePlacement[] | undefined,
  lanes: Lane[],
  overrides?: StaffingOverrides | null,
): LaneAssignment[] {
  let next = assignments.map((row) => ({
    ...row,
    workerIds: [...row.workerIds],
  }))
  for (const placement of placements ?? []) {
    next = seatWorkerOnLane(next, placement, lanes, overrides)
  }
  return next
}

export function applyManualPlacementsToRounds(
  rounds: SelectorRound[],
  placements: ManualLanePlacement[] | undefined,
  lanes: Lane[],
  overrides?: StaffingOverrides | null,
): SelectorRound[] {
  if (!placements?.length) return rounds
  return rounds.map((round) => ({
    ...round,
    assignments: applyManualPlacementsToAssignments(
      round.assignments,
      placements,
      lanes,
      overrides,
    ),
  }))
}

export function filterManuallyPlacedFromPool(
  pool: Worker[],
  placements: ManualLanePlacement[] | undefined,
): Worker[] {
  const manualIds = manualPlacementLockedIds(placements)
  return pool.filter((w) => !manualIds.has(w.id))
}
