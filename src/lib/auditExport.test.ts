import { describe, expect, it } from 'vitest'
import {
  auditActionLabel,
  buildAuditCsv,
} from './auditExport'
import type { AuditLogEntry } from '../api'

const row = (
  partial: Partial<AuditLogEntry> & Pick<AuditLogEntry, 'id' | 'action' | 'at'>,
): AuditLogEntry => ({
  id: partial.id,
  at: partial.at,
  action: partial.action,
  details: partial.details ?? '',
  actor: partial.actor === undefined ? null : partial.actor,
})

describe('auditExport', () => {
  it('labels known actions', () => {
    expect(auditActionLabel('login')).toBe('התחברות')
    expect(auditActionLabel('custom_x')).toBe('custom_x')
  })

  it('builds CSV with BOM, headers, and filtered rows', () => {
    const rows = [
      row({
        id: '1',
        at: '2026-09-20T10:00:00.000Z',
        action: 'login',
        details: 'ok',
        actor: { id: 'u1', fullName: 'שי', phone: '050' },
      }),
      row({
        id: '2',
        at: '2026-09-21T11:00:00.000Z',
        action: 'shift_save',
        details: 'שורה\nעם פסיק, וגרש "',
        actor: { id: 'u2', fullName: 'מעיין', phone: '' },
      }),
    ]
    const csv = buildAuditCsv(rows, {
      totalLogs: 10,
      filteredCount: 2,
      action: 'login',
      q: 'שי',
    })
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('יומן פעולות')
    expect(csv).toContain('זמן')
    expect(csv).toContain('התחברות')
    expect(csv).toContain('שמירת שיבוץ')
    expect(csv).toContain('רשומות בייצוא: 2 מתוך 10')
    expect(csv).toContain('פעולה: התחברות')
    // Escaped multiline / comma / quote cell
    expect(csv).toContain('""')
  })
})
