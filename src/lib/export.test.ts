import { describe, expect, it } from 'vitest'
import { buildRoundsWhatsAppText, buildWhatsAppText } from './export'

describe('assignment exports', () => {
  it('sorts inspector lanes alphabetically in the shared text', () => {
    const text = buildWhatsAppText('2026-10-14', 'morning', [
      { laneName: 'נתיב ב', workers: ['שי'] },
      { laneName: 'נתיב א', workers: ['דני'] },
    ])

    expect(text.indexOf('נתיב א')).toBeLessThan(text.indexOf('נתיב ב'))
  })

  it('sorts selector lanes alphabetically in every round', () => {
    const text = buildRoundsWhatsAppText('2026-10-14', 'morning', [
      {
        label: '06:00–08:00',
        lanes: [
          { laneName: 'נתיב ב', workers: ['שי'] },
          { laneName: 'נתיב א', workers: ['דני'] },
        ],
      },
    ])

    expect(text.indexOf('נתיב א')).toBeLessThan(text.indexOf('נתיב ב'))
  })
})
