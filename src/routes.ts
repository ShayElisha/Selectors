import type { View } from './types'

export const VIEW_PATH: Record<View, string> = {
  home: '/',
  shift: '/shift',
  workers: '/workers',
  lanes: '/lanes',
  certs: '/certs',
  tracking: '/tracking',
  analytics: '/analytics',
  audit: '/audit',
  history: '/history',
  briefings: '/briefings',
  shiftModels: '/shift-models',
  customsBrokers: '/customs-brokers',
  settings: '/settings',
}

export function isAppPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/history-matrix') return true
  if (path === '/algorithm' || path === '/account/password') return true
  if (
    path.startsWith('/shift/') ||
    path.startsWith('/history/') ||
    path.startsWith('/workers/')
  ) {
    return true
  }
  return (Object.values(VIEW_PATH) as string[]).includes(path)
}

export function viewFromPath(pathname: string): View {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return 'home'
  if (path === '/shift' || path.startsWith('/shift/')) return 'shift'
  if (path === '/workers' || path.startsWith('/workers/')) return 'workers'
  if (path === '/lanes') return 'lanes'
  if (path === '/certs') return 'certs'
  if (path === '/tracking') return 'tracking'
  if (path === '/analytics') return 'analytics'
  if (path === '/audit') return 'audit'
  if (path === '/briefings') return 'briefings'
  if (path === '/shift-models') return 'shiftModels'
  if (path === '/customs-brokers') return 'customsBrokers'
  if (path === '/settings') return 'settings'
  if (path === '/history-matrix') return 'history'
  if (path === '/history' || path.startsWith('/history/')) return 'history'
  return 'home'
}

export function pathForView(view: View): string {
  return VIEW_PATH[view] ?? '/'
}
