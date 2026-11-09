import type { Lane, LaneAssignment, Worker } from '../types'

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
