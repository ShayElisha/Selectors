import { useState } from 'react'
import { Download, Loader2, MessageCircle } from 'lucide-react'
import {
  buildWhatsAppText,
  downloadBoardImage,
  openWhatsAppShare,
  shareBoardImage,
  type ExportLaneLine,
} from '../lib/export'
import { postAuditEvent } from '../api'
import { SHIFT_TYPE_LABELS } from '../constants'
import type { ShiftType } from '../types'
import { useApp } from '../context/AppContext'
import { notify } from '../lib/notify'

interface ExportBarProps {
  date: string
  shiftType: ShiftType
  lines: ExportLaneLine[]
  unassigned: string[]
}

export function ExportBar({ date, shiftType, lines, unassigned }: ExportBarProps) {
  const { user } = useApp()
  const [busy, setBusy] = useState(false)
  const meta = { preparedBy: user?.fullName }

  const handleDownload = async () => {
    setBusy(true)
    try {
      await downloadBoardImage(date, shiftType, lines, unassigned, undefined, meta)
      void postAuditEvent(
        'export_board',
        `${date} · ${SHIFT_TYPE_LABELS[shiftType]} · ייצוא מסמך תמונה · ${lines.length} נתיבים`,
      )
      notify.success('המסמך יוצא בהצלחה')
    } catch (e) {
      console.error(e)
      notify.error('ייצוא המסמך נכשל. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  const handleWhatsApp = async () => {
    setBusy(true)
    const text = buildWhatsAppText(
      date,
      shiftType,
      lines.map((l) => ({
        laneName: l.laneName,
        workers: l.workers,
        notes: l.notes,
      })),
    )
    try {
      const mode = await shareBoardImage(
        date,
        shiftType,
        lines,
        unassigned,
        meta,
        text,
      )
      void postAuditEvent(
        'export_board',
        `${date} · ${SHIFT_TYPE_LABELS[shiftType]} · שיתוף WhatsApp (${mode}) · ${lines.length} נתיבים`,
      )
      if (mode === 'text') {
        openWhatsAppShare(text)
      }
      notify.success('השיתוף הוכן')
    } catch (e) {
      console.error(e)
      notify.warning('שיתוף המסמך נכשל — נפתח טקסט ב-WhatsApp.')
      void postAuditEvent(
        'export_board',
        `${date} · ${SHIFT_TYPE_LABELS[shiftType]} · שיתוף WhatsApp (טקסט בלבד) · ${lines.length} נתיבים`,
      )
      openWhatsAppShare(text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleDownload()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-deep disabled:opacity-60 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin sm:size-4" />
          ) : (
            <Download className="size-3.5 sm:size-4" />
          )}
          ייצוא מסמך
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleWhatsApp()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1ebe57] disabled:opacity-60 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
        >
          <MessageCircle className="size-3.5 sm:size-4" />
          שיתוף ב-WhatsApp
        </button>
      </div>
    </div>
  )
}
