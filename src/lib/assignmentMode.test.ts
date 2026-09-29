import { describe, expect, it } from 'vitest'
import {
  assignmentModeOf,
  normalizeAssignmentModes,
  usesRounds,
} from './assignmentMode'

describe('assignment modes', () => {
  it('keeps the previous default for each section', () => {
    expect(normalizeAssignmentModes(undefined)).toEqual({
      selectors: 'rounds',
      inspectors: 'single',
    })
    expect(
      normalizeAssignmentModes({ selectors: 'single', inspectors: 'rounds' }),
    ).toEqual({ selectors: 'single', inspectors: 'rounds' })
  })

  it('reads a saved mode before older selector data', () => {
    expect(
      assignmentModeOf({ audience: 'selector', assignmentMode: 'single' }),
    ).toBe('single')
    expect(usesRounds({ audience: 'inspector', assignmentMode: 'rounds' })).toBe(
      true,
    )
  })

  it('treats older selector shifts as rounds and inspector shifts as one placement', () => {
    expect(usesRounds({ audience: 'selector' })).toBe(true)
    expect(usesRounds({ audience: 'inspector' })).toBe(false)
    expect(usesRounds({})).toBe(false)
  })
})