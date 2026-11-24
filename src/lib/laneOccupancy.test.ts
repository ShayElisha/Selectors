import { describe, expect, it } from 'vitest'
import type { Lane, ShiftSchedule } from '../types'
import {
  applySeatOccupancyChange,
  laneOccupancyRowsForShift,
} from './laneOccupancy'

const lane = (id: string, name: string): Lane => ({
  id,
  name,
  staffingStandard: 1,
  requiredCertifications: [],
  intensity: 'medium',
})

const models = [
  {
    id: 'afternoon',
    name: 'צהריים',
    startMinutes: 14 * 60 + 30,
    endMinutes: 21 * 60 + 30,
    order: 1,
  },
]

function shift(partial: Partial<ShiftSchedule>): ShiftSchedule {
  return {
    id: 's1',
    date: '2026-11-24',
    shiftType: 'afternoon',
    presentWorkerIds: [],
    activeLaneIds: ['a'],
    assignments: [],
    createdAt: '',
    updatedAt: '',
    ...partial,
  }
}

describe('laneOccupancyRowsForShift', () => {
  it('shows sequential occupants with clear time ranges instead of a flat duo', () => {
    const rows = laneOccupancyRowsForShift(
      shift({
        activeLaneIds: ['lane-1'],
        assignments: [{ laneId: 'lane-1', workerIds: ['b'] }],
        seatSpan: { startMinutes: 870, endMinutes: 1290 },
        seatSegments: [
          { workerId: 'a', laneId: 'lane-1', fromMinutes: 870, toMinutes: 1110 },
          { workerId: 'b', laneId: 'lane-1', fromMinutes: 1110, toMinutes: 1290 },
        ],
      }),
      new Map([['lane-1', lane('lane-1', 'נתיב 11-12')]]),
      models,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.peakConcurrent).toBe(1)
    expect(rows[0]?.occupants.map((item) => item.label)).toEqual([
      '14:30–18:30',
      '18:30–21:30',
    ])
    expect(rows[0]?.occupants.map((item) => item.workerId)).toEqual(['a', 'b'])
  })

  it('rebuilds a timeline from operation events when seat segments are missing', () => {
    const rows = laneOccupancyRowsForShift(
      shift({
        activeLaneIds: ['lane-1'],
        assignments: [{ laneId: 'lane-1', workerIds: ['b'] }],
        shiftOperationEvents: [
          {
            id: 'e1',
            kind: 'worker_removed',
            effectiveAt: new Date(2026, 10, 24, 18, 30).toISOString(),
            recordedAt: new Date(2026, 10, 24, 18, 35).toISOString(),
            actorId: 'm',
            actorName: 'מנהל',
            workerId: 'a',
            workerName: 'אופק',
            fromLaneId: 'lane-1',
            fromLaneName: 'נתיב 11-12',
          },
          {
            id: 'e2',
            kind: 'worker_assigned',
            effectiveAt: new Date(2026, 10, 24, 18, 30).toISOString(),
            recordedAt: new Date(2026, 10, 24, 18, 35).toISOString(),
            actorId: 'm',
            actorName: 'מנהל',
            workerId: 'b',
            workerName: 'לביא',
            toLaneId: 'lane-1',
            toLaneName: 'נתיב 11-12',
          },
        ],
      }),
      new Map([['lane-1', lane('lane-1', 'נתיב 11-12')]]),
      models,
    )

    expect(rows[0]?.peakConcurrent).toBe(1)
    expect(rows[0]?.occupants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workerId: 'a', label: '14:30–18:30' }),
        expect.objectContaining({ workerId: 'b', label: '18:30–21:30' }),
      ]),
    )
  })

  it('clips displayed ranges to personal worker windows', () => {
    const rows = laneOccupancyRowsForShift(
      shift({
        activeLaneIds: ['lane-1', 'lane-2'],
        assignments: [
          { laneId: 'lane-1', workerIds: ['oriya'] },
          { laneId: 'lane-2', workerIds: ['rachel'] },
        ],
        workerWindows: {
          oriya: '1430-1830',
          rachel: '1800-2130',
        },
        workerWindowPresets: [
          {
            id: '1430-1830',
            label: 'עד 18:30',
            start: 14 * 60 + 30,
            end: 18 * 60 + 30,
          },
          {
            id: '1800-2130',
            label: 'מ-18:00',
            start: 18 * 60,
            end: 21 * 60 + 30,
          },
        ],
      }),
      new Map([
        ['lane-1', lane('lane-1', 'נתיב 11-12')],
        ['lane-2', lane('lane-2', 'נתיב 13-14')],
      ]),
      models,
    )

    expect(rows.find((row) => row.laneId === 'lane-1')?.occupants).toEqual([
      expect.objectContaining({ workerId: 'oriya', label: '14:30–18:30' }),
    ])
    expect(rows.find((row) => row.laneId === 'lane-2')?.occupants).toEqual([
      expect.objectContaining({ workerId: 'rachel', label: '18:00–21:30' }),
    ])
  })
})

describe('applySeatOccupancyChange', () => {
  it('closes the leaving worker and opens the incoming one at the handoff minute', () => {
    const next = applySeatOccupancyChange({
      segments: [
        { workerId: 'a', laneId: 'lane-1', fromMinutes: 870, toMinutes: 1290 },
      ],
      span: { startMinutes: 870, endMinutes: 1290 },
      atMinutes: 1110,
      removed: { workerId: 'a', laneId: 'lane-1' },
      added: { workerId: 'b', laneId: 'lane-1' },
    })
    expect(next).toEqual([
      { workerId: 'a', laneId: 'lane-1', fromMinutes: 870, toMinutes: 1110 },
      { workerId: 'b', laneId: 'lane-1', fromMinutes: 1110, toMinutes: 1290 },
    ])
  })
})
