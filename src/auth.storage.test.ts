import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAppDataCache,
  clearClientAuthStorage,
  hydrateAppDataCache,
  loadAppDataCache,
  saveAppDataCache,
  saveSession,
  type SessionUser,
} from './auth'
import { clearClientCacheKey } from './lib/clientCacheCrypto'
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
  workerWindowPresets: [],
  revision: 1,
})

const manager = (): SessionUser => ({
  id: 'u1',
  fullName: 'Test',
  phone: '0500000000',
  token: 'tok',
  role: 'org_manager',
  orgId: 'org-1',
  orgName: 'Org',
  modules: { selectors: true, inspectors: true, security: false },
  module: 'inspectors',
  isOrgManager: true,
})

describe('client app-data cache', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    clearClientCacheKey()
  })

  afterEach(() => {
    clearClientAuthStorage()
    clearClientCacheKey()
    vi.unstubAllGlobals()
  })

  it('keeps presets in the in-memory cache immediately', () => {
    const presets = [
      { id: '0600-1500', label: 'בוקר', start: 360, end: 900, order: 0 },
    ]
    saveSession(manager())
    saveAppDataCache({ ...emptyData(), workerWindowPresets: presets })

    expect(loadAppDataCache()?.workerWindowPresets).toEqual(presets)
  })

  it('persists encrypted disk data and hydrates it with the tab key', async () => {
    const presets = [
      { id: '0600-1500', label: 'בוקר', start: 360, end: 900, order: 0 },
    ]
    saveSession(manager())
    saveAppDataCache({ ...emptyData(), workerWindowPresets: presets })

    const diskKey = 'shibutzon-app-data-v3:org-1:inspectors'
    await vi.waitFor(() => {
      const raw = localStorage.getItem(diskKey)
      expect(raw?.startsWith('enc:v1:')).toBe(true)
      expect(raw).not.toContain('בוקר')
      expect(raw).not.toContain('"workers"')
    })

    const encrypted = localStorage.getItem(diskKey)!
    clearAppDataCache()
    expect(loadAppDataCache()).toBeNull()
    localStorage.setItem(diskKey, encrypted)

    const hydrated = await hydrateAppDataCache()
    expect(hydrated?.workerWindowPresets).toEqual(presets)
  })

  it('fails closed after logout because the AES key is wiped', async () => {
    saveSession(manager())
    saveAppDataCache(emptyData())
    const diskKey = 'shibutzon-app-data-v3:org-1:inspectors'
    await vi.waitFor(() => {
      expect(localStorage.getItem(diskKey)?.startsWith('enc:v1:')).toBe(true)
    })
    const encrypted = localStorage.getItem(diskKey)!
    clearClientAuthStorage()
    saveSession(manager())
    localStorage.setItem(diskKey, encrypted)
    expect(await hydrateAppDataCache()).toBeNull()
  })

  it('ignores legacy plaintext snapshots on disk', async () => {
    saveSession(manager())
    localStorage.setItem(
      'shibutzon-app-data-v3:org-1:inspectors',
      JSON.stringify({ ...emptyData(), workerWindowPresets: undefined }),
    )
    expect(await hydrateAppDataCache()).toBeNull()
    expect(localStorage.getItem('shibutzon-app-data-v3:org-1:inspectors')).toBeNull()
  })

  it('clears session, drafts, all module caches, and portal session cache', () => {
    const user = { ...manager(), module: 'selectors' as const }
    saveSession(user)
    saveAppDataCache(emptyData())
    localStorage.setItem(
      'shibutzon-app-data-v3:org-1:inspectors',
      'enc:v1:dead.beef',
    )
    localStorage.setItem(
      'shibutzon-app-data-v2:org-1:inspectors',
      JSON.stringify(emptyData()),
    )
    localStorage.setItem('shibutzon-draft', '{}')
    localStorage.setItem('shibutzon-draft-v3', 'enc:v1:x.y')
    localStorage.setItem('shibutzon-shift-step', 'board')
    sessionStorage.setItem('getin.worker.home.u1', '{}')
    sessionStorage.setItem('getin.worker.history.u1', '{}')

    clearClientAuthStorage()

    expect(localStorage.getItem('shibutzon-session')).toBeNull()
    expect(localStorage.getItem('shibutzon-draft')).toBeNull()
    expect(localStorage.getItem('shibutzon-draft-v3')).toBeNull()
    expect(localStorage.getItem('shibutzon-shift-step')).toBeNull()
    expect(localStorage.getItem('shibutzon-app-data-v3:org-1:selectors')).toBeNull()
    expect(localStorage.getItem('shibutzon-app-data-v3:org-1:inspectors')).toBeNull()
    expect(localStorage.getItem('shibutzon-app-data-v2:org-1:inspectors')).toBeNull()
    expect(sessionStorage.getItem('getin.worker.home.u1')).toBeNull()
    expect(sessionStorage.getItem('getin.worker.history.u1')).toBeNull()
    expect(loadAppDataCache()).toBeNull()
  })
})
