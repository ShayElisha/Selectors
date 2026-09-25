import { describe, expect, it } from 'vitest'
import type { Lane, Worker } from '../types'
import {
  boardsEqual,
  classifyWarning,
  countAssignmentChanges,
  formatOptimizationInfo,
  optimizationInfoFromSwaps,
  partitionWarnings,
  snapshotBoard,
  staffingChipKind,
  validateBoard,
} from './boardHelpers'

function lane(
  partial: Partial<Lane> & Pick<Lane, 'id' | 'name'>,
): Lane {
  return {
    staffingStandard: 1,
    requiredCertifications: [],
    intensity: 'medium',
    ...partial,
  }
}

function worker(
  partial: Partial<Worker> & Pick<Worker, 'id' | 'fullName'>,
): Worker {
  return {
    phone: '0501111111',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
    ...partial,
  }
}

describe('classifyWarning', () => {
  it('splits known algorithm strings', () => {
    expect(
      classifyWarning(
        'אין עובדים מוסמכים לנתיב "מכס" — מגבלת הסמכות מונעת מילוי נתיב חובה',
      ),
    ).toBe('error')
    expect(
      classifyWarning(
        'נתיב "מכס" נשאר ריק — לנוכחים הנותרים אין את ההסמכות הנדרשות',
      ),
    ).toBe('error')
    expect(
      classifyWarning(
        'נתיב "א" — הורחב מאגר המועמדים כי לא היו מספיק עם מרווח טוב מהעמדה',
      ),
    ).toBe('warning')
    expect(classifyWarning('שיפור לוח: 1 החלפות ב־2 סיבובים')).toBe('info')
  })

  it('formats optimization info', () => {
    expect(formatOptimizationInfo('שיפור לוח: 1 החלפות ב־2 סיבובים')).toBe(
      'בוצעה החלפה אחת לשיפור האיזון',
    )
    expect(optimizationInfoFromSwaps(3)).toBe(
      'בוצעו 3 החלפות לשיפור האיזון',
    )
    expect(
      partitionWarnings([
        'שיפור לוח: 2 החלפות ב־1 סיבובים',
        'אין עובדים מוסמכים לנתיב "x"',
      ]).info,
    ).toHaveLength(1)
  })
})

describe('board snapshot', () => {
  it('detects unsaved changes', () => {
    const a = snapshotBoard([
      { laneId: 'l1', workerIds: ['w1'], notes: '' },
    ])
    const b = snapshotBoard([
      { laneId: 'l1', workerIds: ['w2'], notes: '' },
    ])
    expect(boardsEqual(a, a)).toBe(true)
    expect(boardsEqual(a, b)).toBe(false)
    expect(countAssignmentChanges(a, b)).toBeGreaterThan(0)
  })
})

describe('validateBoard', () => {
  it('flags duplicate and unqualified', () => {
    const lanes = [
      lane({
        id: 'l1',
        name: 'מכס',
        requiredCertifications: ['מכס'],
        intensity: 'hard',
      }),
      lane({ id: 'l2', name: 'פתוח' }),
    ]
    const workers = [
      worker({ id: 'w1', fullName: 'א', certifications: [] }),
      worker({ id: 'w2', fullName: 'ב', certifications: ['מכס'] }),
    ]
    const issues = validateBoard({
      assignments: [
        { laneId: 'l1', workerIds: ['w1'] },
        { laneId: 'l2', workerIds: ['w1'] },
      ],
      lanes,
      workers,
      history: [],
      date: '2026-09-20',
      shiftType: 'morning',
    })
    expect(issues.some((i) => i.code === 'duplicate_worker')).toBe(true)
    const unqualified = issues.find((i) => i.code === 'unqualified')
    expect(unqualified).toBeTruthy()
    expect(unqualified?.severity).toBe('warning')
  })

  it('staffing chip kinds', () => {
    expect(staffingChipKind(1, 1)).toBe('ok')
    expect(staffingChipKind(2, 1)).toBe('over')
    expect(staffingChipKind(0, 1)).toBe('under')
  })
})
