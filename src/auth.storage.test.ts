import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearClientAuthStorage,
  saveAppDataCache,
  saveSession,
  type SessionUser,
} from './auth'
import type { AppData } from './types'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
  }
}

const emptyData = (): AppData => ({
  workers: [],
  lanes: [],
  history: [],
  certificationsCatalog: [],
  briefingSections: [],
  questionBank: [],
  customsBrokers: [],
  shiftModels: [],
  incidents: [],
  revision: 1,
})

describe('clearClientAuthStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears session, drafts, all module caches, and portal session cache', () => {
    const user: SessionUser = {
      id: 'u1',
      fullName: 'Test',
      phone: '0500000000',
      token: 'tok',
      role: 'org_manager',
      orgId: 'org-1',
      orgName: 'Org',
      modules: { selectors: true, inspectors: true, security: false },
      module: 'selectors',
      isOrgManager: true,
    }
    saveSession(user)
    saveAppDataCache(emptyData())
    localStorage.setItem(
      'shibutzon-app-data-v2:org-1:inspectors',
      JSON.stringify(emptyData()),
    )
    localStorage.setItem('shibutzon-draft', '{}')
    localStorage.setItem('shibutzon-shift-step', 'board')
    sessionStorage.setItem('getin.worker.home.u1', '{}')
    sessionStorage.setItem('getin.worker.history.u1', '{}')

    clearClientAuthStorage()

    expect(localStorage.getItem('shibutzon-session')).toBeNull()
    expect(localStorage.getItem('shibutzon-draft')).toBeNull()
    expect(localStorage.getItem('shibutzon-shift-step')).toBeNull()
    expect(localStorage.getItem('shibutzon-app-data-v2:org-1:selectors')).toBeNull()
    expect(localStorage.getItem('shibutzon-app-data-v2:org-1:inspectors')).toBeNull()
    expect(sessionStorage.getItem('getin.worker.home.u1')).toBeNull()
    expect(sessionStorage.getItem('getin.worker.history.u1')).toBeNull()
  })
})
