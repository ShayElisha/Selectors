import {
  formatHours,
  type MonthPay,
  type PayBasis,
} from './grossPay'

const MONTH_NAMES = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
]

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

const moneyFormat = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function money(value: number | null): string {
  if (value == null) return '—'
  return moneyFormat.format(value)
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function monthTitle(month: string): string {
  const [, monthNumber] = month.split('-').map(Number)
  const year = month.slice(0, 4)
  return `${MONTH_NAMES[(monthNumber ?? 1) - 1] ?? month} ${year}`
}

function workedMinutes(totals: MonthPay['totals']): number {
  return (
    totals.regular +
    totals.ot125 +
    totals.ot150 +
    totals.shabbat +
    totals.holiday
  )
}

/**
 * Opens a print dialog for the monthly hours / gross summary.
 * Users can choose «שמירה כ־PDF» in the browser print dialog.
 */
export function printPaySummaryPdf(args: {
  report: MonthPay
  workerName: string
  orgName?: string | null
  basis?: PayBasis | null
  amount?: number | null
}): void {
  const { report, workerName, orgName, basis, amount } = args
  const title = `סיכום שעות · ${monthTitle(report.month)}`
  const dayRows = report.days
    .filter((day) => {
      const worked =
        day.minutes.regular +
        day.minutes.ot125 +
        day.minutes.ot150 +
        day.minutes.shabbat +
        day.minutes.holiday
      return worked > 0 || day.entries.length > 0
    })
    .map((day) => {
      const worked =
        day.minutes.regular +
        day.minutes.ot125 +
        day.minutes.ot150 +
        day.minutes.shabbat +
        day.minutes.holiday
      const entries = day.entries
        .map((entry) => `${entry.from}–${entry.to}`)
        .join(' · ')
      return `<tr>
        <td>${Number(day.date.slice(8))} · יום ${DAY_NAMES[day.weekday]}</td>
        <td dir="ltr">${esc(entries || '—')}</td>
        <td dir="ltr">${esc(formatHours(worked))}</td>
        <td dir="ltr">${esc(money(day.gross))}</td>
      </tr>`
    })
    .join('')

  const rateLine =
    basis && amount && amount > 0
      ? basis === 'monthly'
        ? `שכר חודשי ${money(amount)} · שעה משוערת ${money(report.hourlyRate)}`
        : `שכר שעתי ${money(report.hourlyRate)}`
      : 'לא הוגדר שכר — מוצגות שעות בלבד'

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Arial, "Noto Sans Hebrew", sans-serif; color: #111; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { color: #555; margin-bottom: 16px; line-height: 1.5; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0 16px; }
    .stat { border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; }
    .stat b { display: block; font-size: 14px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e5e5e5; padding: 7px 6px; text-align: right; vertical-align: top; }
    th { font-size: 11px; color: #555; background: #f7f7f7; }
    .foot { margin-top: 16px; color: #666; font-size: 11px; line-height: 1.45; }
    @media print { .noprint { display: none !important; } }
  </style>
</head>
<body>
  <button class="noprint" onclick="window.print()" style="margin-bottom:12px;padding:8px 12px;">הדפסה / שמירה כ־PDF</button>
  <h1>${esc(title)}</h1>
  <div class="meta">
    <div>${esc(workerName)}${orgName ? ` · ${esc(orgName)}` : ''}</div>
    <div>${esc(rateLine)}</div>
    <div>נוצר ב־${esc(new Date().toLocaleString('he-IL'))}</div>
  </div>
  <div class="stats">
    <div class="stat">סה״כ שעות<b dir="ltr">${esc(formatHours(workedMinutes(report.totals)))}</b></div>
    <div class="stat">ברוטו לחודש<b dir="ltr">${esc(money(report.gross))}</b></div>
    <div class="stat">רגיל / נוספות
      <b dir="ltr">${esc(formatHours(report.totals.regular))} · ${esc(formatHours(report.totals.ot125 + report.totals.ot150))}</b>
    </div>
  </div>
  <table>
    <thead>
      <tr><th>יום</th><th>שעות</th><th>סה״כ</th><th>ברוטו</th></tr>
    </thead>
    <tbody>
      ${dayRows || '<tr><td colspan="4">אין רשומות שעות בחודש זה</td></tr>'}
    </tbody>
  </table>
  <p class="foot">
    אומדן ברוטו לפי כללי שעות נוספות במערכת — אינו תלוש שכר רשמי.
    פירוט: רגיל ${esc(formatHours(report.totals.regular))} ·
    125% ${esc(formatHours(report.totals.ot125))} ·
    150% ${esc(formatHours(report.totals.ot150))} ·
    שבת ${esc(formatHours(report.totals.shabbat))} ·
    חג ${esc(formatHours(report.totals.holiday))}
  </p>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 250))</script>
</body>
</html>`

  const popup = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700')
  if (!popup) {
    throw new Error('יש לאפשר חלונות קופצים כדי לייצא PDF')
  }
  popup.document.open()
  popup.document.write(html)
  popup.document.close()
}
