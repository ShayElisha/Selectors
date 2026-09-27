import { describe, expect, it } from 'vitest'
import { continuesIntoShift } from './shiftCatalog'

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
})
