import { describe, expect, it } from 'vitest'
import { managerMetrics, parseAutoDurationMs } from './managerMetrics'

describe('managerMetrics', () => {
  it('parses durationMs from audit details', () => {
    expect(parseAutoDurationMs('שיבוץ · durationMs=1200')).toBe(1200)
    expect(parseAutoDurationMs('זמן 900 ms')).toBe(900)
    expect(parseAutoDurationMs('ללא זמן')).toBeNull()
  })

  it('aggregates per manager with override rate and avg duration', () => {
    const rows = managerMetrics(
      [
        {
          action: 'auto_assign',
          at: '2026-03-01T10:00:00.000Z',
          actor: { id: 'm1', fullName: 'דני', phone: '' },
          details: 'x · durationMs=1000',
        },
        {
          action: 'auto_assign',
          at: '2026-03-01T10:05:00.000Z',
          actor: { id: 'm1', fullName: 'דני', phone: '' },
          details: 'y · durationMs=3000',
        },
        {
          action: 'manual_assign',
          at: '2026-03-01T11:00:00.000Z',
          actor: { id: 'm1', fullName: 'דני', phone: '' },
          details: 'תיקון',
        },
        {
          action: 'manual_swap',
          at: '2026-03-02T11:00:00.000Z',
          actor: { id: 'm2', fullName: 'מיה', phone: '' },
          details: 'החלפה',
        },
      ],
      '2026-03-01',
      '2026-03-31',
    )
    const danny = rows.find((row) => row.managerId === 'm1')
    expect(danny?.autoCount).toBe(2)
    expect(danny?.manualCount).toBe(1)
    expect(danny?.overrideRate).toBeCloseTo(1 / 3)
    expect(danny?.avgAutoDurationMs).toBe(2000)
    expect(rows.find((row) => row.managerId === 'm2')?.manualCount).toBe(1)
  })
})
