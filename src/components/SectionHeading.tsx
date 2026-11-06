import type { ReactNode } from 'react'

interface SectionHeadingProps {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  align?: 'left' | 'center'
  className?: string
  as?: 'h1' | 'h2' | 'h3'
  id?: string
}

export const SectionHeading = ({
  eyebrow,
  title,
  description,
  align = 'left',
  className = '',
  as = 'h2',
  id,
}: SectionHeadingProps) => {
  const Heading = as
  return (
    <div
      className={`${align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'} ${className}`}
    >
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <Heading
        id={id}
        className={`${eyebrow ? 'mt-4' : ''} font-display text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-3xl lg:text-[2.5rem] lg:leading-[1.1]`}
      >
        {title}
      </Heading>
      {description ? (
        <p className="mt-4 text-[0.9375rem] leading-7 text-muted sm:text-base sm:leading-8">{description}</p>
      ) : null}
    </div>
  )
}
