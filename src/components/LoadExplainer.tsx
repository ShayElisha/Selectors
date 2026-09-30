const ROWS: { place: string; worth: string }[] = [
  { place: 'נתיב קל בבוקר או בצהריים', worth: 'חצי נקודה. זה נחשב מנוחה' },
  { place: 'נתיב בינוני ביום', worth: '2 נקודות' },
  { place: 'נתיב קשה ביום', worth: '3 נקודות' },
  { place: 'נתיב קל בלילה', worth: 'כ־3.5 נקודות. לילה לא נחשב מנוחה' },
  { place: 'נתיב קשה בלילה', worth: 'כ־5 נקודות' },
]

export function LoadExplainer() {
  return (
    <details className="rounded-xl border border-line/80 bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-ink-soft">
      <summary className="cursor-pointer font-semibold text-ink">
        איך מחושב העומס
      </summary>
      <div className="mt-2 space-y-2">
        <p>
          המספר הוא כמה העבודה האחרונה בטווח שבחרתם עדיין שוקלת. מספר גבוה אומר
          שהאדם ישב לאחרונה בנתיבים קשים יותר, או בלילות. מספר נמוך אומר שנח,
          או ישב בנתיבים קלים ביום.
        </p>
        <ul className="space-y-1">
          {ROWS.map((row) => (
            <li key={row.place} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
              <span>{row.place}</span>
              <span className="font-semibold text-ink">{row.worth}</span>
            </li>
          ))}
        </ul>
        <p>
          אצל סלקטורים סבב הוא רק חלק מהמשמרת. מי שעבר את כל הסבבים בנתיב קשה
          ביום מקבל 3 נקודות, לא 3 לכל סבב.
        </p>
        <p>
          יום בלי שיבוץ מוריד בערך רבע מהעומס שכבר נצבר. יום שכולו נתיבים קלים
          ביום מוריד עוד מעט. אחרי כמה ימי מנוחה העומס הישן כמעט נעלם.
        </p>
      </div>
    </details>
  )
}
