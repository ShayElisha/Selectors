import type {
  Lane,
  LaneAssignment,
  SelectorRound,
  TrainingPairLock,
  Worker,
} from '../types'
import { effectiveStaffingStandard } from './shiftStaffing'
import type { StaffingOverrides } from './shiftStaffing'

export function normalizeTrainingRole(
  value: unknown,
): Worker['trainingRole'] {
  if (value === 'trainee' || value === 'mentor') return value
  return undefined
}

export function isTrainee(w: Worker | undefined): boolean {
  return w?.trainingRole === 'trainee'
}

export function isMentor(w: Worker | undefined): boolean {
  return w?.trainingRole === 'mentor'
}

export function laneHasMentor(
  workerIds: string[],
  workersById: Map<string, Worker>,
): boolean {
  return workerIds.some((id) => id && isMentor(workersById.get(id)))
}

function laneHasTrainee(
  workerIds: string[],
  workersById: Map<string, Worker>,
): boolean {
  return workerIds.some((id) => id && isTrainee(workersById.get(id)))
}

export function laneTrainingIssues(
  assignments: LaneAssignment[],
  workers: Worker[],
  lanes: Lane[],
): { laneId: string; message: string }[] {
  const workersById = new Map(workers.map((w) => [w.id, w]))
  const laneById = new Map(lanes.map((l) => [l.id, l]))
  const issues: { laneId: string; message: string }[] = []

  for (const row of assignments) {
    const lane = laneById.get(row.laneId)
    if (!lane) continue
    const seated = row.workerIds.filter(Boolean)
    if (!laneHasTrainee(seated, workersById)) continue
    if (!laneHasMentor(seated, workersById)) {
      issues.push({
        laneId: lane.id,
        message: `נתיב "${lane.name}": מתלמד משובץ בלי חונך מוסמך באותה עמדה`,
      })
    }
  }
  return issues
}

/** Single-seat add: trainee allowed only with mentor already there or room left on lane. */
export function canPlaceTraineeOnLane(
  lane: Lane,
  seatedIds: string[],
  workersById: Map<string, Worker>,
): boolean {
  const seated = seatedIds.filter(Boolean)
  if (laneHasMentor(seated, workersById)) return true
  const filledAfter = seated.length + 1
  return filledAfter < lane.staffingStandard
}

export function filterAutoAssignPool(
  pool: Worker[],
  lane: Lane,
  seatedIds: string[],
  workersById: Map<string, Worker>,
): Worker[] {
  return pool.filter((w) => {
    if (!isTrainee(w)) return true
    return canPlaceTraineeOnLane(lane, seatedIds, workersById)
  })
}

/** Greedy multi-pick: seat mentors before trainees; never close a lane solo-trainee. */
export function pickLaneWorkersWithTraining(
  ranked: Worker[],
  needed: number,
  seatedIds: string[],
  lane: Lane,
  workersById: Map<string, Worker>,
): Worker[] {
  const picked: Worker[] = []
  const seated = () => [...seatedIds.filter(Boolean), ...picked.map((p) => p.id)]

  const tryPick = (list: Worker[]) => {
    for (const w of list) {
      if (picked.length >= needed) return
      if (picked.some((p) => p.id === w.id)) continue
      if (isTrainee(w)) {
        const ids = [...seated(), w.id]
        if (!laneHasMentor(ids, workersById) && ids.length >= lane.staffingStandard) {
          continue
        }
        if (
          !laneHasMentor(ids, workersById) &&
          !ranked.some(
            (c) =>
              isMentor(c) && !ids.includes(c.id) && !picked.some((p) => p.id === c.id),
          ) &&
          picked.length + 1 >= needed
        ) {
          continue
        }
        if (!canPlaceTraineeOnLane(lane, seated(), workersById)) continue
      }
      picked.push(w)
    }
  }

  tryPick(ranked.filter((w) => isMentor(w)))
  tryPick(ranked.filter((w) => !isMentor(w) && !isTrainee(w)))
  tryPick(ranked.filter((w) => isTrainee(w)))
  return picked.slice(0, needed)
}

export function assignmentsTrainingLegal(
  assignments: LaneAssignment[],
  workers: Worker[],
  lanes: Lane[],
): boolean {
  return laneTrainingIssues(assignments, workers, lanes).length === 0
}

