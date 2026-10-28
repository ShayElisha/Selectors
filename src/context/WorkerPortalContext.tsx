import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  fetchWorkerHistoryRemote,
  fetchWorkerHomeRemote,
  updateWorkerStatusRemote,
  type WorkerHistoryResponse,
  type WorkerHomeResponse,
} from '../api'
import { useApp } from './AppContext'

const HOME_CACHE_PREFIX = 'getin.worker.home.'
const HISTORY_CACHE_PREFIX = 'getin.worker.history.'

type WorkerPortalValue = {
  home: WorkerHomeResponse | null
  history: WorkerHistoryResponse | null
  loading: boolean
  refreshing: boolean
  historyLoading: boolean
  historyRefreshing: boolean
  error: string | null
  historyError: string | null
  refreshHome: (opts?: { silent?: boolean }) => Promise<void>
  refreshHistory: (opts?: { silent?: boolean }) => Promise<void>
  markArrived: () => Promise<void>
}

const WorkerPortalContext = createContext<WorkerPortalValue | null>(null)

function cacheKey(prefix: string, userId: string | undefined) {
  return userId ? `${prefix}${userId}` : null
}

function readCache<T>(key: string | null): T | null {
  if (!key) return null
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeCache(key: string | null, value: unknown) {
  if (!key) return
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota */
  }
}

export function WorkerPortalProvider({ children }: { children: ReactNode }) {
  const { user } = useApp()
  const homeKey = cacheKey(HOME_CACHE_PREFIX, user?.id)
  const historyKey = cacheKey(HISTORY_CACHE_PREFIX, user?.id)
  const homeRef = useRef<WorkerHomeResponse | null>(null)
  const historyRef = useRef<WorkerHistoryResponse | null>(null)

  const [home, setHome] = useState<WorkerHomeResponse | null>(() => {
    const cached = readCache<WorkerHomeResponse>(homeKey)
    homeRef.current = cached
    return cached
  })
  const [history, setHistory] = useState<WorkerHistoryResponse | null>(() => {
    const cached = readCache<WorkerHistoryResponse>(historyKey)
    historyRef.current = cached
    return cached
  })
  const [loading, setLoading] = useState(() => !homeRef.current)
  const [refreshing, setRefreshing] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(() => !historyRef.current)
  const [historyRefreshing, setHistoryRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const refreshHome = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? Boolean(homeRef.current)
      if (silent) setRefreshing(true)
      else setLoading(true)
      try {
        const next = await fetchWorkerHomeRemote()
        homeRef.current = next
        setHome(next)
        writeCache(homeKey, next)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'טעינת המשמרת נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [homeKey],
  )

  const refreshHistory = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? Boolean(historyRef.current)
      if (silent) setHistoryRefreshing(true)
      else setHistoryLoading(true)
      try {
        const next = await fetchWorkerHistoryRemote()
        historyRef.current = next
        setHistory(next)
        writeCache(historyKey, next)
        setHistoryError(null)
      } catch (e) {
        setHistoryError(
          e instanceof Error ? e.message : 'טעינת ההיסטוריה נכשלה',
        )
      } finally {
        setHistoryLoading(false)
        setHistoryRefreshing(false)
      }
    },
    [historyKey],
  )

  const markArrived = useCallback(async () => {
    const next = await updateWorkerStatusRemote({ kind: 'arrive' })
    homeRef.current = next
    setHome(next)
    writeCache(homeKey, next)
  }, [homeKey])

  useEffect(() => {
    if (!user?.token || user.role !== 'worker') return
    void refreshHome()
  }, [user?.token, user?.role, user?.id, refreshHome])

  const value = useMemo<WorkerPortalValue>(
    () => ({
      home,
      history,
      loading,
      refreshing,
      historyLoading,
      historyRefreshing,
      error,
      historyError,
      refreshHome,
      refreshHistory,
      markArrived,
    }),
    [
      home,
      history,
      loading,
      refreshing,
      historyLoading,
      historyRefreshing,
      error,
      historyError,
      refreshHome,
      refreshHistory,
      markArrived,
    ],
  )

  return (
    <WorkerPortalContext.Provider value={value}>
      {children}
    </WorkerPortalContext.Provider>
  )
}

export function useWorkerPortal() {
  const ctx = useContext(WorkerPortalContext)
  if (!ctx) {
    throw new Error('useWorkerPortal must be used within WorkerPortalProvider')
  }
  return ctx
}
