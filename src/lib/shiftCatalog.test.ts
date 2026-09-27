import { describe, expect, it } from 'vitest'
import { continuesIntoShift, laneOpenDuring } from './shiftCatalog'

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
