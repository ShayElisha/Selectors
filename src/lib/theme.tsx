import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const STORAGE_KEY = 'gate-out-theme'

export type ThemeMode = 'light' | 'dark' | 'warm'

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'warm']

export function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'warm' || stored === 'light') return stored
    return 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.classList.toggle('warm', mode === 'warm')
  root.style.colorScheme = mode === 'dark' ? 'dark' : 'light'
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* ignore quota / private mode */
  }
}

type ThemeContextValue = {
  theme: ThemeMode
  setTheme: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const mode = readStoredTheme()
    applyTheme(mode)
    return mode
  })

  const chooseTheme = useCallback((mode: ThemeMode) => {
    if (!THEME_MODES.includes(mode)) return
    applyTheme(mode)
    setTheme(mode)
  }, [])

  const value = useMemo(() => ({ theme, setTheme: chooseTheme }), [theme, chooseTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return ctx
}
