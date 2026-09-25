import { describe, expect, it } from 'vitest'
import {
  activeAttendanceWorkers,
  computeUnassignedWorkerIds,
  createGateManagerLane,
  ensureGateManagerLane,
  laneStaffPresentIds,
  managedLanes,
  normalizeGateManagerId,
  syncGateManagerPlacement,
} from './gateManager'
import type { Lane, Worker } from '../types'

function w(partial: Partial<Worker> & Pick<Worker, 'id'>): Worker {
  return {
    fullName: partial.fullName ?? partial.id,
    phone: '050',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
    ...partial,
  }
}

describe('gateManager helpers', () => {
  it('excludes manager-only accounts from attendance pool', () => {
    const list = [
      w({ id: 'i', isInspector: true, isManager: false }),
      w({ id: 'm', isInspector: false, isManager: true }),
      w({ id: 'both', isInspector: true, isManager: true }),
      w({ id: 'x', status: 'inactive', isInspector: true }),
    ]
    expect(activeAttendanceWorkers(list).map((x) => x.id)).toEqual([
      'i',
      'both',
    ])
  })

  it('excludes gate manager from lane-staff / unassigned', () => {
    const present = ['a', 'b', 'g']
    expect(laneStaffPresentIds(present, 'g')).toEqual(['a', 'b'])
    expect(
      computeUnassignedWorkerIds(
        present,
        [{ laneId: 'l1', workerIds: ['a'] }],
        'g',
      ),
    ).toEqual(['b'])
  })

  it('normalizes gate manager to present active manager+inspector only', () => {
    const workers = [
      w({ id: 'm', isManager: true, isInspector: false }),
      w({ id: 'both', isManager: true, isInspector: true }),
      w({ id: 'i', isManager: false, isInspector: true }),
    ]
    expect(normalizeGateManagerId('m', ['m', 'i', 'both'], workers)).toBeUndefined()
    expect(normalizeGateManagerId('both', ['m', 'i', 'both'], workers)).toBe(
      'both',
    )
    expect(normalizeGateManagerId('i', ['m', 'i', 'both'], workers)).toBeUndefined()
    expect(normalizeGateManagerId('both', ['i'], workers)).toBeUndefined()
  })

  it('auto-places gate manager on מנהל שער lane', () => {
    const gate = createGateManagerLane('gate')
    const other: Lane = {
      id: 'l1',
      name: 'נתיב 1',
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: 'medium',
    }
    const synced = syncGateManagerPlacement({
      lanes: [other, gate],
      activeLaneIds: ['l1'],
      assignments: [{ laneId: 'l1', workerIds: ['insp'] }],
      gateManagerWorkerId: 'mgr',
    })
    expect(synced.activeLaneIds).toContain('gate')
    expect(
      synced.assignments.find((a) => a.laneId === 'gate')?.workerIds,
    ).toEqual(['mgr'])
    expect(
      synced.assignments.find((a) => a.laneId === 'l1')?.workerIds,
    ).toEqual(['insp'])
    expect(
      computeUnassignedWorkerIds(
        ['insp', 'mgr'],
        synced.assignments,
        'mgr',
      ),
    ).toEqual([])
  })

  it('ensures catalog has gate manager lane as medium station', () => {
    const lanes = ensureGateManagerLane([], () => 'new-gate')
    expect(lanes).toHaveLength(1)
    expect(lanes[0]?.name).toBe('מנהל שער')
    expect(lanes[0]?.intensity).toBe('medium')
    expect(lanes[0]?.staffingStandard).toBe(1)
  })

  it('normalizes existing gate manager lane to medium', () => {
    const drifted = createGateManagerLane('g')
    drifted.intensity = 'hard'
    drifted.staffingStandard = 3
    const lanes = ensureGateManagerLane([drifted], () => 'x')
    expect(lanes).toHaveLength(1)
    expect(lanes[0]?.intensity).toBe('medium')
    expect(lanes[0]?.staffingStandard).toBe(1)
  })

  it('managedLanes excludes gate manager station', () => {
    const gate = createGateManagerLane('g')
    const other: Lane = {
      id: 'l1',
      name: 'נתיב 1',
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: 'medium',
    }
    expect(managedLanes([other, gate]).map((l) => l.id)).toEqual(['l1'])
  })
})
