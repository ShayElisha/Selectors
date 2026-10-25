import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AppFooter } from './AppFooter'

export function PublicPage({
  children,
  wide = false,
}: {
  children: React.ReactNode
  /** Slightly wider column for long guides (help). */
  wide?: boolean
}) {
  const { user } = useApp()
  const backTo = user?.role === 'super_admin' ? '/admin' : user ? '/' : '/login'

  return (
    <div
      className={`mx-auto flex min-h-dvh flex-col px-4 py-8 sm:py-10 ${wide ? 'max-w-3xl' : 'max-w-2xl'}`}
    >
      <Link
        to={backTo}
        className="mb-5 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-deep"
      >
        <ArrowRight className="size-4" aria-hidden />
        חזרה
      </Link>
      <div className="flex-1">{children}</div>
      <AppFooter className="mt-10" />
    </div>
  )
}
