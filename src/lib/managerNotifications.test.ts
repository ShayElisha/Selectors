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

  it('creates a notice near shift end', () => {
    const now = new Date()
    now.setHours(14, 40, 0, 0)
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const notice = ensureShiftEndNotice({
      shiftId: `s-${Date.now()}`,
      date: `${y}-${m}-${d}`,
      shiftType: 'morning',
      signedOff: false,
      withinMinutes: 45,
      now,
    })
    expect(notice?.kind).toBe('shift_end')
    expect(listManagerNotices().length).toBeGreaterThan(0)
    markAllManagerNoticesRead()
    expect(listManagerNotices().every((n) => n.read)).toBe(true)
  })
})
