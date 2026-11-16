import { describe, expect, it } from 'vitest'
import {
  absoluteOnShift,
  customBoundariesForShift,
  normalizeSelectorRoundHours,
  parseSwapClocksForModel,
  previewRoundLabels,
  suggestSwapsFromDuration,
} from './selectorRoundHours'
import type { ShiftModel } from '../types'

const morning: ShiftModel = {
  id: 'morning',
  name: 'בוקר',
  startMinutes: 6 * 60,
  endMinutes: 15 * 60,
  order: 0,
}

const night: ShiftModel = {
  id: 'night',
  name: 'לילה',
  startMinutes: 21 * 60,
  endMinutes: 6 * 60 + 30,
  order: 3,
}

describe('selectorRoundHours', () => {
  it('normalizes settings and builds boundaries from swaps', () => {
    const settings = normalizeSelectorRoundHours({
      enabled: true,
      byShift: { morning: [9 * 60, 12 * 60, 9 * 60] },
    })
    expect(settings.byShift.morning).toEqual([9 * 60, 12 * 60])
    expect(
      customBoundariesForShift(settings, 'morning', {
        start: 6 * 60,
        end: 15 * 60,
      }),
    ).toEqual([6 * 60, 9 * 60, 12 * 60, 15 * 60])
  })

  it('maps overnight clocks onto the absolute timeline', () => {
    expect(absoluteOnShift(0, 21 * 60, 21 * 60 + 9.5 * 60)).toBe(24 * 60)
    expect(parseSwapClocksForModel(['00:00', '03:00'], night)).toEqual([
      24 * 60,
      24 * 60 + 3 * 60,
    ])
  })

  it('suggests uniform swaps and previews labels', () => {
    expect(suggestSwapsFromDuration(6 * 60, 15 * 60, 120)).toEqual([
      8 * 60,
      10 * 60,
      12 * 60,
      14 * 60,
    ])
    expect(previewRoundLabels(6 * 60, 15 * 60, [9 * 60, 12 * 60])).toEqual([
      '06:00–09:00',
      '09:00–12:00',
      '12:00–15:00',
    ])
  })

  it('ignores clocks outside the morning model window', () => {
    expect(parseSwapClocksForModel(['05:00', '08:00', '16:00'], morning)).toEqual([
      8 * 60,
    ])
  })
})
