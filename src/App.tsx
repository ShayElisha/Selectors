import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { postClientErrorRemote } from './api'
import { AppProvider, useApp } from './context/AppContext'
import { ThemeProvider, useTheme } from './lib/theme'
import { Shell } from './components/Shell'
import {
  LegacyWorkerPortalRedirect,
  WorkerShell,
} from './components/WorkerShell'
import {
  isAppModule,
  workerPortalHomePath,
  type AppModule,
} from './auth'
import { PageLoader } from './components/PageLoader'
import { WorkerPortalProvider } from './context/WorkerPortalContext'
import { isAppPath } from './routes'

const HomePage = lazy(() => import('./pages/HomePage').then((page) => ({ default: page.HomePage })))
const ShiftPage = lazy(() => import('./pages/ShiftPage').then((page) => ({ default: page.ShiftPage })))
const WorkersPage = lazy(() => import('./pages/WorkersPage').then((page) => ({ default: page.WorkersPage })))
const LanesPage = lazy(() => import('./pages/LanesPage').then((page) => ({ default: page.LanesPage })))
const CertsPage = lazy(() => import('./pages/CertsPage').then((page) => ({ default: page.CertsPage })))
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((page) => ({ default: page.HistoryPage })))
const TrackingPage = lazy(() => import('./pages/TrackingPage').then((page) => ({ default: page.TrackingPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((page) => ({ default: page.AnalyticsPage })))
const AuditPage = lazy(() => import('./pages/AuditPage').then((page) => ({ default: page.AuditPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((page) => ({ default: page.ReportsPage })))
const BriefingsPage = lazy(() => import('./pages/BriefingsPage').then((page) => ({ default: page.BriefingsPage })))
const IncidentsPage = lazy(() => import('./pages/IncidentsPage').then((page) => ({ default: page.IncidentsPage })))
const ShiftModelsPage = lazy(() => import('./pages/ShiftModelsPage').then((page) => ({ default: page.ShiftModelsPage })))
const WorkerWindowsPage = lazy(() => import('./pages/WorkerWindowsPage').then((page) => ({ default: page.WorkerWindowsPage })))
const CustomsBrokersPage = lazy(() => import('./pages/CustomsBrokersPage').then((page) => ({ default: page.CustomsBrokersPage })))
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage').then((page) => ({ default: page.OrgSettingsPage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then((page) => ({ default: page.LoginPage })))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((page) => ({ default: page.PrivacyPage })))
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((page) => ({ default: page.RegisterPage })))
const SuperAdminPage = lazy(() => import('./pages/SuperAdminPage').then((page) => ({ default: page.SuperAdminPage })))
const AdminErrorsPage = lazy(() => import('./pages/AdminErrorsPage').then((page) => ({ default: page.AdminErrorsPage })))
const WorkerProfilePage = lazy(() => import('./pages/WorkerProfilePage').then((page) => ({ default: page.WorkerProfilePage })))
const WorkerHomePage = lazy(() => import('./pages/WorkerHomePage').then((page) => ({ default: page.WorkerHomePage })))
const WorkerHistoryPage = lazy(() => import('./pages/WorkerHistoryPage').then((page) => ({ default: page.WorkerHistoryPage })))
const WorkerBriefingsPage = lazy(() => import('./pages/WorkerBriefingsPage').then((page) => ({ default: page.WorkerBriefingsPage })))
const WorkerNotificationsPage = lazy(() => import('./pages/WorkerNotificationsPage').then((page) => ({ default: page.WorkerNotificationsPage })))
const WorkerHelpPage = lazy(() => import('./pages/WorkerHelpPage').then((page) => ({ default: page.WorkerHelpPage })))
const WorkerContactsPage = lazy(() => import('./pages/WorkerContactsPage').then((page) => ({ default: page.WorkerContactsPage })))
const WorkerFaultsPage = lazy(() => import('./pages/WorkerFaultsPage').then((page) => ({ default: page.WorkerFaultsPage })))
const WorkerEquipmentPage = lazy(() => import('./pages/WorkerEquipmentPage').then((page) => ({ default: page.WorkerEquipmentPage })))
const WorkerPayPage = lazy(() => import('./pages/WorkerPayPage').then((page) => ({ default: page.WorkerPayPage })))
const ManagerPayPage = lazy(() => import('./pages/WorkerPayPage').then((page) => ({ default: page.ManagerPayPage })))
const EquipmentRequestsPage = lazy(() => import('./pages/EquipmentRequestsPage').then((page) => ({ default: page.EquipmentRequestsPage })))
const OpenShiftsPage = lazy(() => import('./pages/OpenShiftsPage').then((page) => ({ default: page.OpenShiftsPage })))
const WorkerPortalProfilePage = lazy(() => import('./pages/WorkerPortalProfilePage').then((page) => ({ default: page.WorkerPortalProfilePage })))
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage').then((page) => ({ default: page.ChangePasswordPage })))
const AlgorithmPage = lazy(() => import('./pages/AlgorithmPage').then((page) => ({ default: page.AlgorithmPage })))
const HelpPage = lazy(() => import('./pages/HelpPage').then((page) => ({ default: page.HelpPage })))
const ReportPage = lazy(() => import('./pages/ReportPage').then((page) => ({ default: page.ReportPage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((page) => ({ default: page.NotFoundPage })))
const CancellationsPage = lazy(() => import('./pages/CancellationsPage').then((page) => ({ default: page.CancellationsPage })))
const ShiftHandoffPage = lazy(() => import('./pages/ShiftHandoffPage').then((page) => ({ default: page.ShiftHandoffPage })))
const StationMapPage = lazy(() => import('./pages/StationMapPage').then((page) => ({ default: page.StationMapPage })))

function ProtectedWorkerShell() {
  const { user } = useApp()
  const params = useParams()
  const requested = params.module
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'super_admin') return <Navigate to="/admin" replace />
  if (user.role !== 'worker') return <Navigate to="/" replace />
  const homeModule: AppModule = isAppModule(user.module)
    ? user.module
    : 'selectors'
  if (!isAppModule(requested) || requested !== homeModule) {
    return <Navigate to={workerPortalHomePath(homeModule)} replace />
  }
  return (
    <WorkerPortalProvider>
      <WorkerShell module={homeModule}>
        <Routes>
          <Route index element={<WorkerHomePage />} />
          <Route path="history" element={<WorkerHistoryPage />} />
          <Route path="contacts" element={<WorkerContactsPage />} />
          <Route path="faults" element={<WorkerFaultsPage />} />
          <Route path="equipment" element={<WorkerEquipmentPage />} />
          <Route path="pay" element={<WorkerPayPage />} />
          <Route path="briefings" element={<WorkerBriefingsPage />} />
          <Route path="notifications" element={<WorkerNotificationsPage />} />
          <Route path="help" element={<WorkerHelpPage />} />
          <Route path="profile" element={<WorkerPortalProfilePage />} />
          <Route path="password" element={<ChangePasswordPage />} />
          <Route
            path="*"
            element={<Navigate to={workerPortalHomePath(homeModule)} replace />}
          />
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
  if (user.role === 'worker') {
    return <Navigate to={workerPortalHomePath(user.module)} replace />
  }
  const hasData = data.workers.length > 0 || data.lanes.length > 0
  if (loading && !hasData) {
    return (
      <Shell>
        <PageLoader skeleton label="טוען נתונים…" />
      </Shell>
    )
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
        <Route path="worker-windows" element={<WorkerWindowsPage />} />
        <Route path="customs-brokers" element={<CustomsBrokersPage />} />
        <Route path="settings" element={<OrgSettingsPage />} />
        <Route path="pay" element={<ManagerPayPage />} />
        <Route path="account/password" element={<ChangePasswordPage />} />
        <Route path="tracking" element={<TrackingPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="history/:shiftId" element={<HistoryPage />} />
        <Route path="cancellations" element={<CancellationsPage />} />
        <Route path="equipment" element={<EquipmentRequestsPage />} />
        <Route path="handoff" element={<ShiftHandoffPage />} />
        <Route path="open-shifts" element={<OpenShiftsPage />} />
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
          <Suspense fallback={<PageLoader fullScreen label="טוען מסך…" />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/admin" element={<SuperAdminPage />} />
              <Route path="/admin/errors" element={<AdminErrorsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/report" element={<ReportPage />} />
              <Route path="/algorithm" element={<AlgorithmPage />} />
              <Route
                path="/portal/:module/*"
                element={<ProtectedWorkerShell />}
              />
              <Route path="/worker/*" element={<LegacyWorkerPortalRedirect />} />
              <Route path="/*" element={<ProtectedShell />} />
            </Routes>
          </Suspense>
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
