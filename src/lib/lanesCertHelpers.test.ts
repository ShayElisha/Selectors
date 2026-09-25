import { describe, expect, it } from 'vitest'
import type { Lane, Worker } from '../types'
import {
  QUALIFIED_THIN_MARGIN,
  activeInspectors,
  canDeleteCertification,
  certStatusKind,
  certUsage,
  compareLanes,
  coverageTone,
  isDuplicateCertName,
  isDuplicateLaneName,
  laneHistoryCount,
  orderedLaneCerts,
  qualifiedCountForLane,
  summarizeLanes,
  thinDependentLanesCount,
} from './lanesCertHelpers'

function lane(
  partial: Partial<Lane> & Pick<Lane, 'id' | 'name'>,
): Lane {
  return {
    staffingStandard: 1,
    requiredCertifications: [],
    intensity: 'medium',
    afternoonHandoff: false,
    ...partial,
  }
}

function worker(
  partial: Partial<Worker> & Pick<Worker, 'id' | 'fullName'>,
): Worker {
  return {
    phone: '0501111111',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
    ...partial,
  }
}

describe('qualified coverage', () => {
  const workers = [
    worker({ id: '1', fullName: 'א', certifications: ['מכס'] }),
    worker({ id: '2', fullName: 'ב', certifications: ['מכס', 'טסלה'] }),
    worker({ id: '3', fullName: 'ג', certifications: [], status: 'inactive' }),
  ]
  const l = lane({
    id: 'l1',
    name: 'מכס',
    requiredCertifications: ['מכס'],
    staffingStandard: 2,
  })

  it('counts only active inspectors', () => {
    expect(qualifiedCountForLane(l, workers)).toEqual({
      qualified: 2,
      active: 2,
    })
  })

  it('excludes manager-only from active inspectors', () => {
    const list = [
      worker({ id: '1', fullName: 'בודק', isInspector: true, isManager: false }),
      worker({
        id: '2',
        fullName: 'מנהל',
        isInspector: false,
        isManager: true,
      }),
      worker({
        id: '3',
        fullName: 'שניהם',
        isInspector: true,
        isManager: true,
      }),
    ]
    expect(activeInspectors(list).map((w) => w.id)).toEqual(['1', '3'])
  })

  it('tones by threshold', () => {
    expect(coverageTone(1, 2)).toBe('error')
    expect(coverageTone(2, 2)).toBe('warn')
    expect(coverageTone(2 + QUALIFIED_THIN_MARGIN + 1, 2)).toBe('ok')
  })
})

describe('cert usage and delete gate', () => {
  const workers = [
    worker({ id: '1', fullName: 'א', certifications: ['מכס'] }),
  ]
  const lanes = [
    lane({ id: 'l1', name: 'א', requiredCertifications: ['מכס'] }),
    lane({ id: 'l2', name: 'ב', requiredCertifications: ['טסלה'] }),
  ]

  it('counts usage and dangling', () => {
    expect(certUsage('מכס', workers, lanes)).toEqual({
      workers: 1,
      lanes: 1,
      activeWorkers: 1,
    })
    expect(certStatusKind({ workers: 0, lanes: 1 })).toBe('dangling_req')
    expect(certStatusKind({ workers: 0, lanes: 0 })).toBe('unused')
    expect(canDeleteCertification({ workers: 1, lanes: 0 })).toBe(false)
    expect(canDeleteCertification({ workers: 0, lanes: 0 })).toBe(true)
  })

  it('detects duplicates', () => {
    expect(isDuplicateCertName(['כללי', 'מכס'], '  מכס ')).toBe(true)
    expect(isDuplicateLaneName(lanes, 'א')).toBe(true)
    expect(isDuplicateLaneName(lanes, 'א', 'l1')).toBe(false)
  })
})

describe('lane helpers', () => {
  const lanes = [
    lane({ id: 'a', name: 'ב', intensity: 'hard', staffingStandard: 2 }),
    lane({ id: 'b', name: 'א', intensity: 'easy', staffingStandard: 1 }),
  ]

  it('summarizes and orders certs', () => {
    expect(summarizeLanes(lanes)).toMatchObject({
      count: 2,
      totalStandard: 3,
      easy: 1,
      hard: 1,
    })
    expect(orderedLaneCerts(['כללי', 'מכס', 'טסלה'], ['טסלה', 'כללי'])).toEqual([
      'כללי',
      'טסלה',
    ])
  })

  it('sorts and counts history', () => {
    const q = new Map([
      ['a', 1],
      ['b', 5],
    ])
    expect(compareLanes(lanes[1]!, lanes[0]!, 'name', 'asc', q)).toBeLessThan(0)
    expect(
      laneHistoryCount(
        [
          {
            id: 's1',
            date: '2026-01-01',
            shiftType: 'morning',
            activeLaneIds: ['a'],
            presentWorkerIds: [],
            assignments: [{ laneId: 'a', workerIds: ['w1'] }],
            createdAt: '',
            updatedAt: '',
          },
        ],
        'a',
      ),
    ).toBe(1)
  })

  it('counts thin-dependent lanes', () => {
    const workers = [
      worker({ id: '1', fullName: 'א', certifications: ['טסלה'] }),
      worker({ id: '2', fullName: 'ב', certifications: ['מכס', 'מכס'] }),
      worker({ id: '3', fullName: 'ג', certifications: ['מכס'] }),
      worker({ id: '4', fullName: 'ד', certifications: ['מכס'] }),
    ]
    const thinLanes = [
      lane({ id: '1', name: 'ט', requiredCertifications: ['טסלה'] }),
      lane({ id: '2', name: 'מ', requiredCertifications: ['מכס'] }),
    ]
    expect(thinDependentLanesCount(thinLanes, workers)).toBe(1)
  })
})
