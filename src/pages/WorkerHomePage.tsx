import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  Clock,
  MessageCircle,
  Phone,
  RefreshCw,
  Shield,
  Timer,
  UserRound,
  X,
} from 'lucide-react'
import { PageLoader } from '../components/PageLoader'
import { IntensityBadge, Ltr, SectionCard } from '../components/ui'
import { useWorkerPortal } from '../context/WorkerPortalContext'
import { SHIFT_TYPE_LABELS } from '../constants'
import { formatMinutes } from '../lib/shiftModels'
import { notify } from '../lib/notify'
import {
  phoneDigitsForWhatsApp,
  scheduleShiftStartReminder,
} from '../lib/workerNotify'
import { useWorkerPortalPaths } from '../lib/workerPortalPaths'
import type { Intensity, ShiftType } from '../types'

function shiftLabel(type: string) {
  return SHIFT_TYPE_LABELS[type as ShiftType] || type
}

function formatCountdown(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function GateManagerCard({
  manager,
}: {
  manager: { fullName: string; phone: string }
}) {
  const phone = String(manager.phone || '').trim()
  const wa = phoneDigitsForWhatsApp(phone)
  return (
    <div className="rounded-xl border border-line/70 bg-surface/50 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Shield className="size-4 text-brand" aria-hidden />
        מנהל המשמרת היום
      </p>
      <p className="mt-1 text-base font-bold text-ink">{manager.fullName}</p>
      {phone ? (
        <p className="mt-0.5 text-sm text-ink-soft" dir="ltr">
          {phone}
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-soft">אין מספר טלפון במערכת</p>
      )}
      {phone ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`tel:${phone.replace(/\s/g, '')}`}
            className="ui-btn ui-btn-primary !py-2 text-xs"
          >
            <Phone className="size-3.5" aria-hidden />
            התקשרות
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
      ) : null}
    </div>
  )
}

function useEndsAtCountdown(endsAt: string | null | undefined) {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!endsAt) {
      setLeft(null)
      return
    }
    const tick = () => {
      setLeft(
        Math.max(
          0,
          Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000),
        ),
      )
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [endsAt])
  return left
}

const IL_TZ = 'Asia/Jerusalem'

