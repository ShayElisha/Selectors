import {
  BarChart3,
  CalendarX2,
  FileSpreadsheet,
  History,
  ScrollText,
  Wallet,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import type { View } from '../types'

const REPORT_LINKS: {
  id: View
  title: string
  blurb: string
  icon: typeof BarChart3
}[] = [
  {
    id: 'analytics',
    title: 'סטטיסטיקות ואנליזה',
    blurb: 'כיסוי, עומסים ומגמות לאורך זמן.',
    icon: BarChart3,
  },
  {
    id: 'history',
    title: 'היסטוריית משמרות',
    blurb: 'כל השיבוצים שנשמרו, כולל סגורים.',
    icon: History,
  },
  {
    id: 'pay',
    title: 'דוח שכר / נוכחות',
    blurb: 'סיכום שעות ונוכחות לייצוא.',
    icon: Wallet,
  },
  {
    id: 'audit',
    title: 'יומן פעולות',
    blurb: 'מי שינה מה, ומתי — כולל לפני/אחרי.',
    icon: ScrollText,
  },
  {
    id: 'cancellations',
    title: 'ביטולים וחוסרים',
    blurb: 'אי־הגעות, ביטולים ויציאות מוקדמות.',
    icon: CalendarX2,
  },
]

export function ReportsPage() {
  const { setView } = useApp()

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          מרכז דוחות
        </p>
        <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">
          כל הדוחות במקום אחד
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-soft">
          במקום לחפש בתפריט — כאן יש קיצור לכל המסכים שמסכמים מה קרה במשמרות.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {REPORT_LINKS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className="flex items-start gap-3 rounded-2xl border border-line bg-card px-4 py-3.5 text-start shadow-[var(--shadow-panel)] transition hover:border-brand/30 hover:bg-brand/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">{item.title}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">
                  {item.blurb}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <p className="inline-flex items-center gap-2 text-[12px] text-ink-soft">
        <FileSpreadsheet className="size-3.5" aria-hidden />
        ייצוא מפורט (Excel/CSV) זמין מתוך מסכי ההיסטוריה והאנליזה.
      </p>
    </div>
  )
}
