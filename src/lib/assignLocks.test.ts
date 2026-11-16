import { describe, it, expect } from 'vitest'
import {
  manualsCompatibleWithTraining,
  reservedSeatsByLane,
} from './assignLocks'
import {
  applyManualPlacementsToAssignments,
} from './manualPlacements'
import { applyTrainingPairsToAssignments } from './trainingPairing'
import type { Lane, ManualLanePlacement, TrainingPairLock } from '../types'

const lane = (id: string, std: number): Lane => ({
  id,
  name: `Lane ${id}`,
  staffingStandard: std as 1 | 2 | 3 | 4 | 5,
  requiredCertifications: [],
  intensity: 'medium',
})

describe('assignLocks', () => {
  it('reserves two seats per training pair and one per free manual pin', () => {
    const pairs: TrainingPairLock[] = [
      { traineeId: 't1', mentorId: 'm1', laneId: 'L1' },
    ]
    const manuals: ManualLanePlacement[] = [
      { workerId: 'w1', laneId: 'L1' },
      { workerId: 'm1', laneId: 'L2' },
      { workerId: 'w2', laneId: 'L2' },
    ]
    const reserved = reservedSeatsByLane(pairs, manuals)
    expect(reserved.get('L1')).toBe(3) // pair + free manual
    expect(reserved.get('L2')).toBe(1) // mentor pin ignored; w2 only
  })

  it('drops manual pins that conflict with training locks', () => {
    const pairs: TrainingPairLock[] = [
      { traineeId: 't1', mentorId: 'm1', laneId: 'L1' },
    ]
    const manuals: ManualLanePlacement[] = [
      { workerId: 'm1', laneId: 'L2' },
      { workerId: 'w1', laneId: 'L2' },
    ]
    expect(manualsCompatibleWithTraining(manuals, pairs)).toEqual([
      { workerId: 'w1', laneId: 'L2' },
    ])
  })

  it('keeps training pair intact when seating a manual pin into a reserved empty slot', () => {
    const lanes = [lane('L1', 3), lane('L2', 2)]
    const overrides = { L1: 3 as const, L2: 2 as const }
    // Algorithm left empty seats reserved for locks (remaining capacity was 0).
    const padded = [
      { laneId: 'L1', workerIds: ['', '', ''] },
      { laneId: 'L2', workerIds: ['free1', ''] },
    ]
    const pairs: TrainingPairLock[] = [
      { traineeId: 't1', mentorId: 'm1', laneId: 'L1' },
    ]
    const manuals: ManualLanePlacement[] = [
      { workerId: 'pin1', laneId: 'L1' },
    ]
    const withTraining = applyTrainingPairsToAssignments(
      padded,
      pairs,
      lanes,
      overrides,
    )
    expect(withTraining.find((r) => r.laneId === 'L1')?.workerIds).toEqual([
      'm1',
      't1',
      '',
    ])
    const merged = applyManualPlacementsToAssignments(
      withTraining,
      manuals,
      lanes,
      overrides,
    )
    expect(merged.find((r) => r.laneId === 'L1')?.workerIds).toEqual([
      'm1',
      't1',
      'pin1',
    ])
    expect(merged.find((r) => r.laneId === 'L2')?.workerIds).toEqual([
      'free1',
      '',
    ])
  })

  it('does not orphan free workers when training and manual share a full lane', () => {
    const lanes = [lane('L1', 3), lane('L2', 2)]
    const overrides = { L1: 3 as const, L2: 2 as const }
    const pairs: TrainingPairLock[] = [
      { traineeId: 't1', mentorId: 'm1', laneId: 'L1' },
    ]
    const manuals: ManualLanePlacement[] = [
      { workerId: 'pin1', laneId: 'L1' },
    ]
    const reserved = reservedSeatsByLane(pairs, manuals)
    expect(reserved.get('L1')).toBe(3)
    // Remaining algorithm capacity for L1 is 0 — free workers go elsewhere.
    const padded = [
      { laneId: 'L1', workerIds: ['', '', ''] },
      { laneId: 'L2', workerIds: ['free1', 'free2'] },
    ]
    const withTraining = applyTrainingPairsToAssignments(
      padded,
      pairs,
      lanes,
      overrides,
    )
    const merged = applyManualPlacementsToAssignments(
      withTraining,
      manuals,
      lanes,
      overrides,
    )
    const seated = new Set(
      merged.flatMap((row) => row.workerIds.filter(Boolean)),
    )
    expect(seated).toEqual(new Set(['m1', 't1', 'pin1', 'free1', 'free2']))
  })
})