function formatPortalClock(now: Date) {
  const weekday = now.toLocaleDateString('he-IL', {
    timeZone: IL_TZ,
    weekday: 'long',
  })
  const date = now.toLocaleDateString('he-IL', {
    timeZone: IL_TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const time = now.toLocaleTimeString('he-IL', {
    timeZone: IL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return { weekday, date, time }
}

function PortalClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const { weekday, date, time } = formatPortalClock(now)
  return (
    <div
      className="rounded-xl border border-line/70 bg-surface/50 px-4 py-3"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
            <CalendarDays className="size-3.5" aria-hidden />
            {weekday}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{date}</p>
        </div>
        <p
          className="inline-flex items-center gap-1.5 font-display text-2xl font-bold tabular-nums text-ink"
          dir="ltr"
        >
          <Clock className="size-4 text-brand" aria-hidden />
          <Ltr>{time}</Ltr>
        </p>
      </div>
    </div>
  )
}

const HELP_TIP_KEY = 'getin.worker.helpTipDismissed'

export function WorkerHomePage() {
  const {
    home,
    loading,
    refreshing,
    error,
    refreshHome,
    markArrived: markArrivedRemote,
  } = useWorkerPortal()
  const { portalTitle, path } = useWorkerPortalPaths()
  const [busy, setBusy] = useState(false)
  const [showHelpTip, setShowHelpTip] = useState(() => {
    try {
      return localStorage.getItem(HELP_TIP_KEY) !== '1'
    } catch {
      return true
    }
  })

  useEffect(() => {
    if (!home?.shift) return
    const id = window.setInterval(() => void refreshHome({ silent: true }), 60_000)
    return () => window.clearInterval(id)
  }, [home?.shift?.id, refreshHome])

  const phase = home?.now?.phase || 'none'
  const upcoming = phase === 'upcoming'
  const active = phase === 'active'

  const startLeft = useEndsAtCountdown(home?.now?.shiftStartsAt)
  const shiftLeft = useEndsAtCountdown(home?.now?.shiftEndsAt)

  useEffect(() => {
    if (!upcoming || startLeft == null) return
    if (startLeft <= 0) void refreshHome({ silent: true })
  }, [upcoming, startLeft, refreshHome])

  useEffect(() => {
    if (!home?.shift || home.now?.phase !== 'upcoming') return
    scheduleShiftStartReminder({
      shiftId: home.shift.id,
      shiftStartsAt: home.now?.shiftStartsAt,
      label: `${home.slot.date} · ${shiftLabel(home.slot.shiftType)} · ${home.slot.windowLabel}`,
    })
  }, [
    home?.shift?.id,
    home?.now?.phase,
    home?.now?.shiftStartsAt,
    home?.slot.date,
    home?.slot.shiftType,
    home?.slot.windowLabel,
  ])

  const markArrived = async () => {
    setBusy(true)
    try {
      await markArrivedRemote()
      notify.success('סומנה הגעה')
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'עדכון ההגעה נכשל')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !home) {
    return <PageLoader centered size="sm" label="טוען נתונים…" />
  }

  if (!home) {
    return (
      <div className="space-y-4">
        <PortalClock />
        <SectionCard
          title="המשמרת שלי"
          subtitle={error || 'לא ניתן לטעון נתונים כרגע.'}
        >
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={() => void refreshHome()}
          >
            נסו שוב
          </button>
        </SectionCard>
      </div>
    )
  }

  const locked = Boolean(home.shift?.signOff)
  const arrived = Boolean(home.status.present)
  const now = home.now
  const activeLanes = now?.activeLanes?.length
    ? now.activeLanes
    : home.placement.lanes

  return (
    <div className="space-y-4">
      <PortalClock />

      {showHelpTip ? (
        <div className="flex items-start gap-3 rounded-xl border border-brand/25 bg-brand/[0.06] p-3">
          <CircleHelp className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0 flex-1 text-sm text-ink-soft">
            חדשים כאן?{' '}
            <Link
              to={path('help')}
              className="font-semibold text-brand underline decoration-brand/30 underline-offset-4"
            >
              מדריך קצר — איך משתמשים
            </Link>
          </div>
          <button
            type="button"
            className="ui-btn ui-btn-ghost !px-2 !py-1"
            aria-label="סגירת טיפ"
            onClick={() => {
              setShowHelpTip(false)
              try {
                localStorage.setItem(HELP_TIP_KEY, '1')
              } catch {
                /* ignore */
              }
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <SectionCard
        title="עכשיו"
        subtitle={`${portalTitle} · ${home.slot.date} · ${shiftLabel(home.slot.shiftType)} · ${home.slot.windowLabel}`}
        actions={
          <button
            type="button"
            className="ui-btn ui-btn-ghost !px-2.5"
            onClick={() => void refreshHome({ silent: true })}
            disabled={loading || refreshing || busy}
            aria-label="רענון"
          >
            <RefreshCw
              className={`size-4 ${loading || refreshing ? 'animate-spin' : ''}`}
            />
          </button>
        }
      >
        {!home.shift ? (
          <p className="text-sm leading-relaxed text-ink-soft">
            אין משמרת עתידית או פעילה שאתם משובצים או מסומנים בה.
          </p>
        ) : (
          <div className="space-y-4">
            {(upcoming || active) && now ? (
              <div className="rounded-xl border border-brand/20 bg-brand/[0.06] p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-brand">
                  <Timer className="size-3.5" aria-hidden />
                  {upcoming ? 'עד תחילת המשמרת' : 'עד סיום המשמרת'}
                </p>
                <p
                  className="mt-1 font-display text-4xl font-bold tabular-nums text-ink"
                  dir="ltr"
                >
                  {upcoming
                    ? formatCountdown(
                        startLeft ?? (now.minutesToShiftStart || 0) * 60,
                      )
                    : formatCountdown(
                        shiftLeft ?? (now.minutesToShiftEnd || 0) * 60,
                      )}
                </p>
                <p className="mt-2 text-sm text-ink-soft">
                  {upcoming ? (
                    <>
                      מתחילה ב־
                      <Ltr>{formatMinutes(now.shiftStartMinutes)}</Ltr>
                    </>
                  ) : (
                    <>
                      מסתיימת ב־
                      <Ltr>{formatMinutes(now.shiftEndMinutes)}</Ltr>
                      {now.currentRound ? (
                        <> · סבב נוכחי: {now.currentRound.label}</>
                      ) : null}
                    </>
                  )}
                </p>
                {upcoming ? (
                  <p className="mt-2 text-xs text-ink-soft">
                    השיבוץ לנתיב יוצג רק אחרי תחילת המשמרת.
                  </p>
                ) : null}
              </div>
            ) : null}

            {(upcoming || active) && home.gateManager ? (
              <GateManagerCard manager={home.gateManager} />
            ) : null}
            <Link
              to={path('contacts')}
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand underline-offset-2 hover:underline"
            >
              <Phone className="size-4" aria-hidden />
              כל אנשי הקשר לחיוג
            </Link>

            {active ? (
              <>
                <div>
                  <p className="mb-2 text-sm font-semibold text-ink">
                    {now?.currentRound ? 'הנתיב הפעיל עכשיו' : 'הנתיב שלי'}
                  </p>
                  {activeLanes.length === 0 ? (
                    <p className="text-sm text-ink-soft">
                      עדיין אין שיבוץ לנתיב בסבב הנוכחי.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {activeLanes.map((a) => (
                        <div
                          key={a.laneId}
                          className="rounded-xl border border-line/70 bg-card p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-display text-lg font-bold text-ink">
                              {a.laneName}
                            </span>
                            <IntensityBadge
                              intensity={(a.intensity as Intensity) || 'medium'}
                            />
                          </div>
                          {a.notes ? (
                            <p className="mt-2 text-sm text-ink-soft">{a.notes}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {home.placement.rounds ? (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-ink">כל הסבבים שלי</p>
                    {home.placement.rounds.map((round) => {
                      const isCurrent = now?.currentRound?.label === round.label
                      return (
                        <div
                          key={round.label}
                          className={`rounded-xl border p-3 ${
                            isCurrent
                              ? 'border-brand/40 bg-brand/[0.05]'
                              : 'border-line/70 bg-surface/40'
                          }`}
                        >
                          <p className="text-sm font-bold text-ink">
                            {round.label}
                            {isCurrent ? (
                              <span className="ms-2 text-xs font-semibold text-brand">
                                עכשיו
                              </span>
                            ) : null}
                          </p>
                          {round.assignments.length === 0 ? (
                            <p className="mt-1 text-xs text-ink-soft">אין שיבוץ</p>
                          ) : (
                            <ul className="mt-1.5 space-y-1 text-sm">
                              {round.assignments.map((a) => (
                                <li
                                  key={`${round.label}-${a.laneId}`}
                                  className="flex flex-wrap items-center gap-2"
                                >
                                  <span className="font-semibold text-ink">
                                    {a.laneName}
                                  </span>
                                  <IntensityBadge
                                    intensity={
                                      (a.intensity as Intensity) || 'medium'
                                    }
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                <div className="space-y-3 rounded-xl border border-line/70 p-3">
                  <p className="text-sm font-semibold text-ink">סטטוס אישי</p>
                  <div className="flex flex-wrap gap-2 text-xs text-ink-soft">
                    {arrived ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-1 text-ok">
                        <CheckCircle2 className="size-3.5" /> הגעתי · נוכח/ת
                      </span>
                    ) : (
                      <span className="rounded-full bg-warn-soft px-2 py-1 text-warn">
                        טרם סומנה הגעה
                      </span>
                    )}
                    {home.status.lateMinutes != null ? (
                      <span>איחור: {home.status.lateMinutes} דק׳</span>
                    ) : null}
                    {home.status.earlyLeaveAt != null ? (
                      <span>
                        יציאה ב־
                        <Ltr>{formatMinutes(home.status.earlyLeaveAt)}</Ltr>
                      </span>
                    ) : null}
                    {home.status.drop ? (
                      <span>{home.status.drop.reason}</span>
                    ) : null}
                  </div>

                  {locked ? (
                    <p className="rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">
                      המשמרת נסגרה בחתימה.
                    </p>
                  ) : !arrived ? (
                    <button
                      type="button"
                      className="ui-btn ui-btn-primary"
                      disabled={busy}
                      onClick={() => void markArrived()}
                    >
                      <UserRound className="size-4" aria-hidden />
                      {busy ? 'מעדכן…' : 'הגעתי'}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
