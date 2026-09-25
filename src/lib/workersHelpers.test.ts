import { describe, expect, it } from 'vitest'
import type { Lane, Worker } from '../types'
import {
  RARE_CERT_HOLDER_THRESHOLD,
  certHolderCounts,
  compareWorkers,
  digitsOnlyPhone,
  filterWorkers,
  findDuplicateWorkers,
  formatIsraeliMobile,
  formsEqual,
  isRareCert,
  isValidEmail,
  isValidIsraeliMobile,
  lanesOpenedByCert,
  noCertTooltip,
  openLanesCount,
  orderedCertifications,
  typedNameMatches,
  validateWorkerForm,
  workerMatchesQuery,
  workerShiftHistoryCount,
} from './workersHelpers'

const catalog = ['כללי', 'מכס', 'מובילות', 'טסלה']

function w(partial: Partial<Worker> & Pick<Worker, 'id' | 'fullName'>): Worker {
  return {
    phone: '0501234567',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
    ...partial,
  }
}

describe('israeli phone', () => {
  it('validates mobile', () => {
    expect(isValidIsraeliMobile('050-867-6524')).toBe(true)
    expect(isValidIsraeliMobile('0508676524')).toBe(true)
    expect(isValidIsraeliMobile('03-1234567')).toBe(false)
    expect(isValidIsraeliMobile('050123')).toBe(false)
  })

  it('formats', () => {
    expect(formatIsraeliMobile('0508676524')).toBe('050-867-6524')
    expect(digitsOnlyPhone('050-867-6524')).toBe('0508676524')
  })
})

describe('email', () => {
  it('validates', () => {
    expect(isValidEmail('a@b.com')).toBe(true)
    expect(isValidEmail('bad')).toBe(false)
  })
})

describe('orderedCertifications', () => {
  it('follows catalog order', () => {
    expect(orderedCertifications(catalog, ['טסלה', 'כללי', 'מכס'])).toEqual([
      'כללי',
      'מכס',
      'טסלה',
    ])
  })
})

describe('search and filter', () => {
  const workers = [
    w({ id: '1', fullName: 'אביב חי', phone: '050-867-6524', certifications: ['מכס', 'טסלה'], isManager: true }),
    w({ id: '2', fullName: 'דני כהן', phone: '0521234567', certifications: ['כללי'], status: 'inactive' }),
    w({ id: '3', fullName: 'יעל לוי', phone: '0539998877', certifications: ['מכס', 'כללי'] }),
  ]

  it('matches name and phone digits', () => {
    expect(workerMatchesQuery(workers[0], 'אביב')).toBe(true)
    expect(workerMatchesQuery(workers[0], '050867')).toBe(true)
    expect(workerMatchesQuery(workers[0], '999')).toBe(false)
  })

  it('filters with AND certifications', () => {
    const both = filterWorkers(workers, {
      query: '',
      statusTab: 'all',
      role: 'all',
      certs: ['מכס', 'טסלה'],
    })
    expect(both.map((x) => x.id)).toEqual(['1'])
  })

  it('filters status and role', () => {
    expect(
      filterWorkers(workers, {
        query: '',
        statusTab: 'inactive',
        role: 'all',
        certs: [],
      }).map((x) => x.id),
    ).toEqual(['2'])
    expect(
      filterWorkers(workers, {
        query: '',
        statusTab: 'all',
        role: 'manager',
        certs: [],
      }).map((x) => x.id),
    ).toEqual(['1'])
    expect(
      filterWorkers(workers, {
        query: '',
        statusTab: 'all',
        role: 'inspector',
        certs: [],
      }).map((x) => x.id),
    ).toEqual(['1', '2', '3'])
  })

  it('keeps dual-role in both filters; manager-only only in manager', () => {
    const list = [
      w({ id: 'dual', fullName: 'דואלי', isManager: true, isInspector: true }),
      w({
        id: 'mgr',
        fullName: 'מנהל בלבד',
        isManager: true,
        isInspector: false,
      }),
      w({ id: 'insp', fullName: 'בודק', isManager: false, isInspector: true }),
    ]
    expect(
      filterWorkers(list, {
        query: '',
        statusTab: 'all',
        role: 'manager',
        certs: [],
      }).map((x) => x.id),
    ).toEqual(['dual', 'mgr'])
    expect(
      filterWorkers(list, {
        query: '',
        statusTab: 'all',
        role: 'inspector',
        certs: [],
      }).map((x) => x.id),
    ).toEqual(['dual', 'insp'])
  })
})

