import { useId } from 'react'
import { Link } from 'react-router-dom'
import { SITE } from '@/config/site'

interface LogoProps {
  /** "light" renders white text for use on dark backgrounds. */
  variant?: 'default' | 'light'
  className?: string
}

export const LogoMark = ({ className = 'h-10 w-10' }: { className?: string }) => {
  // Unique gradient id so multiple logo instances never collide in the DOM.
  const gradientId = `shn-mark-${useId().replace(/:/g, '')}`

  return (
  <svg
    viewBox="0 0 48 48"
    className={className}
    role="img"
    aria-hidden="true"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id={gradientId} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
        <stop stopColor="#2563EB" />
        <stop offset="1" stopColor="#1D4ED8" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="46" height="46" rx="13" fill={`url(#${gradientId})`} />
    <path
      d="M24 11.5 12.5 21.2v13.3c0 1.1.9 2 2 2h19c1.1 0 2-.9 2-2V21.2L24 11.5Z"
      stroke="#fff"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.96"
    />
    <path
      d="M19.4 27.6l3.3 3.3 6.2-6.6"
      stroke="#F59E0B"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
  )
}

export const Logo = ({ variant = 'default', className = '' }: LogoProps) => (
  <Link
    to="/"
    className={`group inline-flex items-center gap-3 rounded-lg ${className}`}
    aria-label={`${SITE.name} — home`}
  >
    <LogoMark className="h-10 w-10 shrink-0 transition-transform duration-300 group-hover:-translate-y-0.5" />
    <span className="flex flex-col leading-none">
      <span
        className={`font-display text-[1.0625rem] font-extrabold tracking-tight sm:text-lg ${
          variant === 'light' ? 'text-white' : 'text-ink'
        }`}
      >
        Safe<span className="text-brand-600 dark:text-brand-400">Home</span>Network
      </span>
      <span
        className={`mt-1 text-[0.5625rem] font-semibold uppercase tracking-[0.22em] ${
          variant === 'light' ? 'text-white/60' : 'text-muted'
        }`}
      >
        Home Services Directory
      </span>
    </span>
  </Link>
)
