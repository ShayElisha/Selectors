import {
  MODULE_PORTAL_LABELS,
  isAppModule,
  workerPortalHomePath,
  workerPortalPath,
  type AppModule,
} from '../auth'
import { useApp } from '../context/AppContext'

/** Current department portal helpers for worker-facing screens. */
export function useWorkerPortalPaths() {
  const { user } = useApp()
  const module: AppModule = isAppModule(user?.module) ? user.module : 'selectors'
  return {
    module,
    portalTitle: MODULE_PORTAL_LABELS[module],
    home: workerPortalHomePath(module),
    path: (sub = '') => workerPortalPath(module, sub),
  }
}
