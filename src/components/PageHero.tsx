import type { ReactNode } from 'react'
import { Breadcrumbs, type Crumb } from './Breadcrumbs'

interface PageHeroProps {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  crumbs: Crumb[]
  children?: ReactNode
  image?: { src: string; alt: string }
  /** Tightens vertical padding for legal/content pages. */
  compact?: boolean
}

export const PageHero = ({
  eyebrow,
  title,
  description,
  crumbs,
  children,
  image,
  compact = false,
}: PageHeroProps) => (
  <section className="relative overflow-hidden border-b border-line bg-soft">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl"
    />
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-40 left-1/3 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl"
    />
    <div className="container-page relative">
      <div className={`grid gap-8 ${image ? 'lg:grid-cols-[1.15fr_1fr] lg:items-center' : ''} ${compact ? 'py-8 sm:py-10' : 'py-10 sm:py-14'}`}>
        <div className="max-w-3xl">
          <Breadcrumbs items={crumbs} />
          {eyebrow ? <span className="eyebrow mt-5">{eyebrow}</span> : null}
          <h1
            className={`${eyebrow ? 'mt-4' : 'mt-5'} font-display text-[1.75rem] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-4xl lg:text-[2.75rem]`}
          >
            {title}
          </h1>
          {description ? (
            <p className="mt-4 max-w-2xl text-[0.9375rem] leading-7 text-muted sm:text-base sm:leading-8">
              {description}
            </p>
          ) : null}
          {children ? <div className="mt-6">{children}</div> : null}
        </div>

        {image ? (
          <div className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:rounded-3xl">
            <img
              src={image.src}
              alt={image.alt}
              width={1376}
              height={768}
              className="h-56 w-full object-cover sm:h-72 lg:h-[22rem]"
            />
          </div>
        ) : null}
      </div>
    </div>
  </section>
)
