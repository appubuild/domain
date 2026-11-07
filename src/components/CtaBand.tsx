import { ArrowRight, Phone } from 'lucide-react'
import { useCallSheet } from '@/components/calls/CallContext'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

interface CtaBandProps {
  headline?: string
  description?: ReactNode
  primaryLabel?: string
  secondaryLabel?: string
  secondaryTo?: string
  serviceSlug?: string
}

export const CtaBand = ({
  headline = 'Ready to Find Help for Your Home?',
  description = 'Choose the service you need and call the line assigned to that trade.',
  primaryLabel = 'Call Now',
  secondaryLabel = 'How it works',
  secondaryTo = '/how-it-works',
  serviceSlug,
}: CtaBandProps) => {
  const { open } = useCallSheet()

  return (
    <section className="section">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-3xl bg-navy-900 px-6 py-12 shadow-float sm:px-10 sm:py-16 lg:px-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-90"
            style={{
              backgroundImage:
                'radial-gradient(60% 80% at 15% 20%, rgba(37,99,235,0.55) 0%, rgba(37,99,235,0) 60%), radial-gradient(50% 70% at 90% 90%, rgba(14,165,233,0.35) 0%, rgba(14,165,233,0) 65%)',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)',
              backgroundSize: '64px 64px',
              maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
            }}
          />

          <div className="relative max-w-2xl">
            <h2 className="font-display text-2xl font-extrabold leading-tight text-white sm:text-3xl lg:text-4xl">
              {headline}
            </h2>
            <p className="mt-3 text-[0.9375rem] leading-7 text-white/70 sm:text-base">{description}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => open({ serviceSlug })}
                className="btn-white"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                {primaryLabel}
              </button>
              <Link
                to={secondaryTo}
                className="btn border border-white/25 bg-white/5 text-white backdrop-blur-sm transition-colors hover:bg-white/10"
              >
                {secondaryLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <p className="mt-5 text-xs leading-5 text-white/70">
              Calls are answered by independent participating providers. Review the service page first if you
              would like to understand the work before you call.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
