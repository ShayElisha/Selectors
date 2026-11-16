import { isGateManagerLane } from './gateManager'
import { effectiveStaffingStandard, type StaffingOverrides } from './shiftStaffing'
import { usesRounds } from './assignmentMode'
import type {
  AssignmentMode,
  Lane,
  LaneAssignment,
  SelectorRound,
  ShiftAudience,
  Worker,
} from '../types'

export type ShiftCloseSummary = {
  managerName: string | null
  managerMissing: boolean
  filledSlots: number
  requiredSlots: number
  missingSlots: number
  unassignedCount: number
  understaffedLanes: { name: string; filled: number; standard: number }[]
}

/** Minimal draft shape needed for the pre-close summary. */
export type ShiftCloseDraft = {
  audience?: ShiftAudience
  assignmentMode?: AssignmentMode
  activeLaneIds: string[]
  assignments: LaneAssignment[]
  rounds?: SelectorRound[]
  staffingOverrides?: StaffingOverrides
  gateManagerWorkerId?: string
  unassignedWorkerIds: string[]
}

/** Snapshot for the sign-off dialog: coverage, gaps, and shift manager. */
export function buildShiftCloseSummary(
  draft: ShiftCloseDraft,
  lanes: Lane[],
  workers: Worker[],
): ShiftCloseSummary {
  const managerId = draft.gateManagerWorkerId
  const managerName = managerId
    ? (workers.find((w) => w.id === managerId)?.fullName ?? managerId)
    : null

  const understaffedLanes: ShiftCloseSummary['understaffedLanes'] = []
  let filledSlots = 0
  let requiredSlots = 0

  if (usesRounds(draft)) {
    const rounds = draft.rounds ?? []
    for (const round of rounds) {
      for (const row of round.assignments) {
        const lane = lanes.find((l) => l.id === row.laneId)
        if (!lane || isGateManagerLane(lane)) continue
        const standard = effectiveStaffingStandard(lane, draft.staffingOverrides)
        const filled = row.workerIds.filter(Boolean).length
        filledSlots += filled
        requiredSlots += standard
        if (filled < standard) {
          understaffedLanes.push({
            name: `${lane.name} · ${round.label}`,
            filled,
            standard,
          })
        }
      }
    }
  } else {
    for (const laneId of draft.activeLaneIds) {
      const lane = lanes.find((l) => l.id === laneId)
      if (!lane || isGateManagerLane(lane)) continue
      const standard = effectiveStaffingStandard(lane, draft.staffingOverrides)
      const row = draft.assignments.find(
        (assignment: LaneAssignment) => assignment.laneId === laneId,
      )
      const filled = (row?.workerIds ?? []).filter(Boolean).length
      filledSlots += filled
      requiredSlots += standard
      if (filled < standard) {
        understaffedLanes.push({ name: lane.name, filled, standard })
      }
    }
  }

  return {
    managerName,
    managerMissing: !managerId,
    filledSlots,
    requiredSlots,
    missingSlots: Math.max(0, requiredSlots - filledSlots),
    unassignedCount: draft.unassignedWorkerIds.length,
    understaffedLanes: understaffedLanes.slice(0, 8),
  }
}
