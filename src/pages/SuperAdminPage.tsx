import { useCallback, useEffect, useState } from 'react'
import {
  fetchOrganizationsRemote,
  reviewOrganizationRemote,
  type OrganizationSummary,
} from '../api'
import { AppFooter } from '../components/AppFooter'
import { BrandMark } from '../components/BrandMark'
import { ThemeToggle } from '../components/ThemeToggle'
import { useApp } from '../context/AppContext'
import { notify } from '../lib/notify'
import { Ltr } from '../components/ui'

const STATUS_LABEL = {
  pending: 'ממתין',
  approved: 'מאושר',
  rejected: 'נדחה',
} as const

export function SuperAdminPage() {
  const { user, logout } = useApp()
  const [rows, setRows] = useState<OrganizationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await fetchOrganizationsRemote())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת הארגונים נכשלה')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.role !== 'super_admin') return
    void load()
  }, [load, user?.role])

  const patch = async (
    org: OrganizationSummary,
    body: Parameters<typeof reviewOrganizationRemote>[1],
  ) => {
    setBusyId(org.id)
    try {
      const saved = await reviewOrganizationRemote(org.id, body)
      setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)))
      notify.success('הארגון עודכן')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'העדכון נכשל')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="size-12" />
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
              סופר אדמין
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {user?.fullName} · אישור ארגונים ופתיחת סלקטורים או בודקים
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button type="button" className="ui-btn ui-btn-secondary" onClick={logout}>
            יציאה
          </button>
        </div>
      </header>

      {error && (
        <p className="mb-4 rounded-xl border border-hard/30 bg-hard/10 px-3 py-2 text-sm text-hard">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-soft">טוען ארגונים…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-line/70 bg-card px-4 py-8 text-center text-sm text-ink-soft">
          עדיין אין ארגונים רשומים.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line/70 bg-card">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-right text-sm">
              <thead>
                <tr className="border-b border-line/70 bg-surface/80 text-[12px] text-ink-soft">
                  <th className="px-3 py-3 font-semibold">ארגון</th>
                  <th className="px-3 py-3 font-semibold">מנהל</th>
                  <th className="px-3 py-3 font-semibold">סטטוס</th>
                  <th className="px-3 py-3 font-semibold">מודולים</th>
                  <th className="px-3 py-3 font-semibold">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map((org) => {
                  const busy = busyId === org.id
                  return (
                    <tr key={org.id} className="align-top">
                      <td className="px-3 py-3 font-semibold text-ink">{org.name}</td>
                      <td className="px-3 py-3 text-ink-soft">
                        <div>{org.manager?.fullName || '—'}</div>
                        <div>
                          <Ltr>{org.manager?.phone || ''}</Ltr>
                        </div>
                        <div>
                          <Ltr>{org.manager?.email || ''}</Ltr>
                        </div>
                      </td>
                      <td className="px-3 py-3">{STATUS_LABEL[org.status]}</td>
                      <td className="px-3 py-3">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={org.modules.selectors}
                            disabled={busy || org.status !== 'approved'}
                            onChange={(e) =>
                              void patch(org, {
                                modules: {
                                  selectors: e.target.checked,
                                  inspectors: org.modules.inspectors,
                                },
                              })
                            }
                          />
                          סלקטורים
                        </label>
                        <label className="mt-2 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={org.modules.inspectors}
                            disabled={busy || org.status !== 'approved'}
                            onChange={(e) =>
                              void patch(org, {
                                modules: {
                                  selectors: org.modules.selectors,
                                  inspectors: e.target.checked,
                                },
                              })
                            }
                          />
                          בודקים
                        </label>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          {org.status !== 'approved' && (
                            <button
                              type="button"
                              className="ui-btn ui-btn-primary"
                              disabled={busy}
                              onClick={() => void patch(org, { status: 'approved' })}
                            >
                              אישור
                            </button>
                          )}
                          {org.status !== 'rejected' && (
                            <button
                              type="button"
                              className="ui-btn ui-btn-secondary"
                              disabled={busy}
                              onClick={() => void patch(org, { status: 'rejected' })}
                            >
                              דחייה
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AppFooter className="mt-10" />
    </div>
  )
}
