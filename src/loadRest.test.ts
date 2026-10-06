import { describe, expect, it } from 'vitest'
import {
  israelDateISO,
  israelYesterdayISO,
  workerWorkedOnDate,
  workerWorkedOnShift,
  LOAD_REST_DELTA,
} from '../server/loadRest.js'

describe('loadRest helpers', () => {
  it('uses −2 rest delta', () => {
    expect(LOAD_REST_DELTA).toBe(-2)
  })

  it('formats Israel calendar dates', () => {
    const noonUtc = new Date('2026-07-15T12:00:00.000Z')
    expect(israelDateISO(noonUtc)).toBe('2026-07-15')
    expect(israelYesterdayISO(noonUtc)).toBe('2026-07-14')
  })

  it('ignores presence-only and counts real placements', () => {
    const presentOnly = {
      date: '2026-07-14',
      presentWorkerIds: ['a'],
      assignments: [{ laneId: 'hard', workerIds: [] }],
    }
    const placed = {
      date: '2026-07-14',
      presentWorkerIds: ['a'],
      assignments: [{ laneId: 'hard', workerIds: ['a'] }],
    }
    const gate = {
      date: '2026-07-14',
      presentWorkerIds: [],
      assignments: [],
      gateManagerWorkerId: 'a',
    }
    expect(workerWorkedOnShift('a', presentOnly)).toBe(false)
    expect(workerWorkedOnShift('a', placed)).toBe(true)
    expect(workerWorkedOnShift('a', gate)).toBe(true)
    expect(workerWorkedOnDate('a', [presentOnly], '2026-07-14')).toBe(false)
    expect(workerWorkedOnDate('a', [placed], '2026-07-14')).toBe(true)
  })
})
