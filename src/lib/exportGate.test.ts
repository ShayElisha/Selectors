import { describe, expect, it } from 'vitest'
import { exportBlockedReason } from './exportGate'

describe('exportBlockedReason', () => {
  it('blocks when the shift was never saved to history', () => {
    expect(
      exportBlockedReason({
        draftId: 'draft-1',
        historyIds: ['other'],
        draftDirty: false,
      }),
    ).toMatch(/שמרו את השיבוץ/)
  })

  it('blocks when there are unsaved edits', () => {
    expect(
      exportBlockedReason({
        draftId: 'draft-1',
        historyIds: ['draft-1'],
        draftDirty: true,
      }),
    ).toMatch(/שינויים שלא נשמרו/)
    expect(
      exportBlockedReason({
        draftId: 'draft-1',
        historyIds: ['draft-1'],
        draftDirty: false,
        boardDirty: true,
      }),
    ).toMatch(/שינויים שלא נשמרו/)
  })

  it('allows export of a clean saved shift', () => {
    expect(
      exportBlockedReason({
        draftId: 'draft-1',
        historyIds: ['draft-1'],
        draftDirty: false,
        boardDirty: false,
      }),
    ).toBeNull()
  })
})
