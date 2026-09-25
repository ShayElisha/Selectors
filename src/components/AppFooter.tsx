import { Link } from 'react-router-dom'

const YEAR = new Date().getFullYear()

const FOOTER_LINKS = [
  { to: '/privacy#terms', label: 'מדיניות שימוש' },
  { to: '/privacy#privacy', label: 'פרטיות' },
] as const

export function AppFooter({ className = '' }: { className?: string }) {
  return (
    <footer
      className={`relative z-10 mt-auto border-t border-line/80 pt-5 text-center ${className}`}
    >
      <p className="ui-eyebrow">CHECK IN</p>
      <p className="ui-muted mt-1.5">
        שיבוצון · עמדות סלקטורים · {YEAR}
      </p>

      <nav
        className="mt-3 flex flex-wrap items-center justify-center gap-x-1 gap-y-1"
        aria-label="מדיניות ופרטיות"
      >
        {FOOTER_LINKS.map((item, i) => (
          <span key={item.to} className="inline-flex items-center gap-x-1">
            {i > 0 ? (
              <span className="px-1 text-ink-soft/50" aria-hidden>
                ·
              </span>
            ) : null}
            <Link
              to={item.to}
              className="rounded-md px-1.5 py-1 text-xs font-bold text-brand underline decoration-brand/40 underline-offset-4 hover:bg-brand/5 hover:decoration-brand sm:text-sm"
            >
              {item.label}
            </Link>
          </span>
        ))}
      </nav>

      <p className="mt-2 text-[10px] text-ink-soft/80">לשימוש פנימי</p>
    </footer>
  )
}
