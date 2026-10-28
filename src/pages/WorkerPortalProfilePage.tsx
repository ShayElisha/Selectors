import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, KeyRound } from 'lucide-react'
import { PageLoader } from '../components/PageLoader'
import { CertChips, SectionCard } from '../components/ui'
import { useApp } from '../context/AppContext'
import { useWorkerPortal } from '../context/WorkerPortalContext'
import { notify } from '../lib/notify'
import {
  currentNotifyPermission,
  requestWorkerNotifyPermission,
  type NotifyPermission,
} from '../lib/workerNotify'

export function WorkerPortalProfilePage() {
  const { user } = useApp()
  const { home, loading, error, refreshHome } = useWorkerPortal()
  const [perm, setPerm] = useState<NotifyPermission>(() =>
    currentNotifyPermission(),
  )
  const [permBusy, setPermBusy] = useState(false)

  if (loading && !home) {
    return <PageLoader label="טוען נתונים…" />
  }

  if (!home) {
    return (
      <SectionCard title="הפרופיל שלי" subtitle={error || 'לא ניתן לטעון נתונים כרגע.'}>
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          onClick={() => void refreshHome()}
        >
          נסו שוב
        </button>
      </SectionCard>
    )
  }

  const me = home.me

  return (
    <div className="space-y-4">
      <SectionCard title="הפרופיל שלי" subtitle="פרטים אישיים והסמכות (לקריאה).">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-ink-soft">שם</dt>
            <dd className="font-semibold text-ink">{me?.fullName || user?.fullName}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">טלפון</dt>
            <dd className="font-semibold text-ink" dir="ltr">
              {me?.phone || user?.phone}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">מייל</dt>
            <dd className="font-semibold text-ink">{me?.email || '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">ארגון</dt>
            <dd className="font-semibold text-ink">{user?.orgName || '—'}</dd>
          </div>
          <div>
            <dt className="mb-1 text-ink-soft">הסמכות</dt>
            <dd>
              <CertChips items={me?.certifications || []} />
            </dd>
          </div>
        </dl>

        <Link to="/worker/password" className="ui-btn ui-btn-primary mt-5 inline-flex">
          <KeyRound className="size-4" aria-hidden />
          החלפת סיסמה
        </Link>
      </SectionCard>

      <SectionCard
        title="התראות דפדפן"
        subtitle="תזכורת כשעה לפני משמרת והתראה על שינוי שיבוץ כשהאפליקציה פתוחה."
      >
        <p className="text-sm text-ink-soft">
          סטטוס:{' '}
          <span className="font-semibold text-ink">
            {perm === 'granted'
              ? 'מאושר'
              : perm === 'denied'
                ? 'חסום בהגדרות הדפדפן'
                : perm === 'unsupported'
                  ? 'הדפדפן לא תומך'
                  : 'טרם אושר'}
          </span>
        </p>
        {perm !== 'granted' && perm !== 'unsupported' ? (
          <button
            type="button"
            className="ui-btn ui-btn-secondary mt-3"
            disabled={permBusy || perm === 'denied'}
            onClick={() => {
              setPermBusy(true)
              void requestWorkerNotifyPermission()
                .then((next) => {
                  setPerm(next)
                  if (next === 'granted') {
                    notify.success('התראות דפדפן אושרו')
                  } else if (next === 'denied') {
                    notify.error('ההרשאה נחסמה — אפשר לשנות בהגדרות הדפדפן')
                  }
                })
                .finally(() => setPermBusy(false))
            }}
          >
            <Bell className="size-4" aria-hidden />
            {permBusy ? 'מבקש…' : 'אפשרו התראות'}
          </button>
        ) : null}
        <Link
          to="/worker/help"
          className="mt-4 inline-block text-sm font-semibold text-brand underline decoration-brand/30 underline-offset-4"
        >
          מדריך קצר: איך משתמשים
        </Link>
      </SectionCard>
    </div>
  )
}
