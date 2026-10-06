const ROWS: { place: string; worth: string }[] = [
  { place: 'יום בלי שיבוץ', worth: '2−' },
  { place: 'נתיב קל בבוקר', worth: '+1' },
  { place: 'נתיב קל בצהריים', worth: '+0.5' },
  { place: 'נתיב בינוני בבוקר', worth: '+2' },
  { place: 'נתיב בינוני בצהריים', worth: '+1' },
  { place: 'נתיב קשה בבוקר', worth: '+3.5' },
  { place: 'נתיב קשה בצהריים', worth: '+2' },
  { place: 'נתיב קל בלילה', worth: '+1' },
  { place: 'נתיב בינוני בלילה', worth: '+2' },
  { place: 'נתיב קשה בלילה', worth: '+4' },
]

export function LoadExplainer() {
  return (
    <details className="rounded-xl border border-line/80 bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-ink-soft">
      <summary className="cursor-pointer font-semibold text-ink">
        איך מחושב העומס
      </summary>
      <div className="mt-2 space-y-2">
        <p>
          המספרים נפרדים: בוקר, צהריים ולילה. כל אחד מהם מאזן של 14 הימים שלו. יום בלי שיבוץ (גם אם סומן נוכח) מוריד 2− במשפחת המשמרת הזו. יום בלי בוקר מוריד רק את הבוקר, ויום בלי צהריים מוריד רק את הצהריים. נתיב קשה בבוקר כבד מאותו נתיב בצהריים. אף מספר לא יורד מתחת ל־2−.
        </p>
        <ul className="space-y-1">
          {ROWS.map((row) => (
            <li
              key={row.place}
              className="flex flex-wrap justify-between gap-x-3 gap-y-0.5"
            >
              <span>{row.place}</span>
              <span className="font-semibold text-ink">{row.worth}</span>
            </li>
          ))}
        </ul>
        <p>
          נתיב קשה בבוקר לא נכנס לעומס הצהריים, ונתיב קשה בצהריים לא נכנס לעומס
          הבוקר. יום חופש של משמרת אחת לא מוחק את השנייה. אצל סלקטורים כל
          הסבבים של אותה משמרת נספרים כמשמרת אחת.
        </p>
        <p>
          ליד המספר מופיע כמה הוא עלה וכמה ירד. ימי חופש אחרי שהמאזן כבר ב־2−
          לא מתווספים לירידה.
        </p>
      </div>
    </details>
  )
}
