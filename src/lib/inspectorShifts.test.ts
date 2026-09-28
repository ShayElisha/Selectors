import { describe, expect, it } from 'vitest'
import {
  formatInspectorShiftWindow,
  getInspectorShiftContext,
  INSPECTOR_SHIFT_TYPES,
} from './inspectorShifts'

describe('inspector shifts', () => {
  it('offers only morning, afternoon, and night', () => {
    expect(INSPECTOR_SHIFT_TYPES).toEqual(['morning', 'afternoon', 'night'])
  })

  it('uses the gate-out windows', () => {
    expect(formatInspectorShiftWindow('morning')).toBe('06:00 עד 14:30')
    expect(formatInspectorShiftWindow('afternoon')).toBe('14:30 עד 21:30')
    expect(formatInspectorShiftWindow('night')).toBe('21:30 עד 06:00 (למחרת)')
  })

  it('picks the afternoon shift in the late day', () => {
    const ctx = getInspectorShiftContext(new Date(2026, 8, 28, 17, 8))
    expect(ctx.shiftType).toBe('afternoon')
    expect(ctx.date).toBe('2026-09-28')
  })

  it('keeps the night after midnight on the previous date', () => {
    const ctx = getInspectorShiftContext(new Date(2026, 8, 29, 2, 0))
    expect(ctx.shiftType).toBe('night')
    expect(ctx.date).toBe('2026-09-28')
  })
})
