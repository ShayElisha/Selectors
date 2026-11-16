import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearManagerNotices,
  ensureShiftEndNotice,
  listManagerNotices,
  markAllManagerNoticesRead,
} from './managerNotifications'

describe('ensureShiftEndNotice', () => {
  beforeEach(() => {
    clearManagerNotices()
  })

  it('does not notify before the shift window ends', () => {
    const now = new Date()
    now.setHours(14, 40, 0, 0)
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const notice = ensureShiftEndNotice({
      shiftId: `s-early-${Date.now()}`,
      date: `${y}-${m}-${d}`,
      shiftType: 'morning',
      signedOff: false,
      now,
    })
    expect(notice).toBeNull()
    expect(listManagerNotices()).toHaveLength(0)
  })

  it('creates a notice only after shift end', () => {
    const now = new Date()
    now.setHours(15, 0, 0, 0)
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const notice = ensureShiftEndNotice({
      shiftId: `s-${Date.now()}`,
      date: `${y}-${m}-${d}`,
      shiftType: 'morning',
      signedOff: false,
      now,
    })
    expect(notice?.kind).toBe('shift_end')
    expect(notice?.title).toContain('הסתיימה')
    expect(listManagerNotices().length).toBeGreaterThan(0)
    markAllManagerNoticesRead()
    expect(listManagerNotices().every((n) => n.read)).toBe(true)
  })
})
