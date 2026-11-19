import { describe, expect, it } from 'vitest'
import {
  boardHoursWeight,
  collectContinuingAttendance,
  continuesIntoShift,
  laneOpenDuring,
  presetsOverlappingShift,
  workerWindowLabelFromTimes,
  windowFitsShift,
  type WorkerWindowPreset,
} from './shiftCatalog'
import type { ShiftModel } from '../types'

// Test fixture: standard worker window presets (same as DEFAULT_WORKER_WINDOW_PRESETS in server)
const testWindowPresets: WorkerWindowPreset[] = [
  { id: '0445-1500', label: 'בוקר מוקדם', name: 'בוקר מוקדם', start: 4 * 60 + 45, end: 15 * 60, order: 0 },
  { id: '0445-1645', label: 'בוקר מוקדם ארוך', name: 'בוקר מוקדם ארוך', start: 4 * 60 + 45, end: 16 * 60 + 45, order: 1 },
  { id: '0445-1730', label: 'בוקר-צהריים מוקדם', name: 'בוקר-צהריים מוקדם', start: 4 * 60 + 45, end: 17 * 60 + 30, order: 2 },
  { id: '0445-1830', label: 'משמרת ארוכה מוקדמת', name: 'משמרת ארוכה מוקדמת', start: 4 * 60 + 45, end: 18 * 60 + 30, order: 3 },
  { id: '0600-1500', label: 'בוקר', name: 'בוקר', start: 6 * 60, end: 15 * 60, order: 4 },
  { id: '0600-1645', label: 'בוקר-צהריים', name: 'בוקר-צהריים', start: 6 * 60, end: 16 * 60 + 45, order: 5 },
  { id: '0600-1730', label: 'בוקר-צהריים ארוך', name: 'בוקר-צהריים ארוך', start: 6 * 60, end: 17 * 60 + 30, order: 6 },
  { id: '0600-1830', label: 'משמרת ארוכה', name: 'משמרת ארוכה', start: 6 * 60, end: 18 * 60 + 30, order: 7 },
  { id: '1430-2130', label: 'צהריים', name: 'צהריים', start: 14 * 60 + 30, end: 21 * 60 + 30, order: 8 },
  { id: '1800-0630', label: 'לילה', name: 'לילה', start: 18 * 60, end: 6 * 60 + 30, order: 9 },
]

describe('workerWindowLabelFromTimes', () => {
  it('formats stored clock minutes as real clock times', () => {
    expect(workerWindowLabelFromTimes(360, 900)).toBe('06:00–15:00')
  })
})

describe('continuesIntoShift', () => {
  it('keeps morning staff in afternoon A only while their hours last', () => {
    expect(continuesIntoShift('morning', '0600-1500', 'afternoonA', testWindowPresets)).toBe(false)
    expect(continuesIntoShift('morning', '0600-1730', 'afternoonA', testWindowPresets)).toBe(true)
    expect(continuesIntoShift('morning', '0600-1830', 'afternoonA', testWindowPresets)).toBe(true)
    expect(continuesIntoShift('morning', '0600-1730', 'afternoonB', testWindowPresets)).toBe(false)
    expect(continuesIntoShift('morning', '0600-1830', 'afternoonB', testWindowPresets)).toBe(true)
    expect(continuesIntoShift('morning', undefined, 'afternoonA', testWindowPresets)).toBe(false)
    expect(continuesIntoShift('morning', undefined, 'afternoonB', testWindowPresets)).toBe(false)
  })

  it('keeps afternoon A staff in afternoon B only past 18:00', () => {
    expect(continuesIntoShift('afternoonA', '1430-2130', 'afternoonB', testWindowPresets)).toBe(true)
    expect(continuesIntoShift('afternoonA', '0600-1730', 'afternoonB', testWindowPresets)).toBe(false)
    expect(continuesIntoShift('afternoonA', '0600-1830', 'afternoonB', testWindowPresets)).toBe(false)
    expect(continuesIntoShift('afternoonA', undefined, 'afternoonB', testWindowPresets)).toBe(false)
  })

  it('assigns a lane only inside its activity hours', () => {
    const hours = [
      { start: 6 * 60, end: 8 * 60 },
      { start: 10 * 60, end: 12 * 60 },
    ]
    expect(laneOpenDuring(hours, 6 * 60, 8 * 60)).toBe(true)
    expect(laneOpenDuring(hours, 8 * 60, 10 * 60)).toBe(false)
    expect(laneOpenDuring(hours, 10 * 60, 12 * 60)).toBe(true)
    expect(laneOpenDuring(undefined, 8 * 60, 10 * 60)).toBe(true)
  })
})

