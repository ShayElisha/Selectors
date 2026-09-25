import type { Lane, LaneAssignment, Worker } from '../types'
import {
  effectiveStaffingStandard,
  type StaffingOverrides,
} from './shiftStaffing'

export const GATE_MANAGER_LANE_NAME = 'מנהל שער'

/** Active inspectors eligible for shift attendance (manager-only accounts excluded). */
export function activeAttendanceWorkers(workers: Worker[]): Worker[] {
  return workers.filter((w) => w.status === 'active' && w.isInspector)
}

export function isGateManagerLane(lane: Pick<Lane, 'name'>): boolean {
  return lane.name.trim() === GATE_MANAGER_LANE_NAME
}

export function findGateManagerLane(lanes: Lane[]): Lane | undefined {
  return lanes.find(isGateManagerLane)
}

export function createGateManagerLane(id: string): Lane {
  return {
    id,
    name: GATE_MANAGER_LANE_NAME,
    staffingStandard: 1,
    requiredCertifications: [],
    intensity: 'medium',
  }
}

/** Manageable catalog lanes (excludes system עמדת מנהל שער). */
export function managedLanes(lanes: Lane[]): Lane[] {
  return lanes.filter((l) => !isGateManagerLane(l))
}

/**
 * Ensure catalog always has a מנהל שער station (medium, תקן 1).
 * Normalizes an existing one if intensity/name/standard drifted.
 */
export function ensureGateManagerLane(
  lanes: Lane[],
  newId: () => string,
): Lane[] {
  const idx = lanes.findIndex(isGateManagerLane)
  if (idx < 0) return [...lanes, createGateManagerLane(newId())]
  const lane = lanes[idx]!
  if (
    lane.name.trim() === GATE_MANAGER_LANE_NAME &&
    lane.staffingStandard === 1 &&
    lane.intensity === 'medium'
  ) {
    return lanes
  }
  const next = [...lanes]
  next[idx] = {
    ...lane,
    name: GATE_MANAGER_LANE_NAME,
    staffingStandard: 1,
    intensity: 'medium',
  }
  return next
}

/** Present workers who still need a regular lane (excludes מנהל שער). */
export function laneStaffPresentIds(
  presentWorkerIds: string[],
  gateManagerWorkerId?: string | null,
): string[] {
  const gate = gateManagerWorkerId?.trim() || ''
  return presentWorkerIds.filter((id) => id && id !== gate)
}

/**
 * Present ∩ ¬assigned.
 * Prefer real assignment on עמדת מנהל שער; still exclude by id if missing.
 */
export function computeUnassignedWorkerIds(
  presentWorkerIds: string[],
  assignments: LaneAssignment[],
  gateManagerWorkerId?: string | null,
): string[] {
  const assigned = new Set(
    assignments.flatMap((a) => a.workerIds.filter(Boolean)),
  )
  return laneStaffPresentIds(presentWorkerIds, gateManagerWorkerId).filter(
    (id) => !assigned.has(id),
  )
}

export function normalizeGateManagerId(
  gateManagerWorkerId: string | null | undefined,
  presentWorkerIds: string[],
  workers: Worker[],
): string | undefined {
  const id = gateManagerWorkerId?.trim()
  if (!id) return undefined
  if (!presentWorkerIds.includes(id)) return undefined
  const worker = workers.find((w) => w.id === id)
  if (!worker?.isManager || !worker.isInspector || worker.status !== 'active') {
    return undefined
  }
  return id
}

function padLaneAssignment(
  laneId: string,
  workerIds: string[],
  lanes: Lane[],
  overrides?: StaffingOverrides | null,
  notes?: string,
): LaneAssignment {
  const lane = lanes.find((l) => l.id === laneId)
  const std = effectiveStaffingStandard(lane, overrides)
  const filled = workerIds.filter(Boolean)
  const padded = [...filled]
  while (padded.length < Math.max(std, filled.length)) padded.push('')
  return {
    laneId,
    workerIds: padded,
    ...(notes?.trim() ? { notes } : {}),
  }
}

/**
 * Activate עמדת מנהל שער and place the designated manager there
 * (sole occupant). Clears the station when no gate manager is set.
 */
export function syncGateManagerPlacement(args: {
  lanes: Lane[]
  activeLaneIds: string[]
  assignments: LaneAssignment[]
  gateManagerWorkerId?: string | null
  staffingOverrides?: StaffingOverrides | null
}): {
  activeLaneIds: string[]
  assignments: LaneAssignment[]
} {
  const gateLane = findGateManagerLane(args.lanes)
  if (!gateLane) {
    return {
      activeLaneIds: args.activeLaneIds,
      assignments: args.assignments,
    }
  }

  const gateId = args.gateManagerWorkerId?.trim() || ''
  const notesByLane = new Map(
    args.assignments
      .filter((a) => a.notes?.trim())
      .map((a) => [a.laneId, a.notes!] as const),
  )

  if (!gateId) {
    const activeLaneIds = args.activeLaneIds.filter((id) => id !== gateLane.id)
    const assignments = activeLaneIds.map((laneId) => {
      const prev = args.assignments.find((a) => a.laneId === laneId)
      return padLaneAssignment(
        laneId,
        prev?.workerIds ?? [],
        args.lanes,
        args.staffingOverrides,
        notesByLane.get(laneId),
      )
    })
    return { activeLaneIds, assignments }
  }

  const activeLaneIds = args.activeLaneIds.includes(gateLane.id)
    ? [...args.activeLaneIds]
    : [...args.activeLaneIds, gateLane.id]

  const assignments = activeLaneIds.map((laneId) => {
    const prev = args.assignments.find((a) => a.laneId === laneId)
    if (laneId === gateLane.id) {
      return padLaneAssignment(
        laneId,
        [gateId],
        args.lanes,
        args.staffingOverrides,
        notesByLane.get(laneId),
      )
    }
    const workerIds = (prev?.workerIds ?? []).map((id) =>
      id === gateId ? '' : id,
    )
    return padLaneAssignment(
      laneId,
      workerIds,
      args.lanes,
      args.staffingOverrides,
      notesByLane.get(laneId),
    )
  })

  return { activeLaneIds, assignments }
}