describe('sorting and duplicates', () => {
  it('sorts by name', () => {
    const a = w({ id: 'a', fullName: 'ב' })
    const b = w({ id: 'b', fullName: 'א' })
    expect(compareWorkers(b, a, 'name', 'asc')).toBeLessThan(0)
  })

  it('finds duplicates without blocking', () => {
    const workers = [
      w({ id: '1', fullName: 'אביב', phone: '0501111111' }),
      w({ id: '2', fullName: 'אביב', phone: '0502222222' }),
    ]
    const d = findDuplicateWorkers(workers, { fullName: 'אביב', phone: '0501111111' }, '1')
    expect(d.sameName).toHaveLength(1)
    expect(d.samePhone).toHaveLength(0)
  })
})

describe('lane cert helpers', () => {
  const lanes: Lane[] = [
    {
      id: 'l1',
      name: 'פתוח',
      requiredCertifications: [],
      intensity: 'easy',
      staffingStandard: 1,
    },
    {
      id: 'l2',
      name: 'מכס',
      requiredCertifications: ['מכס'],
      intensity: 'hard',
      staffingStandard: 1,
    },
    {
      id: 'l3',
      name: 'מכס+טסלה',
      requiredCertifications: ['מכס', 'טסלה'],
      intensity: 'hard',
      staffingStandard: 2,
    },
  ]

  it('counts open lanes and cert openings', () => {
    expect(openLanesCount(lanes)).toBe(1)
    expect(lanesOpenedByCert(lanes, 'מכס')).toBe(2)
    expect(noCertTooltip(lanes)).toContain('פתוחים')
  })

  it('marks rare certs under threshold', () => {
    const workers = [
      w({ id: '1', fullName: 'א', certifications: ['טסלה'] }),
      w({ id: '2', fullName: 'ב', certifications: ['מכס'] }),
      w({ id: '3', fullName: 'ג', certifications: ['מכס'] }),
      w({ id: '4', fullName: 'ד', certifications: ['מכס'] }),
    ]
    const counts = certHolderCounts(workers, catalog)
    expect(isRareCert(counts.get('טסלה') ?? 0)).toBe(true)
    expect(isRareCert(counts.get('מכס') ?? 0)).toBe(false)
    expect(RARE_CERT_HOLDER_THRESHOLD).toBe(3)
  })
})

describe('validation and history', () => {
  it('validates form for managers', () => {
    expect(
      validateWorkerForm({
        fullName: '',
        phone: '050',
        certifications: [],
        status: 'active',
        isInspector: true,
        isManager: true,
        email: '',
      }),
    ).toMatchObject({
      fullName: expect.any(String),
      phone: expect.any(String),
      email: expect.any(String),
    })
    expect(
      validateWorkerForm({
        fullName: 'אביב',
        phone: '0508676524',
        certifications: [],
        status: 'active',
        isInspector: true,
        isManager: false,
      }),
    ).toEqual({})
    expect(
      validateWorkerForm({
        fullName: 'מנהל',
        phone: '0508676524',
        certifications: [],
        status: 'active',
        isInspector: false,
        isManager: false,
        email: 'a@b.com',
      }).role,
    ).toBeTruthy()
  })

  it('typed name gate and dirty check', () => {
    expect(typedNameMatches('  אביב חי  ', 'אביב חי')).toBe(true)
    expect(typedNameMatches('אחר', 'אביב חי')).toBe(false)
    expect(
      formsEqual(
        {
          fullName: 'א',
          phone: '050-111-1111',
          email: 'A@B.com',
          certifications: ['מכס'],
          status: 'active',
          isInspector: true,
          isManager: false,
        },
        {
          fullName: 'א',
          phone: '0501111111',
          email: 'a@b.com',
          certifications: ['מכס'],
          status: 'active',
          isInspector: true,
          isManager: false,
        },
      ),
    ).toBe(true)
  })

  it('counts shift history appearances', () => {
    const history = [
      {
        id: 's1',
        date: '2026-01-01',
        shiftType: 'morning' as const,
        activeLaneIds: ['l1'],
        presentWorkerIds: ['w1'],
        assignments: [{ laneId: 'l1', workerIds: ['w1'] }],
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 's2',
        date: '2026-01-02',
        shiftType: 'morning' as const,
        activeLaneIds: ['l1'],
        presentWorkerIds: ['w2'],
        assignments: [{ laneId: 'l1', workerIds: ['w2'] }],
        createdAt: '',
        updatedAt: '',
      },
    ]
    expect(workerShiftHistoryCount(history, 'w1')).toBe(1)
    expect(workerShiftHistoryCount(history, 'w9')).toBe(0)
  })
})
