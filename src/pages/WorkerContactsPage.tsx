import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  MessageCircle,
  Phone,
  PhoneCall,
  RefreshCw,
  Shield,
  UserRound,
  Users,
} from 'lucide-react'
import {
  fetchWorkerContactsRemote,
  type WorkerContactItem,
} from '../api'
import { PageLoader } from '../components/PageLoader'
import { Ltr, SectionCard } from '../components/ui'
import { phoneDigitsForWhatsApp } from '../lib/workerNotify'
import { useWorkerPortalPaths } from '../lib/workerPortalPaths'

function kindIcon(kind: WorkerContactItem['kind']) {
  if (kind === 'gate_manager') return Shield
  if (kind === 'org_manager' || kind === 'shift_manager') return UserRound
  if (kind === 'coworker') return Users
  return PhoneCall
}

function ContactCard({ contact }: { contact: WorkerContactItem }) {
  const Icon = kindIcon(contact.kind)
  const telHref = `tel:${contact.phoneDigits}`
  const wa = phoneDigitsForWhatsApp(contact.phoneDigits)
  return (
    <li className="rounded-xl border border-line/70 bg-surface/40 p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{contact.name}</p>
          {contact.role ? (
            <p className="mt-0.5 text-[13px] text-ink-soft">{contact.role}</p>
          ) : null}
          <p className="mt-1 text-sm font-medium text-ink" dir="ltr">
            <Ltr>{contact.phone}</Ltr>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={telHref} className="ui-btn ui-btn-primary !py-2 text-xs">
              <Phone className="size-3.5" aria-hidden />
              חיוג
            </a>
            {wa ? (
              <a
                href={`https://wa.me/${wa}`}
                target="_blank"
                rel="noreferrer"
                className="ui-btn ui-btn-secondary !py-2 text-xs"
              >
                <MessageCircle className="size-3.5" aria-hidden />
                WhatsApp
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  )
}

export function WorkerContactsPage() {
  const { path } = useWorkerPortalPaths()
  const [contacts, setContacts] = useState<WorkerContactItem[]>([])
  const [orgName, setOrgName] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await fetchWorkerContactsRemote()
      setContacts(data.contacts)
      setOrgName(data.orgName || '')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת אנשי הקשר נכשלה')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && contacts.length === 0) {
    return <PageLoader centered size="sm" label="טוען אנשי קשר…" />
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="אנשי קשר"
        subtitle={
          orgName
            ? `כל עובדי המחלקה בארגון ${orgName} — עם חיוג ו־WhatsApp.`
            : 'כל עובדי המחלקה — מנהלים, עמיתים ואנשי קשר שהוגדרו.'
        }
        actions={
          <button
            type="button"
            className="ui-btn ui-btn-ghost !px-2.5"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            aria-label="רענון"
          >
            <RefreshCw
              className={`size-4 ${loading || refreshing ? 'animate-spin' : ''}`}
            />
          </button>
        }
      >
        {error ? (
          <div className="space-y-3">
            <p className="text-sm text-hard">{error}</p>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={() => void load()}
            >
              נסו שוב
            </button>
          </div>
        ) : contacts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line/80 bg-surface/30 px-4 py-8 text-center">
            <Users className="mx-auto size-8 text-ink-soft/50" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-ink">אין אנשי קשר להצגה</p>
            <p className="mt-1 text-[13px] text-ink-soft">
              כשיופיעו עובדים עם מספר טלפון במחלקה, או שאיש קשר יתווסף בהגדרות
              הארגון — הם יופיעו כאן עם כפתור חיוג.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {contacts.map((contact) => (
              <ContactCard key={contact.id} contact={contact} />
            ))}
          </ul>
        )}
      </SectionCard>

      <p className="text-center text-[12px] text-ink-soft">
        לבעיות גישה או עדכון מספרים — פנו למנהל הארגון דרך{' '}
        <Link to={path('help')} className="font-semibold text-brand">
          העזרה
        </Link>
        .
      </p>
    </div>
  )
}
