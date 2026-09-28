import { describe, expect, it } from 'vitest'
import {
  currentShiftModel,
  defaultShiftModels,
  formatShiftModelWindow,
  resolveShiftModels,
} from './shiftModels'

describe('shift models', () => {
  it('gives inspectors three shifts and selectors four', () => {
    expect(defaultShiftModels('inspectors').map((m) => m.name)).toEqual([
      'בוקר',
      'צהריים',
      'לילה',
    ])
    expect(defaultShiftModels('selectors').map((m) => m.id)).toEqual([
      'morning',
      'afternoonA',
      'afternoonB',
      'night',
    ])
  })

  it('uses saved models instead of the defaults', () => {
    const custom = [
      { id: 'early', name: 'מוקדמת', startMinutes: 5 * 60, endMinutes: 13 * 60, order: 0 },
    ]
    expect(resolveShiftModels(custom, 'inspectors')).toEqual(custom)
    expect(resolveShiftModels([], 'inspectors')).toHaveLength(3)
  })

  it('marks an overnight window', () => {
    const night = defaultShiftModels('inspectors')[2]!
    expect(formatShiftModelWindow(night)).toBe('21:30 עד 06:00 (למחרת)')
  })

  it('keeps a late-night clock on the previous date', () => {
    const models = defaultShiftModels('inspectors')
    const ctx = currentShiftModel(models, new Date(2026, 8, 29, 2, 0))
    expect(ctx.model.id).toBe('night')
    expect(ctx.date).toBe('2026-09-28')
  })
})
