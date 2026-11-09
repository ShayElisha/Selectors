import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Camera, KeyRound } from 'lucide-react'
import { PageLoader } from '../components/PageLoader'
import { CertChips, SectionCard } from '../components/ui'
import { UserAvatar } from '../components/UserAvatar'
import { useApp } from '../context/AppContext'
import { useWorkerPortal } from '../context/WorkerPortalContext'
import { readAvatarFile } from '../lib/avatarImage'
import { notify } from '../lib/notify'
import {
  currentNotifyPermission,
  requestWorkerNotifyPermission,
  type NotifyPermission,
} from '../lib/workerNotify'
import { useWorkerPortalPaths } from '../lib/workerPortalPaths'

export function WorkerPortalProfilePage() {
  const { user, updateOwnAvatar } = useApp()
  const { home, loading, error, refreshHome } = useWorkerPortal()
  const { portalTitle, path } = useWorkerPortalPaths()
  const [perm, setPerm] = useState<NotifyPermission>(() =>
    currentNotifyPermission(),
  )
  const [permBusy, setPermBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  if (loading && !home) {
    return <PageLoader centered size="sm" label="טוען נתונים…" />
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
      <SectionCard
        title="הפרופיל שלי"
        subtitle={`פרטים אישיים והסמכות ב${portalTitle} (לקריאה).`}
      >
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <UserAvatar
            name={me?.fullName || user?.fullName || ''}
            avatarUrl={user?.avatarUrl}
            size="lg"
          />
          <div className="space-y-2">
            <p className="text-sm font-semibold text-ink">תמונת פרופיל</p>
            <p className="text-[13px] text-ink-soft">
              אם אין תמונה מוצגות ראשי התיבות של השם.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label="בחירת תמונת פרופיל"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  setAvatarBusy(true)
                  void readAvatarFile(file)
                    .then((dataUrl) => updateOwnAvatar(dataUrl))
                    .then(() => notify.success('תמונת הפרופיל עודכנה'))
                    .catch((err) =>
                      notify.error(
                        err instanceof Error
                          ? err.message
                          : 'עדכון התמונה נכשל',
                      ),
                    )
                    .finally(() => setAvatarBusy(false))
                }}
              />
              <button
                type="button"
                className="ui-btn ui-btn-secondary !py-1.5 text-xs disabled:opacity-50"
                disabled={avatarBusy}
                onClick={() => avatarInputRef.current?.click()}
              >
                <Camera className="size-3.5" aria-hidden />
                {avatarBusy
                  ? 'מעדכן…'
                  : user?.avatarUrl
                    ? 'החלפת תמונה'
                    : 'הוספת תמונה'}
              </button>
              {user?.avatarUrl ? (
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost !py-1.5 text-xs disabled:opacity-50"
                  disabled={avatarBusy}
                  onClick={() => {
                    setAvatarBusy(true)
                    void updateOwnAvatar(null)
                      .then(() => notify.success('תמונת הפרופיל הוסרה'))
                      .catch((err) =>
                        notify.error(
                          err instanceof Error
                            ? err.message
                            : 'הסרת התמונה נכשלה',
                        ),
                      )
                      .finally(() => setAvatarBusy(false))
                  }}
                >
                  הסרה
                </button>
              ) : null}
            </div>
          </div>
        </div>
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
            <dt className="text-ink-soft">פורטל</dt>
            <dd className="font-semibold text-ink">{portalTitle}</dd>
          </div>
          <div>
            <dt className="mb-1 text-ink-soft">הסמכות</dt>
            <dd>
              <CertChips items={me?.certifications || []} />
            </dd>
          </div>
        </dl>

        <Link to={path('password')} className="ui-btn ui-btn-primary mt-5 inline-flex">
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
          to={path('help')}
          className="mt-4 inline-block text-sm font-semibold text-brand underline decoration-brand/30 underline-offset-4"
        >
          מדריך קצר: איך משתמשים
        </Link>
      </SectionCard>
    </div>
  )
}