describe('collectContinuingAttendance', () => {
  it('pre-marks morning staff whose hours reach afternoon', () => {
    const result = collectContinuingAttendance({
      history: [
        {
          date: '2026-11-17',
          shiftType: 'morning',
          audience: 'inspector',
          updatedAt: '2026-11-17T10:00:00.000Z',
          presentWorkerIds: ['a', 'b', 'c'],
          gateManagerWorkerId: 'a',
          workerWindows: {
            a: '0600-1730',
            b: '0600-1500',
            c: '0600-1830',
          },
        },
      ],
      date: '2026-11-17',
      shiftType: 'afternoon',
      audience: 'inspector',
      catalog: testWindowPresets,
    })
    expect(result.workerIds).toEqual(['a', 'c'])
    expect(result.workerWindows).toEqual({
      a: '0600-1730',
      c: '0600-1830',
    })
    expect(result.gateManagerWorkerId).toBe('a')
    expect(result.sourceFound).toBe(true)
    expect(result.sourceHadWindows).toBe(true)
  })

  it('does not mark short handover overlap as continuing attendance', () => {
    const models: ShiftModel[] = [
      { id: 'morning', name: 'בוקר', startMinutes: 6 * 60, endMinutes: 14 * 60 + 30, order: 0 },
      { id: 'afternoonA', name: 'צהריים', startMinutes: 14 * 60 + 30, endMinutes: 18 * 60 + 30, order: 1 },
    ]
    const catalog = [
      ...testWindowPresets,
      { id: '0600-1500', label: 'בוקר עד 15:00', start: 6 * 60, end: 15 * 60 },
      { id: '0600-1530', label: 'בוקר עד 15:30', start: 6 * 60, end: 15 * 60 + 30 },
    ]
    const source = {
      date: '2026-11-17',
      shiftType: 'morning',
      updatedAt: '2026-11-17T10:00:00.000Z',
      presentWorkerIds: ['finishes-at-15', 'continues-one-hour'],
      workerWindows: {
        'finishes-at-15': '0600-1500',
        'continues-one-hour': '0600-1530',
      },
    }

    expect(
      collectContinuingAttendance({
        history: [source],
        date: '2026-11-17',
        shiftType: 'afternoonA',
        catalog,
        models,
      }).workerIds,
    ).toEqual(['continues-one-hour'])
  })

  it('uses early departure and adjusted hours when deciding continuation', () => {
    const result = collectContinuingAttendance({
      history: [
        {
          date: '2026-11-17',
          shiftType: 'morning',
          updatedAt: '2026-11-17T10:00:00.000Z',
          presentWorkerIds: ['early-leave', 'early-adjustment'],
          workerWindows: {
            'early-leave': '0600-1830',
            'early-adjustment': '0600-1830',
          },
          earlyLeaveAt: { 'early-leave': 15 * 60 },
          windowAdjustments: {
            'early-adjustment': { earlyMinutes: 3 * 60 + 30 },
          },
        },
      ],
      date: '2026-11-17',
      shiftType: 'afternoonA',
      catalog: testWindowPresets,
    })

    expect(result.workerIds).toEqual([])
  })

  it('reports when morning exists but has no personal hours saved', () => {
    const result = collectContinuingAttendance({
      history: [
        {
          date: '2026-11-17',
          shiftType: 'morning',
          updatedAt: '2026-11-17T10:00:00.000Z',
          presentWorkerIds: ['a'],
        },
      ],
      date: '2026-11-17',
      shiftType: 'afternoon',
    })
    expect(result.workerIds).toEqual([])
    expect(result.sourceFound).toBe(true)
    expect(result.sourceHadWindows).toBe(false)
  })

  it('uses the nearest previous shift hours when a worker appears in multiple shifts', () => {
    const result = collectContinuingAttendance({
      history: [
        {
          date: '2026-11-17',
          shiftType: 'morning',
          audience: 'inspector',
          updatedAt: '2026-11-17T10:00:00.000Z',
          presentWorkerIds: ['a'],
          workerWindows: { a: '0600-1830' },
          windowAdjustments: { a: { lateMinutes: 10 } },
        },
        {
          date: '2026-11-17',
          shiftType: 'afternoonA',
          audience: 'inspector',
          updatedAt: '2026-11-17T15:00:00.000Z',
          presentWorkerIds: ['a'],
          workerWindows: { a: '1430-2130' },
          windowAdjustments: { a: { lateMinutes: 20 } },
        },
      ],
      date: '2026-11-17',
      shiftType: 'afternoonB',
      audience: 'inspector',
      catalog: testWindowPresets,
    })

    expect(result.workerIds).toEqual(['a'])
    expect(result.workerWindows).toEqual({ a: '1430-2130' })
    expect(result.windowAdjustments).toEqual({ a: { lateMinutes: 20 } })
  })

  it('does not use an older long shift when the nearest shift ends before the target starts', () => {
    const result = collectContinuingAttendance({
      history: [
        {
          date: '2026-11-17',
          shiftType: 'morning',
          audience: 'inspector',
          updatedAt: '2026-11-17T10:00:00.000Z',
          presentWorkerIds: ['a'],
          workerWindows: { a: '0600-1830' },
        },
        {
          date: '2026-11-17',
          shiftType: 'afternoonA',
          audience: 'inspector',
          updatedAt: '2026-11-17T17:00:00.000Z',
          presentWorkerIds: ['a'],
          workerWindows: { a: '1430-1730' },
        },
      ],
      date: '2026-11-17',
      shiftType: 'afternoonB',
      audience: 'inspector',
      catalog: [
        ...testWindowPresets,
        { id: '1430-1730', label: 'צהריים קצר', start: 14 * 60 + 30, end: 17 * 60 + 30 },
      ],
    })

    expect(result.workerIds).toEqual([])
    expect(result.workerWindows).toEqual({})
  })

  it('continues a worker from an overnight shift into the next date when hours overlap', () => {
    const models: ShiftModel[] = [
      { id: 'night', name: 'משמרת חוצה חצות', startMinutes: 14 * 60, endMinutes: 2 * 60, order: 0 },
      { id: 'morning', name: 'משמרת מוקדמת', startMinutes: 60, endMinutes: 8 * 60, order: 1 },
    ]
    const history = [
      {
        date: '2026-11-17',
        shiftType: 'night',
        audience: 'inspector',
        updatedAt: '2026-11-17T14:00:00.000Z',
        presentWorkerIds: ['a'],
        workerWindows: { a: '1400-0200' },
      },
    ]
    const target = {
      history,
      date: '2026-11-18',
      shiftType: 'morning' as const,
      audience: 'inspector',
      catalog: [
        ...testWindowPresets,
        { id: '1400-0200', label: '14:00–02:00', start: 14 * 60, end: 2 * 60 },
      ],
      models,
    }

    expect(collectContinuingAttendance(target).workerIds).toEqual(['a'])
    expect(
      collectContinuingAttendance({
        ...target,
        models: [
          models[0],
          { ...models[1], startMinutes: 6 * 60 },
        ],
      }).workerIds,
    ).toEqual([])
  })
})

