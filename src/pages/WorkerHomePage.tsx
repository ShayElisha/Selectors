import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Shield,
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

  return (
    <div className="space-y-4">
      <SectionCard
        title="המשמרת שלי"
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
            אין כרגע משמרת שמורה שאתם משובצים או מסומנים בה. אם אתם אמורים
            לעבוד עכשיו — פנו למנהל.
          </p>
        ) : (
          <div className="space-y-4">
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
              <div className="space-y-3">
                <p className="text-sm font-semibold text-ink">הסבבים שלי</p>
                {home.placement.rounds.map((round) => (
                  <div
                    key={round.label}
                    className="rounded-xl border border-line/70 bg-surface/50 p-3"
                  >
                    <p className="text-sm font-bold text-ink">{round.label}</p>
                    {round.assignments.length === 0 ? (
                      <p className="mt-1 text-xs text-ink-soft">אין שיבוץ בסבב זה</p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {round.assignments.map((a) => (
                          <li
                            key={`${round.label}-${a.laneId}`}
                            className="flex flex-wrap items-center gap-2 text-sm"
                          >
                            <span className="font-semibold text-ink">{a.laneName}</span>
                            <IntensityBadge
                              intensity={(a.intensity as Intensity) || 'medium'}
                            />
                            {a.notes ? (
                              <span className="text-xs text-ink-soft">· {a.notes}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-ink">הנתיב שלי</p>
                {home.placement.lanes.length === 0 ? (
                  <p className="text-sm text-ink-soft">
                    {arrived
                      ? 'אתם מסומנים כנוכחים, אך עדיין לא שובצתם לנתיב.'
                      : 'עדיין לא שובצתם לנתיב במשמרת זו.'}
                  </p>
                ) : (
                  home.placement.lanes.map((a) => (
                    <div
                      key={a.laneId}
                      className="rounded-xl border border-line/70 bg-surface/50 p-3"
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
                  ))
                )}
              </div>
            )}

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
                {home.status.drop ? <span>{home.status.drop.reason}</span> : null}
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
          </div>
        )}
      </SectionCard>
    </div>
  )
}