export function placementAllowedForTraining(
  workerId: string,
  laneId: string,
  assignments: LaneAssignment[],
  workersById: Map<string, Worker>,
  laneById: Map<string, Lane>,
  replacingWorkerId?: string | null,
): boolean {
  const w = workersById.get(workerId)
  if (!isTrainee(w)) return true
  const lane = laneById.get(laneId)
  if (!lane) return false
  const row = assignments.find((a) => a.laneId === laneId)
  const seated =
    row?.workerIds.filter((id) => id && id !== replacingWorkerId) ?? []
  return canPlaceTraineeOnLane(lane, seated, workersById)
}

export function normalizeTrainingPairs(raw: unknown): TrainingPairLock[] {
  if (!Array.isArray(raw)) return []
  const out: TrainingPairLock[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const traineeId = String((item as TrainingPairLock).traineeId || '').trim()
    const mentorId = String((item as TrainingPairLock).mentorId || '').trim()
    const laneId = String((item as TrainingPairLock).laneId || '').trim()
    if (!traineeId || !mentorId || !laneId) continue
    if (traineeId === mentorId) continue
    if (seen.has(traineeId)) continue
    seen.add(traineeId)
    out.push({ traineeId, mentorId, laneId })
  }
  return out
}

/** Keep only pairs whose people are still present and lane is still active. */
export function pruneTrainingPairs(
  pairs: TrainingPairLock[] | undefined,
  presentIds: string[],
  activeLaneIds: string[],
  workersById: Map<string, Worker>,
): TrainingPairLock[] {
  const present = new Set(presentIds)
  const lanes = new Set(activeLaneIds)
  return normalizeTrainingPairs(pairs).filter((pair) => {
    if (!present.has(pair.traineeId) || !present.has(pair.mentorId)) return false
    if (!lanes.has(pair.laneId)) return false
    if (!isTrainee(workersById.get(pair.traineeId))) return false
    if (!isMentor(workersById.get(pair.mentorId))) return false
    return true
  })
}

export function trainingPairLockedIds(
  pairs: TrainingPairLock[] | undefined,
): Set<string> {
  const ids = new Set<string>()
  for (const pair of pairs ?? []) {
    ids.add(pair.traineeId)
    ids.add(pair.mentorId)
  }
  return ids
}

function seatPairOnLane(
  assignments: LaneAssignment[],
  pair: TrainingPairLock,
  lanes: Lane[],
  overrides?: StaffingOverrides | null,
): LaneAssignment[] {
  const lane = lanes.find((item) => item.id === pair.laneId)
  if (!lane) return assignments
  const std = Math.max(2, effectiveStaffingStandard(lane, overrides))
  const byLane = new Map(assignments.map((row) => [row.laneId, { ...row }]))
  for (const row of byLane.values()) {
    row.workerIds = row.workerIds.map((id) =>
      id === pair.traineeId || id === pair.mentorId ? '' : id,
    )
  }
  const existing = byLane.get(pair.laneId)
  const others = [...(existing?.workerIds ?? [])].filter(
    (id) => id && id !== pair.traineeId && id !== pair.mentorId,
  )
  const nextIds = [
    pair.mentorId,
    pair.traineeId,
    ...others.slice(0, Math.max(0, std - 2)),
  ]
  while (nextIds.length < std) nextIds.push('')
  byLane.set(pair.laneId, {
    laneId: pair.laneId,
    workerIds: nextIds,
    notes: existing?.notes,
  })
  return [...byLane.values()]
}

/** Force locked trainee+mentor onto their lane (single board). */
export function applyTrainingPairsToAssignments(
  assignments: LaneAssignment[],
  pairs: TrainingPairLock[] | undefined,
  lanes: Lane[],
  overrides?: StaffingOverrides | null,
): LaneAssignment[] {
  let next = assignments.map((row) => ({
    ...row,
    workerIds: [...row.workerIds],
  }))
  for (const pair of pairs ?? []) {
    next = seatPairOnLane(next, pair, lanes, overrides)
  }
  return next
}

/** Force locked pairs onto every round of a selector board. */
export function applyTrainingPairsToRounds(
  rounds: SelectorRound[],
  pairs: TrainingPairLock[] | undefined,
  lanes: Lane[],
  overrides?: StaffingOverrides | null,
): SelectorRound[] {
  if (!pairs?.length) return rounds
  return rounds.map((round) => ({
    ...round,
    assignments: applyTrainingPairsToAssignments(
      round.assignments,
      pairs,
      lanes,
      overrides,
    ),
  }))
}
