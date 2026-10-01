import { describe, expect, it } from 'vitest'
import { earlyLeaveFraction } from './earlyLeave'

describe('early leave load share', () => {
  it('counts a morning worker who leaves at 12 as the hours they stayed', () => {
    const share = earlyLeaveFraction('morning', 12 * 60)
    expect(share).toBeCloseTo(6 / 9, 5)
  })
})
