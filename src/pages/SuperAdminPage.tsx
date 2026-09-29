import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteOrganizationRemote,
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

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'no_module'
type ModuleFilter = 'all' | 'selectors' | 'inspectors' | 'none'

function noModule(org: OrganizationSummary) {
  return org.status === 'approved' && !org.modules.selectors && !org.modules.inspectors
}

function OrgTable({
  orgs,
  busyId,
  onOpen,
  onPatch,
  onApprove,
  onRemove,
}: {
  orgs: OrganizationSummary[]
  busyId: string | null
  onOpen: (org: OrganizationSummary) => void
  onPatch: (org: OrganizationSummary, body: Parameters<typeof reviewOrganizationRemote>[1]) => void
  onApprove: (org: OrganizationSummary) => void
  onRemove: (org: OrganizationSummary) => void
}) {
  if (orgs.length === 0) {
    return <p className="px-4 py-6 text-sm text-ink-soft">אין ארגונים ברשימה הזו.</p>
  }
  return (
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
          {orgs.map((org) => {
            const busy = busyId === org.id
            const blocked = noModule(org)
            return (
              <tr key={org.id} className={`align-top ${blocked ? 'bg-warn-soft/70' : ''}`}>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    className="font-semibold text-ink underline-offset-2 hover:underline"
                    onClick={() => onOpen(org)}
                  >
                    {org.name}
                  </button>
                  {blocked ? (
                    <p className="mt-1 max-w-[16rem] text-[12px] font-semibold leading-relaxed text-warn">
                      מאושר, אבל בלי מודול — המנהל לא יכול להיכנס.
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-ink-soft">
                  <div>{org.manager?.fullName || '—'}</div>
                  <div><Ltr>{org.manager?.phone || ''}</Ltr></div>
                  <div><Ltr>{org.manager?.email || ''}</Ltr></div>
                </td>
                <td className="px-3 py-3">{STATUS_LABEL[org.status]}</td>
                <td className="px-3 py-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={org.modules.selectors}
                      disabled={busy || org.status !== 'approved'}
                      onChange={(e) =>
                        void onPatch(org, {
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
                        void onPatch(org, {
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
                        onClick={() => onApprove(org)}
                      >
                        אישור
                      </button>
                    )}
                    {org.status !== 'rejected' && (
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary"
                        disabled={busy}
                        onClick={() => void onPatch(org, { status: 'rejected' })}
                      >
                        דחייה
                      </button>
                    )}
                    <button
                      type="button"
                      className="ui-btn ui-btn-danger"
                      disabled={busy}
                      onClick={() => void onRemove(org)}
                    >
                      מחיקה
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function SuperAdminPage() {
  const { user, logout } = useApp()
  const [rows, setRows] = useState<OrganizationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all')
  const [selected, setSelected] = useState<OrganizationSummary | null>(null)
  const [approve, setApprove] = useState<OrganizationSummary | null>(null)
  const [approveModules, setApproveModules] = useState({
    selectors: true,
    inspectors: false,
  })

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

  const counts = useMemo(
    () => ({
      pending: rows.filter((org) => org.status === 'pending').length,
      approved: rows.filter((org) => org.status === 'approved').length,
      rejected: rows.filter((org) => org.status === 'rejected').length,
      noModule: rows.filter(noModule).length,
    }),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = query.trim()
    return rows.filter((org) => {
      if (q && !`${org.name} ${org.manager?.fullName || ''}`.includes(q)) return false
      if (statusFilter === 'pending' && org.status !== 'pending') return false
      if (statusFilter === 'approved' && org.status !== 'approved') return false
      if (statusFilter === 'rejected' && org.status !== 'rejected') return false
      if (statusFilter === 'no_module' && !noModule(org)) return false
      if (moduleFilter === 'selectors' && !org.modules.selectors) return false
      if (moduleFilter === 'inspectors' && !org.modules.inspectors) return false
      if (moduleFilter === 'none' && (org.modules.selectors || org.modules.inspectors)) return false
      return true
    })
  }, [rows, query, statusFilter, moduleFilter])

  const pending = filtered.filter((org) => org.status === 'pending')
  const rest = filtered.filter((org) => org.status !== 'pending')

  const remove = async (org: OrganizationSummary) => {
    const ok = window.confirm(
      `למחוק את הארגון ${org.name}? החשבונות וכל נתוני השיבוץ של הארגון יימחקו, והמנהלים ינותקו.`,
    )
    if (!ok) return
    setBusyId(org.id)
    try {
      await deleteOrganizationRemote(org.id)
      setRows((current) => current.filter((row) => row.id !== org.id))
      if (selected?.id === org.id) setSelected(null)
      notify.success('הארגון נמחק')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'מחיקת הארגון נכשלה')
    } finally {
      setBusyId(null)
    }
  }

  const patch = async (
    org: OrganizationSummary,
    body: Parameters<typeof reviewOrganizationRemote>[1],
  ) => {
    setBusyId(org.id)
    try {
      const saved = await reviewOrganizationRemote(org.id, body)
      setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)))
      setSelected((current) => (current?.id === saved.id ? saved : current))
      notify.success('הארגון עודכן')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'העדכון נכשל')
    } finally {
      setBusyId(null)
    }
  }

  const confirmApprove = async () => {
    if (!approve) return
    if (!approveModules.selectors && !approveModules.inspectors) {
      notify.error('בחרו לפחות מודול אחד')
      return
    }
    await patch(approve, { status: 'approved', modules: approveModules })
    setApprove(null)
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="size-12" />
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-ink">סופר אדמין</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {user?.fullName} · אישור ארגונים ופתיחת סלקטורים או בודקים
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button type="button" className="ui-btn ui-btn-secondary" onClick={logout}>יציאה</button>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['ממתינים', counts.pending],
          ['מאושרים', counts.approved],
          ['נדחים', counts.rejected],
          ['בלי מודול', counts.noModule],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-line/70 bg-card px-3 py-3">
            <p className="text-[12px] text-ink-soft">{label}</p>
            <p className="font-display text-2xl font-bold text-ink">{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="ui-field min-w-[12rem] flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם ארגון או מנהל"
          aria-label="חיפוש ארגונים"
        />
        <select
          className="ui-field w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="סינון לפי סטטוס"
        >
          <option value="all">כל הסטטוסים</option>
          <option value="pending">ממתין</option>
          <option value="approved">מאושר</option>
          <option value="rejected">נדחה</option>
          <option value="no_module">בלי מודול</option>
        </select>
        <select
          className="ui-field w-auto"
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value as ModuleFilter)}
          aria-label="סינון לפי מודול"
        >
          <option value="all">כל המודולים</option>
          <option value="selectors">סלקטורים</option>
          <option value="inspectors">בודקים</option>
          <option value="none">בלי מודול</option>
        </select>
      </div>

      {selected ? (
        <section className="mb-4 rounded-xl border border-line/70 bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-ink">{selected.name}</h2>
            <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setSelected(null)}>סגירה</button>
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-ink-soft">מנהל</dt><dd className="font-semibold">{selected.manager?.fullName || '—'}</dd></div>
            <div><dt className="text-ink-soft">טלפון</dt><dd><Ltr>{selected.manager?.phone || '—'}</Ltr></dd></div>
            <div><dt className="text-ink-soft">מייל</dt><dd><Ltr>{selected.manager?.email || '—'}</Ltr></dd></div>
            <div>
              <dt className="text-ink-soft">תאריך הרשמה</dt>
              <dd>{selected.createdAt ? new Date(selected.createdAt).toLocaleString('he-IL') : '—'}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {error && (
        <p className="mb-4 rounded-xl border border-hard/30 bg-hard/10 px-3 py-2 text-sm text-hard">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-ink-soft">טוען ארגונים…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-line/70 bg-card px-4 py-8 text-center text-sm text-ink-soft">
          עדיין אין ארגונים רשומים.
        </p>
      ) : (
        <div className="space-y-4">
          <section className="overflow-hidden rounded-xl border border-warn/30 bg-card">
            <h2 className="border-b border-warn/20 bg-warn-soft px-4 py-3 font-display text-lg font-bold text-ink">
              ממתינים לאישור ({pending.length})
            </h2>
            <OrgTable
              orgs={pending}
              busyId={busyId}
              onOpen={setSelected}
              onPatch={patch}
              onApprove={(org) => {
                setApproveModules({ selectors: true, inspectors: false })
                setApprove(org)
              }}
              onRemove={remove}
            />
          </section>
          <section className="overflow-hidden rounded-xl border border-line/70 bg-card">
            <h2 className="border-b border-line/70 bg-surface/80 px-4 py-3 font-display text-lg font-bold text-ink">
              מאושרים ונדחים ({rest.length})
            </h2>
            <OrgTable
              orgs={rest}
              busyId={busyId}
              onOpen={setSelected}
              onPatch={patch}
              onApprove={(org) => {
                setApproveModules({ selectors: true, inspectors: false })
                setApprove(org)
              }}
              onRemove={remove}
            />
          </section>
        </div>
      )}

      {approve ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-4 shadow-xl">
            <h3 className="font-display text-lg font-bold text-ink">אישור {approve.name}</h3>
            <p className="mt-1 text-sm text-ink-soft">בחרו לפחות מודול אחד, כדי שהמנהל יוכל להיכנס.</p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={approveModules.selectors}
                onChange={(e) => setApproveModules((m) => ({ ...m, selectors: e.target.checked }))}
              />
              סלקטורים
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={approveModules.inspectors}
                onChange={(e) => setApproveModules((m) => ({ ...m, inspectors: e.target.checked }))}
              />
              בודקים
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setApprove(null)}>ביטול</button>
              <button type="button" className="ui-btn ui-btn-primary" onClick={() => void confirmApprove()}>אישור הארגון</button>
            </div>
          </div>
        </div>
      ) : null}

      <AppFooter className="mt-10" />
    </div>
  )
}
