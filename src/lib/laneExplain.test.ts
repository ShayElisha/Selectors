import { describe, expect, it } from 'vitest'
import { buildLaneSummaries, buildLaneSummaryText } from './laneExplain'
import type { Lane, Worker } from '../types'

const lane: Lane = {
  id: 'L1',
  name: 'שער א',
  staffingStandard: 2,
  requiredCertifications: ['X'],
  intensity: 'hard',
}

const worker: Worker = {
  id: 'w1',
  fullName: 'Test',
  phone: '0500000000',
  certifications: ['X'],
  status: 'active',
  isInspector: true,
  isManager: false,
}

describe('laneExplain', () => {
  it('buildLaneSummaryText includes count, cert and strategy', () => {
    const text = buildLaneSummaryText(
      lane,
      2,
      ['רוטציה טובה מהעמדה'],
      undefined,
    )
    expect(text).toContain('2 משובצים')
    expect(text).toContain('X')
    expect(text).toContain('רוטציה')
  })

  it('buildLaneSummaries maps lane ids', () => {
    const map = buildLaneSummaries(
      [
        {
          laneId: 'L1',
          workerId: 'w1',
          reasons: ['ביקור אחרון לפני 5 ימים'],
        },
        {
          laneId: 'L1',
          workerId: 'w2',
          reasons: ['עומס נמוך'],
        },
      ],
      [lane],
      [worker],
    )
    expect(map.get('L1')).toMatch(/2 משובצים/)
  })
})
