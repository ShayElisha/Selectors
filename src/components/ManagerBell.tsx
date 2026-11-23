import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckCheck } from 'lucide-react'
import {
  checkCrossModuleConflictsRemote,
  fetchManagerEquipmentRequestsRemote,
} from '../api'
import { useApp } from '../context/AppContext'
import {
  ensureCriticalFaultNotices,
  ensureCrossModuleConflictNotices,
  ensureHardLaneStreakNotices,
  ensureMissingWindowsNotice,
  ensurePendingEquipmentNotices,
  ensurePendingFaultNotices,
  ensureShiftEndNotice,
  ensureShiftOverdueNotice,
  findHardLaneStreaks,
  isActingGateManager,
  listManagerNotices,
  markAllManagerNoticesRead,
  markManagerNoticeRead,
  unreadManagerNoticeCount,
  type ManagerNotice,
} from '../lib/managerNotifications'
import type { View } from '../types'
import { notify } from '../lib/notify'

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    })
  } catch {
    return ''
  }
}

function openShiftCandidates(
  draft: ReturnType<typeof useApp>['draft'],
  history: ReturnType<typeof useApp>['data']['history'],
) {
  const byId = new Map<string, (typeof history)[number] | NonNullable<typeof draft>>()
  for (const shift of history) {
    if (shift.signOff?.signedAt) continue
    byId.set(shift.id, shift)
  }
  if (draft && !draft.signOff?.signedAt) {
    byId.set(draft.id, draft)
  }
  return [...byId.values()]
}

type PanelPos = { top: number; left: number; width: number }

