const ROWS: { place: string; worth: string }[] = [
  { place: 'יום בלי שיבוץ', worth: '2−' },
  { place: 'נתיב קל בבוקר או בצהריים', worth: '1−' },
  { place: 'נתיב בינוני בבוקר או בצהריים', worth: '0' },
  { place: 'נתיב קשה בבוקר', worth: '+2' },
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
          המספר הוא מאזן 14 הימים האחרונים בטווח שבחרתם. נקודת האפס היא משמרת
          בינונית ביום: היא לא מעלה ולא מורידה. מספר גבוה אומר שעבדו בנתיבים
          קשים או בלילות יותר מאשר נחו. המספר לא יורד מתחת ל־2−, וימים ישנים
          יוצאים מהחלון.
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
          נתיב קשה בבוקר ונתיב קשה בצהריים שווים. שניהם באותו יום שווים לילה
          קשה. יום חופש אחד מוחק נתיב קשה אחד. אצל סלקטורים כל הסבבים של אותה
          משמרת נספרים כמשמרת אחת, לא כמשמרת לכל סבב.
        </p>
        <p>
          ליד המספר מופיע כמה הוא עלה וכמה ירד. ימי חופש אחרי שהמאזן כבר ב־2−
          לא מתווספים לירידה.
        </p>
      </div>
    </details>
  )
}
