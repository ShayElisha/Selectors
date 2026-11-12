import { describe, it, expect } from 'vitest'
import {
  normalizeManualPlacements,
  pruneManualPlacements,
  manualPlacementLockedIds,
  applyManualPlacementsToAssignments,
  filterManuallyPlacedFromPool,
} from './manualPlacements'
import type { Lane, ManualLanePlacement, Worker } from '../types'

const lane = (id: string, std: number): Lane => ({
  id,
  name: `Lane ${id}`,
  staffingStandard: std as 1 | 2 | 3 | 4 | 5,
  requiredCertifications: [],
  intensity: 'medium',
})

const worker = (id: string): Worker => ({
  id,
  fullName: `Worker ${id}`,
  phone: '',
  certifications: [],
  status: 'active',
  isInspector: true,
  isManager: false,
})

describe('manualPlacements', () => {
  it('normalizeManualPlacements filters invalid entries', () => {
    const input = [
      { workerId: 'w1', laneId: 'L1' },
      { workerId: 'w2', laneId: '' },
      { workerId: '', laneId: 'L2' },
      { workerId: 'w1', laneId: 'L3' },
      null,
      'invalid',
    ]
    const result = normalizeManualPlacements(input)
    expect(result).toEqual([{ workerId: 'w1', laneId: 'L1' }])
  })

  it('pruneManualPlacements removes absent workers and inactive lanes', () => {
    const placements: ManualLanePlacement[] = [
      { workerId: 'w1', laneId: 'L1' },
      { workerId: 'w2', laneId: 'L2' },
      { workerId: 'w3', laneId: 'L3' },
    ]
    const result = pruneManualPlacements(
      placements,
      ['w1', 'w3'],
      ['L1', 'L3'],
    )
    expect(result).toEqual([
      { workerId: 'w1', laneId: 'L1' },
      { workerId: 'w3', laneId: 'L3' },
    ])
  })

  it('manualPlacementLockedIds returns worker ids', () => {
    const placements: ManualLanePlacement[] = [
      { workerId: 'w1', laneId: 'L1' },
      { workerId: 'w2', laneId: 'L2' },
    ]
    const ids = manualPlacementLockedIds(placements)
    expect(ids.has('w1')).toBe(true)
    expect(ids.has('w2')).toBe(true)
    expect(ids.has('w3')).toBe(false)
  })

  it('applyManualPlacementsToAssignments places worker on lane', () => {
    const lanes = [lane('L1', 2), lane('L2', 2)]
    const assignments = [
      { laneId: 'L1', workerIds: ['', ''] },
      { laneId: 'L2', workerIds: ['', ''] },
    ]
    const placements: ManualLanePlacement[] = [{ workerId: 'w1', laneId: 'L1' }]
    
    const result = applyManualPlacementsToAssignments(
      assignments,
      placements,
      lanes,
    )
    
    expect(result.find((r) => r.laneId === 'L1')?.workerIds[0]).toBe('w1')
  })

  it('applyManualPlacementsToAssignments removes worker from other lanes', () => {
    const lanes = [lane('L1', 2), lane('L2', 2)]
    const assignments = [
      { laneId: 'L1', workerIds: ['', ''] },
      { laneId: 'L2', workerIds: ['w1', ''] },
    ]
    const placements: ManualLanePlacement[] = [{ workerId: 'w1', laneId: 'L1' }]
    
    const result = applyManualPlacementsToAssignments(
      assignments,
      placements,
      lanes,
    )
    
    expect(result.find((r) => r.laneId === 'L1')?.workerIds[0]).toBe('w1')
    expect(result.find((r) => r.laneId === 'L2')?.workerIds[0]).toBe('')
  })

  it('filterManuallyPlacedFromPool excludes manually placed workers', () => {
    const workers = [worker('w1'), worker('w2'), worker('w3')]
    const placements: ManualLanePlacement[] = [
      { workerId: 'w1', laneId: 'L1' },
      { workerId: 'w2', laneId: 'L2' },
    ]
    
    const result = filterManuallyPlacedFromPool(workers, placements)
    
    expect(result).toEqual([worker('w3')])
  })
})