export function ManagerBell() {
  const { draft, data, user, setView, loadShiftFromHistory } = useApp()
  const [open, setOpen] = useState(false)
  const [notices, setNotices] = useState<ManagerNotice[]>(() => listManagerNotices())
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(() => setNotices(listManagerNotices()), [])

  const placePanel = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const gap = 8
    const width = Math.min(22 * 16, window.innerWidth - 24)
    // Prefer aligning the panel's inline-end with the button's inline-end
    // (under the bell), then clamp into the viewport.
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
    let left = rtl ? rect.right - width : rect.left
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12))
    let top = rect.bottom + gap
    const approxHeight = Math.min(window.innerHeight * 0.6, 24 * 16)
    if (top + approxHeight > window.innerHeight - 12) {
      top = Math.max(12, rect.top - gap - approxHeight)
    }
    setPanelPos({ top, left, width })
  }, [])

  const syncNotices = useCallback(async () => {
    const shifts = openShiftCandidates(draft, data.history)
    for (const shift of shifts) {
      const viewerIsGateManager = isActingGateManager({
        userId: user?.id,
        userPhone: user?.phone,
        gateManagerWorkerId: shift.gateManagerWorkerId,
        workers: data.workers,
      })
      ensureShiftEndNotice({
        shiftId: shift.id,
        date: shift.date,
        shiftType: shift.shiftType,
        signedOff: Boolean(shift.signOff?.signedAt),
        viewerIsGateManager,
      })
      ensureShiftOverdueNotice({
        shiftId: shift.id,
        date: shift.date,
        shiftType: shift.shiftType,
        signedOff: Boolean(shift.signOff?.signedAt),
        viewerIsGateManager,
      })
    }

    ensurePendingFaultNotices(data.incidents)
    ensureCriticalFaultNotices(data.incidents)

    try {
      const equipment = await fetchManagerEquipmentRequestsRemote('pending')
      ensurePendingEquipmentNotices(equipment.requests)
    } catch {
      /* offline / unauthorized — keep existing notices */
    }

    const crossTargets = draft && !draft.signOff?.signedAt ? [draft] : []
    for (const shift of crossTargets) {
      try {
        const result = await checkCrossModuleConflictsRemote({
          id: shift.id,
          date: shift.date,
          shiftType: shift.shiftType,
          presentWorkerIds: shift.presentWorkerIds,
          assignments: shift.assignments,
          rounds: shift.rounds,
        })
        ensureCrossModuleConflictNotices(result.conflicts, {
          shiftId: shift.id,
        })
      } catch {
        /* ignore check failures */
      }

      const nameById = new Map(data.workers.map((w) => [w.id, w.fullName]))
      // Only warn once there are present workers — empty attendance is normal
      // while the manager is still setting up the shift.
      if (shift.presentWorkerIds.length > 0) {
        const missingNames = shift.presentWorkerIds
          .filter((id) => id !== shift.gateManagerWorkerId)
          .filter((id) => !String(shift.workerWindows?.[id] || '').trim())
          .map((id) => nameById.get(id) || id)
        // Avoid noisy alerts while most of the roster is still being filled in.
        if (
          missingNames.length > 0 &&
          missingNames.length >= Math.min(3, shift.presentWorkerIds.length)
        ) {
          ensureMissingWindowsNotice({
            shiftId: shift.id,
            date: shift.date,
            shiftType: shift.shiftType,
            missingNames,
          })
        }
      }

      // Hard-lane streaks need completed history placements; skip empty boards.
      const hasPlacements =
        (shift.assignments?.some((row) => row.workerIds.some(Boolean)) ??
          false) ||
        (shift.rounds?.some((round) =>
          round.assignments.some((row) => row.workerIds.some(Boolean)),
        ) ??
          false)
      if (hasPlacements) {
        const historyWithDraft = [
          ...data.history.filter((item) => item.id !== shift.id),
          {
            id: shift.id,
            date: shift.date,
            shiftType: shift.shiftType,
            audience: shift.audience,
            assignments: shift.assignments,
            rounds: shift.rounds,
          },
        ]
        const hardStreaks = findHardLaneStreaks({
          history: historyWithDraft,
          lanes: data.lanes,
          audience: shift.audience ?? 'inspector',
          workerIds: shift.presentWorkerIds,
          minStreak: 3,
        })
        if (hardStreaks.length > 0) {
          ensureHardLaneStreakNotices(
            hardStreaks.map((row) => ({
              ...row,
              workerName: nameById.get(row.workerId) || row.workerId,
            })),
            { shiftId: shift.id },
          )
        }
      }
    }

    refresh()
  }, [
    draft,
    data.history,
    data.workers,
    data.lanes,
    data.incidents,
    user?.id,
    user?.phone,
    refresh,
  ])

  useEffect(() => {
    void syncNotices()
    const timer = window.setInterval(() => {
      void syncNotices()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [syncNotices])

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null)
      return
    }
    placePanel()
    const onWin = () => placePanel()
    window.addEventListener('resize', onWin)
    window.addEventListener('scroll', onWin, true)
    return () => {
      window.removeEventListener('resize', onWin)
      window.removeEventListener('scroll', onWin, true)
    }
  }, [open, placePanel, notices.length])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unread = useMemo(
    () => notices.filter((n) => !n.read).length || unreadManagerNoticeCount(),
    [notices],
  )

  const openNotice = (notice: ManagerNotice) => {
    markManagerNoticeRead(notice.id)
    refresh()
    const view = (notice.view ||
      (notice.kind === 'fault' || notice.kind === 'critical_fault'
        ? 'incidents'
        : notice.kind === 'equipment'
          ? 'equipment'
          : notice.kind === 'new_manager'
            ? 'workers'
            : notice.kind === 'hard_lane_streak'
              ? 'tracking'
              : notice.kind === 'notice_send_failed'
                ? 'settings'
                : notice.kind === 'shift_end' ||
                    notice.kind === 'shift_overdue' ||
                    notice.kind === 'board_quality' ||
                    notice.kind === 'cross_module' ||
                    notice.kind === 'missing_windows' ||
                    notice.kind === 'quality_drop' ||
                    notice.kind === 'save_conflict'
                  ? 'shift'
                  : null)) as View | null
    if (view) {
      setOpen(false)
      if (view === 'shift' && notice.shiftId) {
        if (draft?.id === notice.shiftId) {
          setView('shift')
          return
        }
        if (data.history.some((shift) => shift.id === notice.shiftId)) {
          loadShiftFromHistory(notice.shiftId)
          return
        }
        setView('home')
        notify.info('המשמרת מההתראה כבר לא זמינה')
        return
      }
      setView(view)
    }
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className="relative inline-flex size-10 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        aria-label={unread ? `התראות מנהל, ${unread} שלא נקראו` : 'התראות מנהל'}
        aria-expanded={open}
        onClick={() => {
          void syncNotices()
          setOpen((v) => !v)
        }}
      >
        <Bell className="size-4.5 size-5" aria-hidden />
        {unread > 0 ? (
          <span className="absolute end-1.5 top-1.5 size-2 rounded-full bg-warn ring-2 ring-card" />
        ) : null}
      </button>
      {open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="התראות מנהל"
              style={{
                position: 'fixed',
                top: panelPos.top,
                left: panelPos.left,
                width: panelPos.width,
                zIndex: 220,
              }}
              className="overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-panel-hover)]"
            >
              <div className="flex items-center justify-between border-b border-line/70 px-3 py-2.5">
                <p className="text-sm font-bold text-ink">התראות</p>
                {notices.some((n) => !n.read) ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:underline"
                    onClick={() => {
                      markAllManagerNoticesRead()
                      refresh()
                    }}
                  >
                    <CheckCheck className="size-3.5" aria-hidden />
                    סמן הכול כנקרא
                  </button>
                ) : null}
              </div>
              <ul className="max-h-[min(24rem,60vh)] overflow-y-auto">
                {notices.length === 0 ? (
                  <li className="px-3 py-6 text-center text-sm text-ink-soft">
                    אין התראות כרגע
                  </li>
                ) : (
                  notices.map((notice) => (
                    <li key={notice.id} className="border-b border-line/60 last:border-0">
                      <button
                        type="button"
                        className={`w-full px-3 py-2.5 text-start transition hover:bg-surface ${
                          notice.read ? '' : 'bg-brand/[0.04]'
                        }`}
                        onClick={() => openNotice(notice)}
                      >
                        <p className="text-[13px] font-bold text-ink">{notice.title}</p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">
                          {notice.body}
                        </p>
                        <p className="mt-1 text-[11px] text-ink-soft">
                          {formatWhen(notice.at)}
                        </p>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
