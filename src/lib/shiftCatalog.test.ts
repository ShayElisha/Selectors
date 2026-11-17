import { describe, expect, it } from 'vitest'
import {
  continuesIntoShift,
  laneOpenDuring,
  presetsOverlappingShift,
  windowFitsShift,
} from './shiftCatalog'

describe('continuesIntoShift', () => {
  it('keeps morning staff in afternoon A only while their hours last', () => {
    expect(continuesIntoShift('morning', '0600-1500', 'afternoonA')).toBe(false)
    expect(continuesIntoShift('morning', '0600-1730', 'afternoonA')).toBe(true)
    expect(continuesIntoShift('morning', '0600-1830', 'afternoonA')).toBe(true)
    expect(continuesIntoShift('morning', '0600-1730', 'afternoonB')).toBe(false)
    expect(continuesIntoShift('morning', '0600-1830', 'afternoonB')).toBe(true)
    expect(continuesIntoShift('morning', undefined, 'afternoonA')).toBe(false)
    expect(continuesIntoShift('morning', undefined, 'afternoonB')).toBe(false)
  })

  it('keeps afternoon A staff in afternoon B only past 18:00', () => {
    expect(continuesIntoShift('afternoonA', '1430-2130', 'afternoonB')).toBe(true)
    expect(continuesIntoShift('afternoonA', '0600-1730', 'afternoonB')).toBe(false)
    expect(continuesIntoShift('afternoonA', '0600-1830', 'afternoonB')).toBe(false)
    expect(continuesIntoShift('afternoonA', undefined, 'afternoonB')).toBe(false)
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

describe('windowFitsShift', () => {
  it('allows morning windows on morning and blocks afternoon-only windows', () => {
    expect(windowFitsShift(undefined, 'morning')).toBe(true)
    expect(windowFitsShift('0600-1500', 'morning')).toBe(true)
    expect(windowFitsShift('0445-1500', 'morning')).toBe(true)
    expect(windowFitsShift('1430-2130', 'morning')).toBe(false)
  })

  it('allows afternoon-native and continuing morning windows only', () => {
    expect(windowFitsShift('1430-2130', 'afternoon')).toBe(true)
    expect(windowFitsShift('0600-1730', 'afternoon')).toBe(true)
    expect(windowFitsShift('0600-1830', 'afternoon')).toBe(true)
    expect(windowFitsShift('0600-1500', 'afternoon')).toBe(false)
    expect(windowFitsShift('0445-1500', 'afternoon')).toBe(false)
  })

  it('lists matching presets only', () => {
    const morningIds = presetsOverlappingShift('morning').map((p) => p.id)
    expect(morningIds).toContain('0600-1500')
    expect(morningIds).not.toContain('1430-2130')
    const afternoonIds = presetsOverlappingShift('afternoon').map((p) => p.id)
    expect(afternoonIds).toContain('1430-2130')
    expect(afternoonIds).toContain('0600-1730')
    expect(afternoonIds).not.toContain('0600-1500')
  })
})
