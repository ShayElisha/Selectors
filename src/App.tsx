import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppProvider, useApp } from './context/AppContext'
import { ThemeProvider, useTheme } from './lib/theme'
import { Shell } from './components/Shell'
import { PageLoader } from './components/PageLoader'
import { HomePage } from './pages/HomePage'
import { ShiftPage } from './pages/ShiftPage'
import { WorkersPage } from './pages/WorkersPage'
import { LanesPage } from './pages/LanesPage'
import { CertsPage } from './pages/CertsPage'
import { HistoryPage } from './pages/HistoryPage'
import { TrackingPage } from './pages/TrackingPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { AuditPage } from './pages/AuditPage'
import { BriefingsPage } from './pages/BriefingsPage'
import { CustomsBrokersPage } from './pages/CustomsBrokersPage'
import { LoginPage } from './pages/LoginPage'
import { PrivacyPage } from './pages/PrivacyPage'

function ProtectedShell() {
  const { user, loading, data } = useApp()
  if (!user) return <Navigate to="/login" replace />
  const hasData = data.workers.length > 0 || data.lanes.length > 0
  if (loading && !hasData) {
    return <PageLoader fullScreen label="טוען נתונים…" />
  }
  return (
    <Shell>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="shift" element={<ShiftPage />} />
        <Route path="shift/:shiftId" element={<ShiftPage />} />
        <Route path="workers" element={<WorkersPage />} />
        <Route path="lanes" element={<LanesPage />} />
        <Route path="certs" element={<CertsPage />} />
        <Route path="briefings" element={<BriefingsPage />} />
        <Route path="customs-brokers" element={<CustomsBrokersPage />} />
        <Route path="tracking" element={<TrackingPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="history/:shiftId" element={<HistoryPage />} />
        <Route path="history-matrix" element={<Navigate to="/history" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <AppToaster />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/*" element={<ProtectedShell />} />
        </Routes>
      </AppProvider>
    </ThemeProvider>
  )
}

function AppToaster() {
  const { theme } = useTheme()
  return (
    <Toaster
      theme={theme}
      position="top-center"
      dir="rtl"
      richColors
      closeButton
      expand
      gap={10}
      offset={16}
      toastOptions={{
        classNames: {
          toast: 'font-[family-name:var(--font-sans)] text-sm',
          title: 'font-semibold',
          description: 'text-[13px]',
        },
      }}
    />
  )
}
