import { describe, expect, it } from 'vitest'
import { buildWhatsAppText } from './export'

describe('buildWhatsAppText lane notes', () => {
  it('formats a single-line note clearly', () => {
    const text = buildWhatsAppText('2026-03-16', 'morning', [
      { laneName: 'נתיב 1', workers: ['דני'], notes: 'בדיקת תעודות' },
    ])
    expect(text).toContain('📝 *הערה לנתיב:* בדיקת תעודות')
    expect(text).toContain('• *נתיב 1:* דני')
  })

  it('formats multi-line notes as bullets', () => {
    const text = buildWhatsAppText('2026-03-16', 'afternoon', [
      {
        laneName: 'נתיב 2',
        workers: ['רוני', 'מיכל'],
        notes: 'שורה א\nשורה ב',
      },
    ])
    expect(text).toContain('📝 *הערה לנתיב:*')
    expect(text).toContain('• שורה א')
    expect(text).toContain('• שורה ב')
  })
})
