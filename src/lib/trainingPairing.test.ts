import { describe, expect, it } from 'vitest'
import {
  canPlaceTraineeOnLane,
  filterAutoAssignPool,
  isMentor,
  isTrainee,
  laneTrainingIssues,
  normalizeTrainingRole,
  pickLaneWorkersWithTraining,
} from './trainingPairing'
import type { Lane, Worker } from '../types'

function worker(id: string, trainingRole?: Worker['trainingRole']): Worker {
  return {
    id,
    fullName: id,
    phone: '0500000000',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
    trainingRole,
  }
}

function lane(id: string, staffing: Lane['staffingStandard']): Lane {
  return {
    id,
    name: id,
    staffingStandard: staffing,
    requiredCertifications: [],
    intensity: 'medium',
  }
}

describe('trainingPairing', () => {
  it('normalizeTrainingRole keeps trainee/mentor only', () => {
    expect(normalizeTrainingRole('trainee')).toBe('trainee')
    expect(normalizeTrainingRole('mentor')).toBe('mentor')
    expect(normalizeTrainingRole('none')).toBeUndefined()
    expect(normalizeTrainingRole(undefined)).toBeUndefined()
  })

  it('flags solo trainee on lane', () => {
    const workers = [worker('t', 'trainee'), worker('m', 'mentor')]
    const lanes = [lane('L', 2)]
    const issues = laneTrainingIssues(
      [{ laneId: 'L', workerIds: ['t'] }],
      workers,
      lanes,
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]!.laneId).toBe('L')
  })

  it('allows trainee with mentor', () => {
    const workers = [worker('t', 'trainee'), worker('m', 'mentor')]
    const lanes = [lane('L', 2)]
    expect(
      laneTrainingIssues(
        [{ laneId: 'L', workerIds: ['t', 'm'] }],
        workers,
        lanes,
      ),
    ).toHaveLength(0)
  })

  it('canPlaceTraineeOnLane respects staffing', () => {
    const workersById = new Map([
      ['t', worker('t', 'trainee')],
      ['m', worker('m', 'mentor')],
    ])
    const L2 = lane('L', 2)
    expect(canPlaceTraineeOnLane(L2, [], workersById)).toBe(true)
    expect(canPlaceTraineeOnLane(L2, ['x'], workersById)).toBe(false)
    expect(canPlaceTraineeOnLane(lane('S', 1), [], workersById)).toBe(false)
    expect(canPlaceTraineeOnLane(L2, ['m'], workersById)).toBe(true)
  })

  it('filterAutoAssignPool removes trainee when lane cannot pair', () => {
    const workersById = new Map([
      ['t', worker('t', 'trainee')],
      ['n', worker('n')],
    ])
    const pool = [worker('t', 'trainee'), worker('n')]
    const filtered = filterAutoAssignPool(pool, lane('L', 1), [], workersById)
    expect(filtered.map((w) => w.id)).toEqual(['n'])
  })

  it('pickLaneWorkersWithTraining prefers mentor before trainee', () => {
    const workersById = new Map([
      ['t', worker('t', 'trainee')],
      ['m', worker('m', 'mentor')],
      ['n', worker('n')],
    ])
    const ranked = [worker('m', 'mentor'), worker('t', 'trainee')]
    const picked = pickLaneWorkersWithTraining(
      ranked,
      2,
      [],
      lane('L', 2),
      workersById,
    )
    expect(picked.map((w) => w.id)).toEqual(['m', 't'])
  })
})
