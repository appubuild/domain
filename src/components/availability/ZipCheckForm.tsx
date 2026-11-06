import { useId, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { SERVICE_CATEGORIES, SERVICES } from '@/config/services'
import { normalizeZip, validateZip } from '@/lib/zip'
import { tracking } from '@/lib/tracking'
import { useAvailability } from './AvailabilityContext'

interface ZipCheckFormProps {
  /** Pre-selects the service when the form is used on a service page. */
  defaultService?: string
  showServiceSelect?: boolean
  buttonLabel?: string
  /** "onDark" styles the card for placement over photography. */
  variant?: 'default' | 'onDark'
  className?: string
  helperText?: string
}

export const ZipCheckForm = ({
  defaultService,
  showServiceSelect = false,
  buttonLabel = 'Check Availability',
  variant = 'default',
  className = '',
  helperText,
}: ZipCheckFormProps) => {
  const { open } = useAvailability()
  const [serviceSlug, setServiceSlug] = useState(defaultService ?? '')
  const [zip, setZip] = useState('')
  const [error, setError] = useState<string | null>(null)
  const baseId = useId()

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const validation = validateZip(zip)
    if (!validation.valid) {
      setError(validation.message ?? 'Enter a valid ZIP code.')
      return
    }
    setError(null)
    tracking.onZipCheck({ service: serviceSlug || 'any', zip })
    open({ serviceSlug: serviceSlug || defaultService || '', zip: normalizeZip(zip) })
  }

  const onDark = variant === 'onDark'

  return (
    <form onSubmit={submit} className={className} noValidate>
      <div
        className={
          onDark
            ? 'rounded-2xl border border-white/15 bg-white/95 p-2.5 shadow-float backdrop-blur-md dark:bg-navy-900/90 dark:border-white/10'
            : 'rounded-2xl border border-line bg-surface p-2.5 shadow-card'
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {showServiceSelect ? (
            <div className="sm:w-52">
              <label htmlFor={`${baseId}-service`} className="sr-only">
                Select a service
              </label>
              <select
                id={`${baseId}-service`}
                value={serviceSlug}
                onChange={(event) => setServiceSlug(event.target.value)}
                className={
                  onDark
                    ? 'w-full cursor-pointer rounded-xl border-0 bg-transparent px-3 py-2.5 text-sm font-medium text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-white'
                    : 'w-full cursor-pointer rounded-xl border-0 bg-soft px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
                }
              >
                <option value="">Any service</option>
                {SERVICE_CATEGORIES.map((category) => (
                  <optgroup key={category.id} label={category.name}>
                    {SERVICES.filter((service) => service.category === category.id).map((service) => (
                      <option key={service.slug} value={service.slug}>
                        {service.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          ) : null}

          <div className="relative flex-1">
            <label htmlFor={`${baseId}-zip`} className="sr-only">
              Your ZIP code
            </label>
            <MapPin
              className={`pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 ${
                onDark ? 'text-navy-400' : 'text-muted'
              }`}
              aria-hidden="true"
            />
            <input
              id={`${baseId}-zip`}
              value={zip}
              onChange={(event) => {
                setZip(normalizeZip(event.target.value))
                setError(null)
              }}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="Enter your ZIP code"
              maxLength={5}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${baseId}-error` : undefined}
              className={
                onDark
                  ? 'w-full rounded-xl border-0 bg-transparent py-2.5 pl-10 pr-3 text-sm font-medium tracking-[0.1em] text-navy-900 placeholder:tracking-normal placeholder:text-navy-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-white dark:placeholder:text-navy-300'
                  : 'w-full rounded-xl border-0 bg-soft py-2.5 pl-10 pr-3 text-sm font-medium tracking-[0.1em] text-ink placeholder:tracking-normal placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
              }
            />
          </div>

          <button type="submit" className="btn-primary shrink-0 sm:px-6">
            <Search className="h-4 w-4" aria-hidden="true" />
            {buttonLabel}
          </button>
        </div>
      </div>

      {error ? (
        <p
          id={`${baseId}-error`}
          role="alert"
          className={`mt-2 text-sm font-medium ${onDark ? 'text-amber-200' : 'text-red-600 dark:text-red-400'}`}
        >
          {error}
        </p>
      ) : null}

      {helperText ? (
        <p className={`mt-2 text-xs ${onDark ? 'text-white/60' : 'text-muted'}`}>{helperText}</p>
      ) : null}
    </form>
  )
}