describe('boardHoursWeight', () => {
  it('is 1 for a full personal morning window', () => {
    expect(boardHoursWeight({ shiftType: 'morning', windowId: '0600-1500', catalog: testWindowPresets })).toBe(1)
    expect(boardHoursWeight({ shiftType: 'morning' })).toBe(1)
  })

  it('scales partial overlap and late/early minutes', () => {
    expect(
      boardHoursWeight({
        shiftType: 'morning',
        windowId: '1430-2130',
        catalog: testWindowPresets,
      }),
    ).toBeCloseTo(30 / (15 * 60 - 6 * 60))
    expect(
      boardHoursWeight({
        shiftType: 'morning',
        windowId: '0600-1500',
        catalog: testWindowPresets,
        lateMinutes: 60,
        earlyMinutes: 30,
      }),
    ).toBeCloseTo((9 * 60 - 90) / (9 * 60))
  })
})

describe('windowFitsShift', () => {
  it('allows morning windows on morning and blocks afternoon-only windows', () => {
    expect(windowFitsShift(undefined, 'morning', testWindowPresets)).toBe(true)
    expect(windowFitsShift('0600-1500', 'morning', testWindowPresets)).toBe(true)
    expect(windowFitsShift('0445-1500', 'morning', testWindowPresets)).toBe(true)
    expect(windowFitsShift('1430-2130', 'morning', testWindowPresets)).toBe(false)
  })

  it('allows afternoon-native and continuing morning windows only', () => {
    expect(windowFitsShift('1430-2130', 'afternoon', testWindowPresets)).toBe(true)
    expect(windowFitsShift('0600-1730', 'afternoon', testWindowPresets)).toBe(true)
    expect(windowFitsShift('0600-1830', 'afternoon', testWindowPresets)).toBe(true)
    expect(windowFitsShift('0600-1500', 'afternoon', testWindowPresets)).toBe(false)
    expect(windowFitsShift('0445-1500', 'afternoon', testWindowPresets)).toBe(false)
  })

  it('lists matching presets only', () => {
    const morningIds = presetsOverlappingShift('morning', testWindowPresets).map((p) => p.id)
    expect(morningIds).toContain('0600-1500')
    expect(morningIds).not.toContain('1430-2130')
    const afternoonIds = presetsOverlappingShift('afternoon', testWindowPresets).map((p) => p.id)
    expect(afternoonIds).toContain('1430-2130')
    expect(afternoonIds).toContain('0600-1730')
    expect(afternoonIds).not.toContain('0600-1500')
  })
})
