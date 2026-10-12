import type { AppData } from './types'

export function createSeedData(): AppData {
  return {
    workers: [],
    lanes: [],
    history: [],
    certificationsCatalog: [],
    briefingSections: [],
    questionBank: [],
    customsBrokers: [],
    revision: 0,
  }
}
