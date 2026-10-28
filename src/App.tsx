import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { postClientErrorRemote } from './api'
import { AppProvider, useApp } from './context/AppContext'
import { ThemeProvider, useTheme } from './lib/theme'
import { Shell } from './components/Shell'
import { WorkerShell } from './components/WorkerShell'
import { PageLoader } from './components/PageLoader'
import { WorkerPortalProvider } from './context/WorkerPortalContext'
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
import { IncidentsPage } from './pages/IncidentsPage'
import { ShiftModelsPage } from './pages/ShiftModelsPage'
import { CustomsBrokersPage } from './pages/CustomsBrokersPage'
import { OrgSettingsPage } from './pages/OrgSettingsPage'
import { LoginPage } from './pages/LoginPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { RegisterPage } from './pages/RegisterPage'
import { SuperAdminPage } from './pages/SuperAdminPage'
import { AdminErrorsPage } from './pages/AdminErrorsPage'
import { WorkerProfilePage } from './pages/WorkerProfilePage'
import { WorkerHomePage } from './pages/WorkerHomePage'
import { WorkerHistoryPage } from './pages/WorkerHistoryPage'
import { WorkerBriefingsPage } from './pages/WorkerBriefingsPage'
import { WorkerNotificationsPage } from './pages/WorkerNotificationsPage'
import { WorkerHelpPage } from './pages/WorkerHelpPage'
import { WorkerPortalProfilePage } from './pages/WorkerPortalProfilePage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { AlgorithmPage } from './pages/AlgorithmPage'
import { HelpPage } from './pages/HelpPage'
import { ReportPage } from './pages/ReportPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { CancellationsPage } from './pages/CancellationsPage'
import { ShiftHandoffPage } from './pages/ShiftHandoffPage'
import { StationMapPage } from './pages/StationMapPage'
import { isAppPath } from './routes'

function ProtectedWorkerShell() {
  const { user } = useApp()
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'super_admin') return <Navigate to="/admin" replace />
  if (user.role !== 'worker') return <Navigate to="/" replace />
  return (
    <WorkerPortalProvider>
      <WorkerShell>
        <Routes>
          <Route index element={<WorkerHomePage />} />
          <Route path="history" element={<WorkerHistoryPage />} />
          <Route path="briefings" element={<WorkerBriefingsPage />} />
          <Route path="notifications" element={<WorkerNotificationsPage />} />
          <Route path="help" element={<WorkerHelpPage />} />
          <Route path="profile" element={<WorkerPortalProfilePage />} />
          <Route path="password" element={<ChangePasswordPage />} />
          <Route path="*" element={<Navigate to="/worker" replace />} />
        </Routes>
      </WorkerShell>
    </WorkerPortalProvider>
  )
}

function ProtectedShell() {
  const { user, loading, data } = useApp()
  const location = useLocation()
  const path = location.pathname.replace(/\/+$/, '') || '/'
  if (!isAppPath(path)) {
    if (user?.role === 'org_manager') {
      return (
        <Shell>
          <NotFoundPage />
        </Shell>
      )
    }
    return <NotFoundPage standalone />
  }
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'super_admin') return <Navigate to="/admin" replace />
  if (user.role === 'worker') return <Navigate to="/worker" replace />
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
        <Route path="workers/:workerId" element={<WorkerProfilePage />} />
        <Route path="workers" element={<WorkersPage />} />
        <Route path="lanes" element={<LanesPage />} />
        <Route path="certs" element={<CertsPage />} />
        <Route path="briefings" element={<BriefingsPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="shift-models" element={<ShiftModelsPage />} />
        <Route path="customs-brokers" element={<CustomsBrokersPage />} />
        <Route path="settings" element={<OrgSettingsPage />} />
        <Route path="account/password" element={<ChangePasswordPage />} />
        <Route path="tracking" element={<TrackingPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="history/:shiftId" element={<HistoryPage />} />
        <Route path="cancellations" element={<CancellationsPage />} />
        <Route path="handoff" element={<ShiftHandoffPage />} />
        <Route path="station-map" element={<StationMapPage />} />
        <Route path="history-matrix" element={<Navigate to="/history" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <AppToaster />
        <ErrorReporter />
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/admin" element={<SuperAdminPage />} />
            <Route path="/admin/errors" element={<AdminErrorsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/algorithm" element={<AlgorithmPage />} />
            <Route path="/worker/*" element={<ProtectedWorkerShell />} />
            <Route path="/*" element={<ProtectedShell />} />
          </Routes>
        </ErrorBoundary>
      </AppProvider>
    </ThemeProvider>
  )
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void postClientErrorRemote({
      message: error.message,
      stack: `${error.stack || ''}\n${info.componentStack || ''}`,
      path: window.location.pathname,
    }).catch((reportError) => {
      console.warn('client render error report failed', reportError)
    })
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="grid min-h-dvh place-items-center px-4 text-center">
          <div>
            <h1 className="font-display text-xl font-bold text-ink">אירעה שגיאה בטעינת המסך</h1>
            <button
              type="button"
              className="ui-btn ui-btn-primary mt-4"
              onClick={() => window.location.reload()}
            >
              טעינה מחדש
            </button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

function ErrorReporter() {
  useEffect(() => {
    const report = (error: unknown) => {
      const value = error instanceof Error ? error : new Error(String(error))
      void postClientErrorRemote({
        message: value.message,
        stack: value.stack,
        path: window.location.pathname,
      }).catch((reportError) => {
        console.warn('client error report failed', reportError)
      })
    }
    const onError = (event: ErrorEvent) => {
      if (event.error) report(event.error)
      else if (event.message) report(event.message)
    }
    const onRejection = (event: PromiseRejectionEvent) => report(event.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}

function AppToaster() {
  const { theme } = useTheme()
  return (
    <Toaster
      theme={theme === 'dark' ? 'dark' : 'light'}
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
