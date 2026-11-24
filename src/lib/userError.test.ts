import { describe, expect, it } from 'vitest'
import { ApiError } from '../api'
import {
  shouldOfferErrorRetry,
  userErrorMessage,
  userErrorTitle,
} from './userError'

describe('userError', () => {
  it('keeps Hebrew API messages and classifies edit-lock conflicts', () => {
    const err = new ApiError('שחר עורך כרגע את המשמרת הזו', 409)
    expect(userErrorMessage(err)).toBe('שחר עורך כרגע את המשמרת הזו')
    expect(userErrorTitle(err.message, 409)).toBe('עריכה חסומה')
    expect(shouldOfferErrorRetry(err.message, 409)).toBe(false)
  })

  it('maps network failures to a clear connection message', () => {
    expect(userErrorMessage(new Error('Failed to fetch'))).toMatch(/אין חיבור/)
    expect(userErrorTitle('אין חיבור לשרת כרגע')).toBe('בעיית חיבור')
  })

  it('titles validation blocks without offering a server retry', () => {
    const msg = 'לא ניתן לשמור — נשארו 2 אנשים שלא שובצו לעמדה'
    expect(userErrorTitle(msg)).toBe('לא ניתן להשלים')
    expect(shouldOfferErrorRetry(msg)).toBe(false)
  })
})
