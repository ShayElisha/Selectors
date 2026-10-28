import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Shield,
  Timer,
  UserRound,
} from 'lucide-react'
import {
  fetchWorkerHomeRemote,
  updateWorkerStatusRemote,
  type WorkerHomeResponse,
} from '../api'
import { IntensityBadge, Ltr, SectionCard } from '../components/ui'
import { SHIFT_TYPE_LABELS } from '../constants'
import { formatMinutes } from '../lib/shiftModels'
import { notify } from '../lib/notify'
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

export function WorkerHomePage() {
  const [home, setHome] = useState<WorkerHomeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setHome(await fetchWorkerHomeRemote())
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'טעינת המשמרת נכשלה')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!home?.shift) return
    const id = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(id)
  }, [home?.shift?.id, load])

  const phase = home?.now?.phase || 'none'
  const upcoming = phase === 'upcoming'
  const active = phase === 'active'

  const startLeft = useEndsAtCountdown(home?.now?.shiftStartsAt)
  const roundLeft = useEndsAtCountdown(home?.now?.roundEndsAt)
  const shiftLeft = useEndsAtCountdown(home?.now?.shiftEndsAt)

  useEffect(() => {
    if (!upcoming || startLeft == null) return
    if (startLeft <= 0) void load()
  }, [upcoming, startLeft, load])

  const markArrived = async () => {
    setBusy(true)
    try {
      setHome(await updateWorkerStatusRemote({ kind: 'arrive' }))
      notify.success('סומנה הגעה')
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'עדכון ההגעה נכשל')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !home) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-ink-soft">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        טוען את המשמרת…
      </div>
    )
  }

  if (!home) {
    return (
      <SectionCard title="המשמרת שלי" subtitle="לא ניתן לטעון נתונים כרגע.">
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => void load()}>
          נסו שוב
        </button>
      </SectionCard>
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
      <SectionCard
        title="עכשיו"
        subtitle={`${home.slot.date} · ${shiftLabel(home.slot.shiftType)} · ${home.slot.windowLabel}`}
        actions={
          <button
            type="button"
            className="ui-btn ui-btn-ghost !px-2.5"
            onClick={() => void load()}
            disabled={loading || busy}
            aria-label="רענון"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        {!home.shift ? (
          <p className="text-sm leading-relaxed text-ink-soft">
            אין משמרת עתידית או פעילה שאתם משובצים או מסומנים בה.
          </p>
        ) : (
          <div className="space-y-4">
            {upcoming ? (
              <div className="rounded-xl border border-brand/20 bg-brand/[0.06] p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-brand">
                  <Timer className="size-3.5" aria-hidden />
                  עד תחילת המשמרת
                </p>
                <p
                  className="mt-1 font-display text-4xl font-bold tabular-nums text-ink"
                  dir="ltr"
                >
                  {formatCountdown(
                    startLeft ?? (now?.minutesToShiftStart || 0) * 60,
                  )}
                </p>
                {now ? (
                  <p className="mt-2 text-sm text-ink-soft">
                    מתחילה ב־
                    <Ltr>{formatMinutes(now.shiftStartMinutes)}</Ltr>
                    {' · '}
                    מסתיימת ב־
                    <Ltr>{formatMinutes(now.shiftEndMinutes)}</Ltr>
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-ink-soft">
                  השיבוץ לנתיב יוצג רק אחרי תחילת המשמרת.
                </p>
              </div>
            ) : null}

            {active ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-brand/20 bg-brand/[0.06] p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-brand">
                      <Timer className="size-3.5" aria-hidden />
                      {now?.currentRound ? 'סיום הסבב' : 'סיום המשמרת'}
                    </p>
                    <p
                      className="mt-1 font-display text-3xl font-bold tabular-nums text-ink"
                      dir="ltr"
                    >
                      {now?.currentRound
                        ? formatCountdown(
                            roundLeft ?? (now.minutesToRoundEnd || 0) * 60,
                          )
                        : formatCountdown(
                            shiftLeft ?? (now?.minutesToShiftEnd || 0) * 60,
                          )}
                    </p>
                    {now?.currentRound ? (
                      <p className="mt-1 text-xs text-ink-soft">
                        סבב נוכחי: {now.currentRound.label}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-ink-soft">
                        שיבוץ קבוע למשמרת
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border border-line/70 bg-surface/50 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                      <Clock3 className="size-3.5" aria-hidden />
                      סיום המשמרת
                    </p>
                    <p
                      className="mt-1 font-display text-3xl font-bold tabular-nums text-ink"
                      dir="ltr"
                    >
                      {formatCountdown(
                        shiftLeft ?? (now?.minutesToShiftEnd || 0) * 60,
                      )}
                    </p>
                    {now ? (
                      <p className="mt-1 text-xs text-ink-soft">
                        חלון:{' '}
                        <Ltr>
                          {formatMinutes(now.shiftStartMinutes)}–
                          {formatMinutes(now.shiftEndMinutes)}
                        </Ltr>
                      </p>
                    ) : null}
                  </div>
                </div>

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

                {home.gateManager ? (
                  <p className="flex items-center gap-2 text-sm text-ink-soft">
                    <Shield className="size-4 text-brand" aria-hidden />
                    מנהל שער:{' '}
                    <span className="font-semibold text-ink">
                      {home.gateManager.fullName}
                    </span>
                  </p>
                ) : null}

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
