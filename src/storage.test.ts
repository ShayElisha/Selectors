import { describe, expect, it } from 'vitest'
import { createSeedData } from './storage'

describe('createSeedData', () => {
  it('starts without hardcoded organization data', () => {
    expect(createSeedData()).toEqual({
      workers: [],
      lanes: [],
      history: [],
      certificationsCatalog: [],
      briefingSections: [],
      questionBank: [],
      customsBrokers: [],
      revision: 0,
    })
  })
})
