import type { ManualLanePlacement, TrainingPairLock } from '../types'
import { trainingPairLockedIds } from './trainingPairing'

/**
 * Seats to hold out of the free auto-assign pool:
 * 2 per training pair, plus 1 per manual placement whose worker is not already
 * locked by a training pair.
 */
export function reservedSeatsByLane(
  trainingPairs: TrainingPairLock[] | undefined,
  manualPlacements: ManualLanePlacement[] | undefined,
): Map<string, number> {
  const reserved = new Map<string, number>()
  for (const pair of trainingPairs ?? []) {
    reserved.set(pair.laneId, (reserved.get(pair.laneId) ?? 0) + 2)
  }
  const locked = trainingPairLockedIds(trainingPairs)
  for (const placement of manualPlacements ?? []) {
    if (locked.has(placement.workerId)) continue
    reserved.set(
      placement.laneId,
      (reserved.get(placement.laneId) ?? 0) + 1,
    )
  }
  return reserved
}

/** Drop preferred-lane pins that conflict with an active training lock. */
export function manualsCompatibleWithTraining(
  placements: ManualLanePlacement[] | undefined,
  trainingPairs: TrainingPairLock[] | undefined,
): ManualLanePlacement[] {
  const locked = trainingPairLockedIds(trainingPairs)
  return (placements ?? []).filter(
    (placement) => !locked.has(placement.workerId),
  )
}
